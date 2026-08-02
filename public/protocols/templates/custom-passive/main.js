/**
 * custom-passive —— 自定义被动解析协议模板
 *
 * 复制本目录为你的协议包：
 *  1. 修改 manifest.yaml 的 id / name / version（id 需与目录名一致，^[a-z0-9_-]+$）；
 *  2. 按需修改本文件逻辑；main.d.ts 提供 ABI 类型提示；
 *  3. 将目录打成 zip（zip 根层直接含 manifest.yaml）→ 应用内「安装扩展包」。
 *
 * 运行约定：ESM 默认导出；不得 import 外部模块，仅使用注入的 ctx。
 * 常见用途：按分隔符 / 固定头分帧，逐字段解码并 emitVar 送入监控、图表与数据导出。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.buf = []
    this._apply()
    ctx.log('info', '模板被动协议已启动')
  },

  dispose() {
    this.buf = []
  },

  setConfig(patch) {
    this._apply()
    this.buf = []
    if (patch) this.ctx.log('info', `参数已更新: ${Object.keys(patch).join(', ')}`)
  },

  _apply() {
    const raw = this.ctx.getParam('fields')
    this.fields = Array.isArray(raw)
      ? raw.map(f => ({
          name: String(f.name || 'v'),
          offset: Number(f.offset) || 0,
          type: String(f.type || 'u16be'),
          scale: Number(f.scale) || 1,
          bias: Number(f.bias) || 0,
          unit: String(f.unit || ''),
        }))
      : []
    this.eol = this.ctx.getParam('eol') === 'crlf' ? [0x0d, 0x0a] : [0x0a]
  },

  onRx(frame) {
    this.buf.push(...frame.bytes)
    while (true) {
      const idx = this._findEol(this.buf)
      if (idx < 0) break
      const line = this.buf.splice(0, idx + this.eol.length)
      this._handleLine(line)
    }
  },

  _findEol(buf) {
    for (let i = 0; i + this.eol.length <= buf.length; i++) {
      let ok = true
      for (let j = 0; j < this.eol.length; j++) {
        if (buf[i + j] !== this.eol[j]) {
          ok = false
          break
        }
      }
      if (ok) return i
    }
    return -1
  },

  _handleLine(line) {
    const decoded = this.ctx.utils.decodeBinary(line, this.fields)
    for (const f of decoded) {
      if (f.numberValue != null) {
        this.ctx.emitVar({
          valueId: f.valueId || f.name,
          value: f.numberValue,
          unit: f.unit,
        })
      }
    }
    this.ctx.log('info', `解析帧 ${this.ctx.utils.bytesToHex(line)} → ${decoded.length} 字段`)
  },
}
