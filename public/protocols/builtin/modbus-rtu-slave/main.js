/**
 * Modbus RTU 从站 —— 内置参考协议
 *
 * 特性：维护线圈表与保持寄存器表，应答 01/02/03/04/05/06/0F/10 功能码，
 * CRC16-Modbus 校验；配合 modbus-rtu-master 主站在同一通道上可完成本地主从闭环自测。
 * 输入线圈（02）与输入寄存器（04）按可写存储区原样应答（只读语义），便于一套表同时验证全部功能码。
 * 越界校验：读写地址超出配置的最大线圈 / 寄存器地址时返回异常码 02（地址非法），不会自动创建新单元。
 *
 * 编写约定（从站协议请照此模板）：
 *  - 从站用 match() 判断报文是否属于本设备，handle() 解析并应答（ctx.sendHex）。
 *  - 帧格式：RTU = [地址][功能码][数据...][CRC低][CRC高]，数据部分大端。
 *  - 全部变量经 ctx.emitVar 推送；全中文注释。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.coils = new Map()
    this.registers = new Map()
    this._applyConfig()
    ctx.log('info', `RTU 从站已启动，地址 ${this.addr}，线圈 ${this.coils.size} 个，寄存器 ${this.registers.size} 个`)
  },

  dispose() {
    this.coils.clear()
    this.registers.clear()
  },

  setConfig(patch) {
    this._applyConfig()
    if (patch) this.ctx.log('info', `参数已更新: ${Object.keys(patch).join(', ')}`)
  },

  _applyConfig() {
    this.addr = Number(this.ctx.getParam('addr')) & 0xff || 1
    this.le = this.ctx.getParam('byte_order') === 'le'
    this.coils.clear()
    const rawCoils = this.ctx.getParam('coils')
    let maxCoil = -1
    if (Array.isArray(rawCoils)) {
      for (const r of rawCoils) {
        const addr = Number(r.addr)
        if (Number.isInteger(addr) && addr >= 0 && addr <= 0xffff) {
          this.coils.set(addr, {
            value: r.value ? 1 : 0,
            name: String(r.name || ''),
          })
          if (addr > maxCoil) maxCoil = addr
        }
      }
    }
    // 越界判定上限：无配置时 -1，任何请求都返回地址非法
    this.maxCoil = maxCoil
    this.registers.clear()
    const raw = this.ctx.getParam('registers')
    let maxReg = -1
    if (Array.isArray(raw)) {
      for (const r of raw) {
        const reg = Number(r.reg)
        if (Number.isInteger(reg) && reg >= 0 && reg <= 0xffff) {
          this.registers.set(reg, {
            value: Number(r.value) || 0,
            name: String(r.name || ''),
            unit: String(r.unit || ''),
          })
          if (reg > maxReg) maxReg = reg
        }
      }
    }
    this.maxReg = maxReg
  },

  // ---------- 报文匹配与处理 ----------

  match(frame) {
    const b = frame.bytes
    if (!b || b.length < 4) return false
    // RTU 至少 4 字节：地址+功能码+CRC(2)
    if (b[0] !== this.addr) return false
    const crcStored = (b[b.length - 2] & 0xff) | ((b[b.length - 1] & 0xff) << 8)
    const crcCalc = this.ctx.utils.crc16Modbus(b.slice(0, b.length - 2))
    return crcStored === crcCalc
  },

  handle(frame) {
    const b = frame.bytes
    const func = b[1] & 0xff
    switch (func) {
      case 0x01: this._handleReadCoils(b); break
      case 0x02: this._handleReadCoils(b, 0x02); break
      case 0x03: this._handleReadRegs(b, 0x03); break
      case 0x04: this._handleReadRegs(b, 0x04); break
      case 0x05: this._handleWriteCoil(b); break
      case 0x06: this._handleWriteSingle(b); break
      case 0x0f: this._handleWriteCoils(b); break
      case 0x10: this._handleWriteMulti(b); break
      default: this._replyException(b, 1) // 01: 不支持的功能码
    }
  },

  _handleReadCoils(b, func = 0x01) {
    if (b.length < 8) return
    const start = this._u16(b, 2)
    const count = this._u16(b, 4)
    if (count < 1 || count > 2000) {
      this._replyException(b, 3)
      return
    }
    // 越界：起始地址或结束地址超出配置的线圈范围
    if (start > this.maxCoil || start + count - 1 > this.maxCoil) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    const bits = []
    for (let i = 0; i < count; i++) {
      bits.push(this._coilValue(start + i))
    }
    const bytes = []
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0
      for (let j = 0; j < 8 && i + j < bits.length; j++) {
        if (bits[i + j]) byte |= 1 << j
      }
      bytes.push(byte)
    }
    const body = [this.addr, func, bytes.length, ...bytes]
    this._sendFrame(body)
    this._emitCoils(start, count)
  },

  _handleWriteCoil(b) {
    if (b.length < 8) return
    const addr = this._u16(b, 2)
    const value = this._u16(b, 4)
    if (value !== 0xff00 && value !== 0x0000) {
      this._replyException(b, 3) // 03: 数据非法
      return
    }
    if (addr > this.maxCoil) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    this._setCoil(addr, value === 0xff00 ? 1 : 0)
    // 响应回显请求帧
    this._sendFrame(b.slice(0, 6))
    this._emitCoils(addr, 1)
  },

  _handleWriteCoils(b) {
    if (b.length < 9) return
    const start = this._u16(b, 2)
    const count = this._u16(b, 4)
    if (count < 1 || count > 1968) {
      this._replyException(b, 3)
      return
    }
    if (start > this.maxCoil || start + count - 1 > this.maxCoil) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    const byteCount = b[6]
    for (let i = 0; i < count; i++) {
      const byte = i >> 3
      const bit = i & 7
      const raw = byte < byteCount ? b[7 + byte] : 0
      this._setCoil(start + i, (raw >> bit) & 1)
    }
    // 响应：地址+功能码+起始(2)+数量(2)+CRC
    this._sendFrame([this.addr, 0x0f, ...this._enc16(start), ...this._enc16(count)])
    this._emitCoils(start, count)
  },

  _handleReadRegs(b, func) {
    if (b.length < 8) return
    const start = this._u16(b, 2)
    const count = this._u16(b, 4)
    if (count < 1 || count > 125) {
      this._replyException(b, 3)
      return
    }
    // 越界：起始地址或结束地址超出配置的寄存器范围
    if (start > this.maxReg || start + count - 1 > this.maxReg) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    const data = []
    for (let i = 0; i < count; i++) {
      const v = this._regValue(start + i)
      data.push(...this._enc16(v))
    }
    const body = [this.addr, func, data.length, ...data]
    this._sendFrame(body)
    this._emitRegs(start, count)
  },

  _handleWriteSingle(b) {
    if (b.length < 8) return
    const reg = this._u16(b, 2)
    const value = this._u16(b, 4)
    if (reg > this.maxReg) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    this._setReg(reg, value)
    // 响应回显请求帧
    this._sendFrame(b.slice(0, 6))
    this._emitRegs(reg, 1)
  },

  _handleWriteMulti(b) {
    if (b.length < 9) return
    const start = this._u16(b, 2)
    const count = this._u16(b, 4)
    if (start > this.maxReg || start + count - 1 > this.maxReg) {
      this._replyException(b, 2) // 02: 地址非法
      return
    }
    const byteCount = b[6]
    for (let i = 0; i < count; i++) {
      const v = i * 2 + 1 < byteCount ? this._u16(b, 7 + i * 2) : 0
      this._setReg(start + i, v)
    }
    // 响应：地址+功能码+起始(2)+数量(2)+CRC
    this._sendFrame([this.addr, 0x10, ...this._enc16(start), ...this._enc16(count)])
    this._emitRegs(start, count)
  },

  _replyException(b, code) {
    this._sendFrame([this.addr, b[1] | 0x80, code])
  },

  // ---------- 内部工具 ----------

  _coilValue(addr) {
    const c = this.coils.get(addr)
    return c ? (c.value ? 1 : 0) : 0
  },

  _setCoil(addr, value) {
    const existing = this.coils.get(addr) || { name: '' }
    this.coils.set(addr, { value: value ? 1 : 0, name: existing.name })
  },

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
    const crc = this.ctx.utils.crc16Modbus(body)
    const frame = [...body, crc & 0xff, (crc >> 8) & 0xff]
    const hex = this.ctx.utils.bytesToHex(frame)
    this.ctx.sendHex(hex).catch(err => {
      this.ctx.log('error', `应答发送失败: ${err && err.message ? err.message : String(err)}`)
    })
  },

  _emitCoils(start, count) {
    for (let i = 0; i < count; i++) {
      const addr = start + i
      const c = this.coils.get(addr)
      this.ctx.emitVar({
        valueId: `coil_${addr}`,
        value: this._coilValue(addr),
      })
    }
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
    for (const [addr, c] of this.coils) {
      vars.push({
        key: `coil_${addr}`,
        label: `${c.name || `线圈 ${addr}`} (${addr})`,
        unit: '',
      })
    }
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
