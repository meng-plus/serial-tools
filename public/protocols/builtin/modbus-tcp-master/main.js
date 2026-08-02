/**
 * Modbus TCP 主站 —— 内置参考协议（MBAP 封装）
 *
 * 与 RTU 主站同特性的精简实现：多设备轮询、事务 ID 关联、超时重试与离线标记。
 * 组帧：事务ID(2) + 协议ID(0x0000,2) + 长度(2) + 从站地址(1) + 功能码 + 数据。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.pending = new Map()
    this.online = new Map()
    this.timer = null
    this.txId = 1
    this._applyConfig()
    this._startTimer()
    this.pollOnce()
    ctx.log('info', `已启动，轮询 ${this.poll.length} 组`)
  },

  dispose() {
    if (this.timer !== null) this.ctx.timer.clearInterval(this.timer)
    this.timer = null
    this.pending.clear()
  },

  setConfig(patch) {
    this._applyConfig()
    if (patch && ('cycle_ms' in patch || 'poll' in patch || 'retry' in patch)) {
      this.pending.clear()
      this._startTimer()
      this.pollOnce()
    }
  },

  _applyConfig() {
    const raw = this.ctx.getParam('poll')
    this.poll = Array.isArray(raw) ? raw.map(r => ({ ...r })) : []
    this.cycleMs = Math.max(100, Number(this.ctx.getParam('cycle_ms')) || 500)
    this.timeoutMs = Math.max(50, Number(this.ctx.getParam('timeout_ms')) || 500)
    this.retry = Math.max(0, Math.min(10, Number(this.ctx.getParam('retry')) || 2))
    this.le = this.ctx.getParam('byte_order') === 'le'
  },

  _startTimer() {
    if (this.timer !== null) this.ctx.timer.clearInterval(this.timer)
    this.timer = this.ctx.timer.setInterval(() => this.pollOnce(), this.cycleMs)
  },

  _baseName(r) {
    const raw = String(r.name || '')
    return (raw || `d${Number(r.addr)}`).replace(/[^A-Za-z0-9_]/g, '_') || `d${Number(r.addr)}`
  },

  _nextTxId() {
    const id = this.txId & 0xffff
    this.txId = (this.txId + 1) & 0xffff
    return id
  },

  _packRead(txId, addr, func, start, count) {
    const pdu = [addr & 0xff, func & 0xff, (start >> 8) & 0xff, start & 0xff, (count >> 8) & 0xff, count & 0xff]
    const len = pdu.length
    const frame = [
      (txId >> 8) & 0xff,
      txId & 0xff,
      0x00,
      0x00,
      (len >> 8) & 0xff,
      len & 0xff,
      ...pdu,
    ]
    return this.ctx.utils.bytesToHex(frame)
  },

  pollOnce() {
    for (const r of this.poll) {
      const addr = Number(r.addr) & 0xff
      const func = Number(r.func) || 3
      const start = Number(r.start) || 0
      const count = Math.max(1, Number(r.count) || 1)
      const key = `${addr}:${func}:${start}:${count}`
      if (this.pending.size >= 32) continue
      if ([...this.pending.values()].some(p => p.key === key)) continue
      const txId = this._nextTxId()
      const p = {
        key,
        txId,
        addr,
        func,
        start,
        count,
        name: this._baseName(r),
        sentAt: Date.now(),
        retries: 0,
      }
      this.pending.set(txId, p)
      this._sendRead(p)
    }
  },

  _sendRead(p) {
    const hex = this._packRead(p.txId, p.addr, p.func, p.start, p.count)
    this.ctx.sendHex(hex).catch(err => {
      this.ctx.log('error', `发送失败 ${hex}: ${err && err.message ? err.message : String(err)}`)
      this.pending.delete(p.txId)
    })
  },

  onRx(frame) {
    const b = frame.bytes
    if (!b || b.length < 9) return
    const txId = ((b[0] & 0xff) << 8) | (b[1] & 0xff)
    const p = this.pending.get(txId)
    if (!p) return
    const len = ((b[4] & 0xff) << 8) | (b[5] & 0xff)
    if (b.length < 6 + len) return
    const addr = b[6]
    const func = b[7]
    if (addr !== p.addr || (func & 0x7f) !== p.func) return
    this.pending.delete(txId)
    if (func & 0x80) {
      this.ctx.log('warn', `${p.name} 异常响应，异常码 0x${(b[8] & 0xff).toString(16)}`)
      this._setOnline(p.addr, false)
      return
    }
    const byteCount = b[8]
    if (b.length < 9 + byteCount) return
    this._setOnline(p.addr, true)
    const regs = []
    for (let i = 0; i < byteCount; i += 2) {
      const hi = b[9 + i] & 0xff
      const lo = b[10 + i] & 0xff
      regs.push(this.le ? (lo << 8) | hi : (hi << 8) | lo)
    }
    regs.forEach((v, i) => {
      this.ctx.emitVar({ valueId: `${p.name}_${p.start + i}`, value: v })
    })
    this.ctx.log('info', `${p.name} 读取 ${regs.length} 个寄存器`)
  },

  onTick(now) {
    for (const p of [...this.pending.values()]) {
      if (now - p.sentAt < this.timeoutMs) continue
      if (p.retries < this.retry) {
        p.retries++
        p.sentAt = now
        this._sendRead(p)
      } else {
        this.pending.delete(p.txId)
        this._setOnline(p.addr, false)
        this.ctx.log('warn', `${p.name} 连续 ${p.retries + 1} 次超时，判定离线`)
      }
    }
  },

  _setOnline(addr, online) {
    const prev = this.online.get(addr)
    if (prev === online) return
    this.online.set(addr, online)
    this.ctx.emitVar({ valueId: `online_${addr}`, value: online ? 1 : 0 })
  },

  runAction(actionId) {
    if (actionId === 'read_all') {
      this.pending.clear()
      this.pollOnce()
    } else if (actionId === 'clear_offline') {
      this.online.clear()
    }
  },

  getVariables() {
    const vars = []
    for (const r of this.poll) {
      const name = this._baseName(r)
      const count = Math.max(1, Number(r.count) || 1)
      const start = Number(r.start) || 0
      for (let i = 0; i < count; i++) {
        vars.push({ key: `${name}_${start + i}`, label: `${name} 寄存器 ${start + i}`, unit: '' })
      }
      vars.push({ key: `online_${Number(r.addr)}`, label: `${name} 在线`, unit: '' })
    }
    return vars
  },
}
