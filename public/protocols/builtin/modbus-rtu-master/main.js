/**
 * Modbus RTU 主站 —— 内置参考协议
 *
 * 特性：多设备周期轮询、CRC16-Modbus 校验、超时重试与离线标记、参数变更即时生效。
 *
 * 编写约定（新协议请照此模板）：
 *  - 本文件为 ESM，默认导出实现对象；不得 import 外部模块，仅使用注入的 ctx。
 *  - ctx.sendHex / ctx.emitVar / ctx.getParam / ctx.log / ctx.timer / ctx.utils。
 *  - 生命周期：init / dispose / onRx / onTick / setConfig / match+handle(从站) / runAction / getVariables。
 *  - 全中文注释；值样本 key 建议用 ASCII 的 valueId。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.pending = new Map()
    this.online = new Map()
    this.timer = null
    this._applyConfig()
    this._startTimer()
    if (this.cycleMs > 0) this.pollOnce()
    ctx.log('info', `已启动，轮询 ${this.poll.length} 组${this.cycleMs > 0 ? '' : '（轮询已停止）'}`)
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
      if (this.cycleMs > 0) this.pollOnce()
    }
  },

  _applyConfig() {
    const raw = this.ctx.getParam('poll')
    this.poll = Array.isArray(raw) ? raw.map(r => ({ ...r })) : []
    this.cycleMs = Number(this.ctx.getParam('cycle_ms')) || 0
    this.timeoutMs = Math.max(50, Number(this.ctx.getParam('timeout_ms')) || 300)
    this.retry = Math.max(0, Math.min(10, Number(this.ctx.getParam('retry')) || 2))
    this.le = this.ctx.getParam('byte_order') === 'le'
  },

  _startTimer() {
    if (this.timer !== null) this.ctx.timer.clearInterval(this.timer)
    this.timer = null
    if (this.cycleMs > 0) {
      this.timer = this.ctx.timer.setInterval(() => this.pollOnce(), this.cycleMs)
    }
  },

  _baseName(r) {
    const raw = String(r.name || '')
    return (raw || `d${Number(r.addr)}`).replace(/[^A-Za-z0-9_]/g, '_') || `d${Number(r.addr)}`
  },

  _packRead(addr, func, start, count) {
    const body = [
      addr & 0xff,
      func & 0xff,
      (start >> 8) & 0xff,
      start & 0xff,
      (count >> 8) & 0xff,
      count & 0xff,
    ]
    const crc = this.ctx.utils.crc16Modbus(body)
    const frame = [...body, crc & 0xff, (crc >> 8) & 0xff]
    return this.ctx.utils.bytesToHex(frame)
  },

  /** FC06 写单寄存器：地址 + 功能码 0x06 + 寄存器(2) + 值(2) + CRC */
  _packWrite(addr, reg, value) {
    const v = Math.max(0, Math.min(0xffff, Math.round(Number(value) || 0)))
    const body = [
      addr & 0xff,
      0x06,
      (reg >> 8) & 0xff,
      reg & 0xff,
      (v >> 8) & 0xff,
      v & 0xff,
    ]
    const crc = this.ctx.utils.crc16Modbus(body)
    const frame = [...body, crc & 0xff, (crc >> 8) & 0xff]
    return this.ctx.utils.bytesToHex(frame)
  },

  pollOnce() {
    for (const r of this.poll) {
      const addr = Number(r.addr) & 0xff
      const func = Number(r.func) || 3
      const start = Number(r.start) || 0
      const count = Math.max(1, Number(r.count) || 1)
      const key = `${addr}:${func}:${start}:${count}`
      if (this.pending.has(key)) continue
      const p = {
        key,
        addr,
        func,
        start,
        count,
        name: this._baseName(r),
        sentAt: Date.now(),
        retries: 0,
      }
      this.pending.set(key, p)
      this._sendRead(p)
    }
  },

  _sendRead(p) {
    const hex = this._packRead(p.addr, p.func, p.start, p.count)
    this.ctx.sendHex(hex).catch(err => {
      this.ctx.log('error', `发送失败 ${hex}: ${err && err.message ? err.message : String(err)}`)
      this.pending.delete(p.key)
    })
  },

  onRx(frame) {
    const b = frame.bytes
    if (!b || b.length < 5) return
    let hit = null
    for (const p of this.pending.values()) {
      if (p.addr === b[0] && p.func === (b[1] & 0x7f)) {
        hit = p
        break
      }
    }
    if (!hit) return
    const crcStored = (b[b.length - 2] & 0xff) | ((b[b.length - 1] & 0xff) << 8)
    const crcCalc = this.ctx.utils.crc16Modbus(b.slice(0, b.length - 2))
    if (crcStored !== crcCalc) {
      this.ctx.log('warn', `${hit.name} CRC 校验失败`)
      return
    }
    if (b[1] & 0x80) {
      this.ctx.log('warn', `${hit.name} 异常响应，异常码 0x${(b[2] & 0xff).toString(16)}`)
      this.pending.delete(hit.key)
      this._setOnline(hit.addr, false)
      return
    }
    const byteCount = b[2]
    if (b.length < 3 + byteCount + 2) return
    this.pending.delete(hit.key)
    this._setOnline(hit.addr, true)
    const regs = []
    for (let i = 0; i < byteCount; i += 2) {
      const hi = b[3 + i] & 0xff
      const lo = b[4 + i] & 0xff
      regs.push(this.le ? (lo << 8) | hi : (hi << 8) | lo)
    }
    regs.forEach((v, i) => {
      this.ctx.emitVar({ valueId: `${hit.name}_${hit.start + i}`, value: v })
    })
    this.ctx.log('info', `${hit.name} 读取 ${regs.length} 个寄存器`)
  },

  onTick(now) {
    for (const p of [...this.pending.values()]) {
      if (now - p.sentAt < this.timeoutMs) continue
      if (p.retries < this.retry) {
        p.retries++
        p.sentAt = now
        this._sendRead(p)
      } else {
        this.pending.delete(p.key)
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

  runAction(actionId, args = {}) {
    if (actionId === 'read_all') {
      this.pending.clear()
      this.pollOnce()
    } else if (actionId === 'clear_offline') {
      this.online.clear()
    } else if (actionId === 'write_reg') {
      this._writeReg(args)
    }
  },

  /** 双击写值：FC06 写单寄存器；写后清除该轮询组的 pending，随后读回刷新 */
  async _writeReg(args = {}) {
    const addr = Number(args.addr ?? args.device) & 0xff
    const reg = Number(args.reg ?? args.addr) & 0xffff
    if (!addr) {
      this.ctx.log('warn', 'write_reg: 缺少从站地址')
      return
    }
    const value = args.value
    if (value === undefined || value === '') {
      this.ctx.log('warn', 'write_reg: 缺少值')
      return
    }
    const hex = this._packWrite(addr, reg, value)
    try {
      await this.ctx.sendHex(hex)
      this.ctx.log('info', `写入从站 ${addr} 寄存器 ${reg} = ${value}`)
      // 触发一次读回（若该地址在轮询表中）
      const hit = this.poll.find(
        r => (Number(r.addr) & 0xff) === addr && reg >= Number(r.start) && reg < Number(r.start) + Math.max(1, Number(r.count) || 1),
      )
      if (hit) {
        this.pending.clear()
        this.pollOnce()
      }
    } catch (err) {
      this.ctx.log('error', `write_reg 发送失败: ${err && err.message ? err.message : String(err)}`)
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
