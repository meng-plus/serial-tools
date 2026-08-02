/**
 * custom-slave —— 自定义从站协议模板
 *
 * 复制本目录为你的协议包：
 *  1. 修改 manifest.yaml 的 id / name / version（id 需与目录名一致，^[a-z0-9_-]+$）；
 *  2. 按需修改本文件逻辑；main.d.ts 提供 ABI 类型提示；
 *  3. 将目录打成 zip（zip 根层直接含 manifest.yaml）→ 应用内「安装扩展包」。
 *
 * 运行约定：ESM 默认导出；不得 import 外部模块，仅使用注入的 ctx。
 * 从站职责：match() 判断请求是否属于本设备，handle() 解析并构造应答发送。
 * 典型流程：match 校验【地址 / 长度 / 校验】，handle 区分功能码后 ctx.sendHex 回发。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.data = new Map()
    this._applyConfig()
    ctx.log('info', '模板从站协议已启动')
  },

  dispose() {
    this.data.clear()
  },

  setConfig(patch) {
    this._applyConfig()
    if (patch) this.ctx.log('info', `参数已更新: ${Object.keys(patch).join(', ')}`)
  },

  _applyConfig() {
    this.deviceId = Number(this.ctx.getParam('device_id')) & 0xff || 1
    const raw = this.ctx.getParam('registers')
    this.data.clear()
    if (Array.isArray(raw)) {
      for (const r of raw) {
        this.data.set(String(r.key || 'v'), {
          value: Number(r.value) || 0,
          unit: String(r.unit || ''),
        })
      }
    }
  },

  // ---------- 报文匹配与处理 ----------

  match(frame) {
    const b = frame.bytes
    if (!b || b.length < 3) return false
    // 示例：首字节为设备标识即视为本设备请求（替换为你的真实匹配逻辑）
    return b[0] === this.deviceId
  },

  handle(frame) {
    const b = frame.bytes
    // 示例：收到 [标识, 功能码, 键] 形式的读请求，回发 [标识, 功能码, 值低字节, 值高字节]
    const key = String(b[2] ?? 0)
    const rec = this.data.get(key) || { value: 0, unit: '' }
    this.ctx.emitVar({ valueId: key, value: rec.value, unit: rec.unit })
    const reply = [this.deviceId, b[1] & 0xff, rec.value & 0xff, (rec.value >> 8) & 0xff]
    this.ctx.sendHex(this.ctx.utils.bytesToHex(reply)).catch(() => {})
    this.ctx.log('info', `应答 key=${key} value=${rec.value}`)
  },

  getVariables() {
    const vars = []
    for (const [key, rec] of this.data) {
      vars.push({ key, label: key, unit: rec.unit || '' })
    }
    return vars
  },
}
