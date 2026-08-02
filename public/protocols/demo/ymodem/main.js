/**
 * YMODEM 文件传输 —— 用户安装参考协议
 *
 * 特性：下发（PC 发送文件到设备）与读取（PC 接收设备文件）双向；CRC16-XMODEM；
 * 字节流缓冲解析（不依赖串口分帧对齐）；单块超时重试；进度上报；可取消。
 *
 * YMODEM 协议要点：
 *  - 帧结构：[SOH(0x01)/STX(0x02)] [块号] [255-块号] [数据 128/1024 字节] [CRC16-XMODEM 高字节] [低字节]
 *  - 发送方：等待接收方 'C'(0x43) → 发送块0(文件名+大小) → 逐块发送数据 → EOT(0x04) 结束
 *  - 接收方：主动发 'C' 请求 → 收块0 解析文件名/大小 → 收数据块并 ACK(0x06) → EOT 后收尾保存
 *  - 错误应答 NAK(0x15)；取消 CAN(0x18)
 *  - 协议为字节流，接收端必须用缓冲累积解析，不能假设「一帧一回调」
 *
 * 编写约定：ESM 默认导出实现对象；只依赖注入的 ctx；全中文注释；值样本用 ASCII valueId。
 */

const SOH = 0x01
const STX = 0x02
const EOT = 0x04
const ACK = 0x06
const NAK = 0x15
const CAN = 0x18
const C = 0x43 // 'C'，请求 CRC16-XMODEM 模式
const SUB = 0x1a // 数据块填充字节

/** CRC16-XMODEM：poly 0x1021，初值 0x0000，非反射（YMODEM 数据块校验） */
function crc16Xmodem(bytes) {
  let crc = 0
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff
      else crc = (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** 组装一个数据块帧；dataLen 决定 SOH(128) 或 STX(1024)，不足用 0x1A 填充 */
function buildBlock(blockNo, data, dataLen) {
  const head = dataLen === 1024 ? STX : SOH
  const padded = new Array(dataLen).fill(SUB)
  for (let i = 0; i < data.length && i < dataLen; i++) padded[i] = data[i]
  const crc = crc16Xmodem(padded)
  return [head, blockNo & 0xff, (~blockNo) & 0xff, ...padded, (crc >> 8) & 0xff, crc & 0xff]
}

/** 块0（文件名+大小信息）：128 字节，路径清理为纯文件名 */
function buildBlock0(filename, size) {
  const name = filename.split(/[\\/]/).pop() || 'firmware.bin'
  const meta = `${name}\0${String(size)}\0`
  const data = new Array(128).fill(0)
  for (let i = 0; i < meta.length && i < 128; i++) data[i] = meta.charCodeAt(i) & 0xff
  return buildBlock(0, data, 128)
}

/** 校验块：校验头、块号补码与 CRC */
function parseBlock(frame) {
  if (frame.length < 3) return null
  const head = frame[0]
  const dataLen = head === STX ? 1024 : head === SOH ? 128 : 0
  if (dataLen === 0) return null
  if (frame.length < 3 + dataLen + 2) return null
  const blockNo = frame[1]
  if ((frame[2] & 0xff) !== ((~blockNo) & 0xff)) return null
  const data = frame.slice(3, 3 + dataLen)
  const crcStored = (frame[3 + dataLen] << 8) | frame[4 + dataLen]
  if (crcStored !== crc16Xmodem(data)) return null
  return { blockNo, data }
}

/** 解析块0内容：文件名 / 大小 */
function parseBlock0Meta(data) {
  let end0 = data.indexOf(0)
  if (end0 < 0) return { filename: '', size: -1 }
  const filename = String.fromCharCode(...data.slice(0, end0))
  let i = end0 + 1
  let end1 = data.indexOf(0, i)
  if (end1 < 0) return { filename, size: -1 }
  const size = parseInt(String.fromCharCode(...data.slice(i, end1)), 10)
  return { filename, size: Number.isNaN(size) ? -1 : size }
}

export default {
  init(ctx) {
    this.ctx = ctx
    this.buf = []          // 字节流缓冲
    this.mode = null       // 'send' | 'recv'
    this.state = 'idle'    // idle / wait_c / block0 / data / eot / done / cancel
    this.blk = 0           // 当前期望块号
    this.retry = 0
    this.lastRxAt = 0      // 最近收到字节时间（超时重试用）
    this.phase = ''        // 当前阶段描述（日志/进度）
    this._applyConfig()
    ctx.log('info', 'YMODEM 已就绪：启动实例后点「开始下发 / 开始读取」')
  },

  dispose() {
    this.buf = []
    this.mode = null
    this.state = 'idle'
  },

  setConfig(patch) {
    if (patch && 'file' in patch) this.buf = []
    this._applyConfig()
    if (patch && ('block_size' in patch || 'timeout_ms' in patch || 'retries' in patch)) {
      this.buf = []
      if (this.state !== 'idle' && this.state !== 'done') {
        this.ctx.log('warn', '传输参数已变更，请重新开始')
      }
    }
  },

  _applyConfig() {
    this.blockSize = this.ctx.getParam('block_size') === '128' ? 128 : 1024
    this.timeoutMs = Math.max(200, Number(this.ctx.getParam('timeout_ms')) || 1000)
    this.retries = Math.max(1, Math.min(50, Number(this.ctx.getParam('retries')) || 10))
    this.saveName = String(this.ctx.getParam('save_name') || '').trim()
  },

  _emit(progress, blocks) {
    this.ctx.emitVar({ valueId: 'progress', value: Math.round(progress) })
    this.ctx.emitVar({ valueId: 'blocks', value: blocks })
  },

  _sendBytes(bytes) {
    const hex = bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('')
    return this.ctx.sendHex(hex).catch(err => {
      this.ctx.log('error', `发送失败: ${err && err.message ? err.message : String(err)}`)
      this._abort()
    })
  },

  // ---------- 发送（下发） ----------

  startSend() {
    if (this.state !== 'idle' && this.state !== 'done') {
      this.ctx.log('warn', '传输进行中，请先取消')
      return
    }
    const f = this.ctx.getFile('file')
    if (!f) {
      this.ctx.log('error', '未选择下发文件：请先在参数配置中选择固件文件')
      return
    }
    this.mode = 'send'
    this.state = 'wait_c'
    this.retry = 0
    this.lastRxAt = 0
    this.buf = []
    this.file = f
    this.totalSize = f.bytes.length
    this.sentSize = 0
    this.phase = '等待接收方请求 (C)'
    this._emit(0, 0)
    this.ctx.log('info', `开始下发 ${f.name}（${this.totalSize} 字节），等待接收方 'C'...`)
  },

  // ---------- 接收（读取） ----------

  startRecv() {
    if (this.state !== 'idle' && this.state !== 'done') {
      this.ctx.log('warn', '传输进行中，请先取消')
      return
    }
    this.mode = 'recv'
    this.state = 'wait_c'
    this.retry = 0
    this.lastRxAt = 0
    this.buf = []
    this.received = []
    this.recvSize = -1
    this.recvName = ''
    this.phase = '发送请求 C'
    this._emit(0, 0)
    this._sendBytes([C])
    this.ctx.log('info', '开始读取：已发送请求 C，等待发送方块0...')
  },

  cancel() {
    if (this.state === 'idle' || this.state === 'done') return
    this.ctx.log('warn', '传输已取消')
    if (this.mode === 'send') this._sendBytes([CAN, CAN])
    this._abort()
  },

  _abort() {
    this.state = 'cancel'
    this.mode = null
    this.phase = '已取消'
    this.buf = []
  },

  // ---------- 状态机驱动 ----------

  onRx(frame) {
    if (this.state === 'idle' || this.state === 'done') return
    const b = frame && frame.bytes
    if (!b || b.length === 0) return
    for (const x of b) this.buf.push(x & 0xff)
    this.lastRxAt = Date.now()
    try {
      this._drain()
    } catch (e) {
      this.ctx.log('error', `处理异常: ${e instanceof Error ? e.message : String(e)}`)
      this._abort()
    }
  },

  /** 从缓冲中逐帧解析处理（YMODEM 为字节流，需要累积） */
  _drain() {
    while (this.buf.length > 0 && this.state !== 'idle' && this.state !== 'done' && this.state !== 'cancel') {
      const first = this.buf[0]
      if (this.mode === 'recv') {
        if (first === SOH || first === STX) {
          const need = first === STX ? 3 + 1024 + 2 : 3 + 128 + 2
          if (this.buf.length < need) return // 等待整块
          const frame = this.buf.splice(0, need)
          this._recvHandleBlock(frame)
          continue
        }
        if (first === EOT) {
          this.buf.shift()
          this._recvHandleEot()
          continue
        }
        if (first === CAN) {
          this.buf.shift()
          this.ctx.log('error', '发送方请求取消 (CAN)')
          this._abort()
          continue
        }
        // 未知字节丢弃
        this.buf.shift()
        continue
      } else {
        // 发送模式：只关心控制字节
        if (first === ACK || first === NAK || first === CAN || first === C) {
          this.buf.shift()
          this._sendHandleCtrl(first)
          continue
        }
        this.buf.shift()
      }
    }
  },

  // ---------- 发送模式处理 ----------

  _sendHandleCtrl(c) {
    if (this.state === 'wait_c') {
      if (c === C) {
        this.state = 'block0'
        this.retry = 0
        this.phase = '发送块0'
        this._sendBytes(buildBlock0(this.file.name, this.totalSize)).then(() => {
          this.lastRxAt = Date.now()
        })
      }
      // 收到 NAK 表示校验和模式，本协议仅支持 CRC，忽略等待 C
      return
    }
    if (c === CAN) {
      this.ctx.log('error', '接收方请求取消 (CAN)')
      this._abort()
      return
    }
    if (this.state === 'block0') {
      if (c === ACK) {
        this.blk = 1
        this.retry = 0
        this.state = 'data'
        this.phase = '发送数据'
        this._sendNextData()
      } else if (c === NAK) {
        this._retrySend(() => buildBlock0(this.file.name, this.totalSize), '块0')
      }
      return
    }
    if (this.state === 'data') {
      if (c === ACK) {
        this.retry = 0
        this._sendNextData()
      } else if (c === NAK) {
        this._retrySend(this._lastFrame, '数据块')
      }
      return
    }
    if (this.state === 'eot') {
      if (c === ACK) {
        this.state = 'done'
        this.phase = '完成'
        this._emit(100, this.blk)
        this.ctx.log('info', `下发完成：共 ${this.blk} 块`)
      } else if (c === NAK) {
        this._retrySend(null, 'EOT', () => this._sendBytes([EOT]))
      }
      return
    }
    if (this.state === 'done') {
      // 对端可能再发一个 ACK 确认第二个 EOT，忽略
    }
  },

  _sendNextData() {
    if (!this.file || this.sentSize >= this.totalSize) {
      this.state = 'eot'
      this.phase = '发送 EOT'
      this.retry = 0
      this._sendBytes([EOT]).then(() => { this.lastRxAt = Date.now() })
      return
    }
    const remain = this.totalSize - this.sentSize
    const dataLen = this.blockSize
    const chunk = this.file.bytes.slice(this.sentSize, this.sentSize + Math.min(remain, dataLen))
    const frame = buildBlock(this.blk, chunk, dataLen)
    this._lastFrame = frame
    this.sentSize += chunk.length
    this.blk++
    this._emit((this.sentSize / this.totalSize) * 100, this.blk - 1)
    this.ctx.log('info', `发送块 ${this.blk - 1}（${chunk.length} 字节，累计 ${this.sentSize}/${this.totalSize}）`)
    this._sendBytes(frame).then(() => { this.lastRxAt = Date.now() })
  },

  _retrySend(frame, label, senderFn) {
    if (this.retry >= this.retries) {
      this.ctx.log('error', `${label} 重试 ${this.retries} 次仍失败，传输终止`)
      this._abort()
      return
    }
    this.retry++
    this.ctx.log('warn', `${label} 收到 NAK，第 ${this.retry} 次重发`)
    if (senderFn) senderFn()
    else this._sendBytes(frame)
  },

  // ---------- 接收模式处理 ----------

  _recvHandleBlock(frame) {
    const parsed = parseBlock(frame)
    if (!parsed) {
      this.ctx.log('warn', '数据块校验失败，请求重发 (NAK)')
      this._sendBytes([NAK])
      return
    }
    if (this.state === 'wait_c' || this.state === 'block0') {
      if (parsed.blockNo !== 0) {
        this.ctx.log('warn', `期望块0，实际收到 ${parsed.blockNo}`)
        this._sendBytes([NAK])
        return
      }
      const meta = parseBlock0Meta(parsed.data)
      this.recvName = meta.filename
      this.recvSize = meta.size
      this.blk = 1
      this.state = 'data'
      this.phase = '接收数据'
      this._sendBytes([ACK])
      this.ctx.log('info', `收到块0：文件名=${this.recvName || '?'}，大小=${this.recvSize >= 0 ? this.recvSize : '未知'}`)
      return
    }
    if (this.state === 'data') {
      if (parsed.blockNo !== (this.blk & 0xff)) {
        this.ctx.log('warn', `块号不符：期望 ${this.blk}，实际 ${parsed.blockNo}，请求重发`)
        this._sendBytes([NAK])
        return
      }
      // 去掉尾部 0x1A 填充
      let n = parsed.data.length
      while (n > 0 && parsed.data[n - 1] === SUB) n--
      this.received.push(...parsed.data.slice(0, n))
      this.blk++
      this._sendBytes([ACK])
      const total = this.recvSize >= 0 ? this.recvSize : this.received.length
      this._emit(total > 0 ? (this.received.length / total) * 100 : 0, this.blk - 1)
      this.ctx.log('info', `接收块 ${parsed.blockNo}（累计 ${this.received.length} 字节）`)
      return
    }
    // 其它状态收到块，忽略或 NAK
    this._sendBytes([NAK])
  },

  _recvHandleEot() {
    if (this.state !== 'data') {
      this.ctx.log('warn', 'EOT 出现在非数据阶段，忽略')
      return
    }
    this.state = 'done'
    this.phase = '保存文件'
    this._sendBytes([ACK, NAK]) // ACK 确认 EOT，NAK 请求下一个文件（本协议无后续文件）
    this._emit(100, this.blk - 1)
    this._saveReceived()
  },

  _saveReceived() {
    const bytes = this.received || []
    const name = this.saveName || this.recvName || 'ymodem-received.bin'
    this.ctx.saveFile(name, bytes)
      .then(path => {
        this.ctx.log('info', `读取完成：已保存 ${bytes.length} 字节 → ${path}`)
      })
      .catch(err => {
        this.ctx.log('error', `保存文件失败: ${err && err.message ? err.message : String(err)}`)
      })
  },

  // ---------- 超时看门狗 ----------

  onTick(now) {
    if (this.state === 'idle' || this.state === 'done' || this.state === 'cancel') return
    if (!this.lastRxAt) return
    const waitStates = this.mode === 'recv'
      ? ['wait_c', 'block0', 'data']
      : ['wait_c', 'block0', 'data', 'eot']
    if (!waitStates.includes(this.state)) return
    if (now - this.lastRxAt < this.timeoutMs) return
    // 超时：发送方重试当前块 / 接收方重发请求 C
    if (this.mode === 'recv') {
      if (this.state === 'wait_c') {
        this._sendBytes([C])
        this.lastRxAt = now
      } else {
        this.ctx.log('warn', `等待数据超时，请求重发 (NAK)`)
        this._sendBytes([NAK])
        this.lastRxAt = now
      }
    } else {
      if (this.state === 'wait_c') {
        this.ctx.log('warn', `等待 'C' 超时（${this.timeoutMs}ms），仍等待...`)
        this.lastRxAt = now
      } else if (this.state === 'block0' || this.state === 'data') {
        this._retrySend(this._lastFrame, '数据块')
        this.lastRxAt = now
      } else if (this.state === 'eot') {
        this._retrySend(null, 'EOT', () => this._sendBytes([EOT]))
        this.lastRxAt = now
      }
    }
  },

  runAction(actionId) {
    if (actionId === 'start_send') this.startSend()
    else if (actionId === 'start_recv') this.startRecv()
    else if (actionId === 'cancel') this.cancel()
  },

  getVariables() {
    return [
      { key: 'progress', label: '进度 %', unit: '%' },
      { key: 'blocks', label: '已收/已发块', unit: '' },
    ]
  },
}

export { crc16Xmodem, buildBlock, buildBlock0, parseBlock, parseBlock0Meta }
