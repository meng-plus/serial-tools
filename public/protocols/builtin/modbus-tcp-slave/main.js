/**
 * Modbus TCP 从站 —— 内置参考协议（MBAP 封装）
 *
 * 帧格式：事务ID(2) + 协议ID(0x0000,2) + 长度(2) + 从站地址(1) + 功能码 + 数据。
 * 应答复用请求的事务 ID；寄存器表与逻辑同 modbus-rtu-slave。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.registers = new Map()
    this._applyConfig()
    ctx.log('info', `TCP 从站已启动，地址 ${this.unit}，寄存器 ${this.registers.size} 个`)
  },

  dispose() {
    this.registers.clear()
  },

  setConfig(patch) {
    this._applyConfig()
    if (patch) this.ctx.log('info', `参数已更新: ${Object.keys(patch).join(', ')}`)
  },

  _applyConfig() {
    this.unit = Number(this.ctx.getParam('unit')) & 0xff || 1
    this.le = this.ctx.getParam('byte_order') === 'le'
    const raw = this.ctx.getParam('registers')
    this.registers.clear()
    if (Array.isArray(raw)) {
      for (const r of raw) {
        const reg = Number(r.reg)
        if (Number.isInteger(reg) && reg >= 0 && reg <= 0xffff) {
          this.registers.set(reg, {
            value: Number(r.value) || 0,
            name: String(r.name || ''),
            unit: String(r.unit || ''),
          })
        }
      }
    }
  },

  // ---------- 报文匹配与处理 ----------

  match(frame) {
    const b = frame.bytes
    if (!b || b.length < 7) return false
    const protoId = ((b[2] & 0xff) << 8) | (b[3] & 0xff)
    if (protoId !== 0) return false
    const len = ((b[4] & 0xff) << 8) | (b[5] & 0xff)
    if (b.length < 6 + len || len < 2) return false
    return b[6] === this.unit
  },

  handle(frame) {
    const b = frame.bytes
    const func = b[7] & 0xff
    if (func === 0x03) {
      this._handleRead(b)
    } else if (func === 0x06) {
      this._handleWriteSingle(b)
    } else if (func === 0x10) {
      this._handleWriteMulti(b)
    } else {
      this._replyException(b, 1)
    }
  },

  _mbap(b, pduLen) {
    // 事务ID + 协议ID(0) + 长度
    return [b[0], b[1], 0x00, 0x00, (pduLen >> 8) & 0xff, pduLen & 0xff, this.unit]
  },

  _handleRead(b) {
    if (b.length < 12) return
    const start = this._u16(b, 8)
    const count = this._u16(b, 10)
    if (count < 1 || count > 125) {
      this._replyException(b, 3)
      return
    }
    const data = []
    for (let i = 0; i < count; i++) {
      data.push(...this._enc16(this._regValue(start + i)))
    }
    const pdu = [0x03, data.length, ...data]
    this._sendFrame([...this._mbap(b, pdu.length), ...pdu])
    this._emitRegs(start, count)
  },

  _handleWriteSingle(b) {
    if (b.length < 12) return
    const reg = this._u16(b, 8)
    const value = this._u16(b, 10)
    this._setReg(reg, value)
    // 响应回显整个请求帧（MBAP + 功能码 + 寄存器 + 值）
    this._sendFrame(b.slice(0, 12))
    this._emitRegs(reg, 1)
  },

  _handleWriteMulti(b) {
    if (b.length < 13) return
    const start = this._u16(b, 8)
    const count = this._u16(b, 10)
    const byteCount = b[12]
    for (let i = 0; i < count; i++) {
      const v = i * 2 + 1 < byteCount ? this._u16(b, 13 + i * 2) : 0
      this._setReg(start + i, v)
    }
    const pdu = [0x10, ...this._enc16(start), ...this._enc16(count)]
    this._sendFrame([...this._mbap(b, pdu.length), ...pdu])
    this._emitRegs(start, count)
  },

  _replyException(b, code) {
    const pdu = [b[7] | 0x80, code]
    this._sendFrame([...this._mbap(b, pdu.length), ...pdu])
  },

  // ---------- 内部工具 ----------

  _regValue(reg) {
    const r = this.registers.get(reg)
    return r ? Math.max(0, Math.min(0xffff, Math.round(r.value))) : 0
  },

  _setReg(reg, value) {
    const existing = this.registers.get(reg) || { name: '', unit: '' }
    this.registers.set(reg, { value: value & 0xffff, name: existing.name, unit: existing.unit })
  },

  _enc16(v) {
    const n = v & 0xffff
    return this.le ? [n & 0xff, (n >> 8) & 0xff] : [(n >> 8) & 0xff, n & 0xff]
  },

  _u16(b, offset) {
    const hi = b[offset] & 0xff
    const lo = b[offset + 1] & 0xff
    return this.le ? (lo << 8) | hi : (hi << 8) | lo
  },

  _sendFrame(body) {
    const hex = this.ctx.utils.bytesToHex(body)
    this.ctx.sendHex(hex).catch(err => {
      this.ctx.log('error', `应答发送失败: ${err && err.message ? err.message : String(err)}`)
    })
  },

  _emitRegs(start, count) {
    for (let i = 0; i < count; i++) {
      const reg = start + i
      const r = this.registers.get(reg)
      this.ctx.emitVar({
        valueId: `reg_${reg}`,
        value: this._regValue(reg),
        unit: r ? r.unit : '',
      })
    }
  },

  getVariables() {
    const vars = []
    for (const [reg, r] of this.registers) {
      vars.push({
        key: `reg_${reg}`,
        label: `${r.name || `寄存器 ${reg}`} (${reg})`,
        unit: r.unit || '',
      })
    }
    return vars
  },
}
