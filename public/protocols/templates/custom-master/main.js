/**
 * custom-master —— 自定义主站协议模板
 *
 * 复制本目录为你的协议包：
 *  1. 修改 manifest.yaml 的 id / name / version（id 需与目录名一致，^[a-z0-9_-]+$）；
 *  2. 按需修改本文件逻辑；main.d.ts 提供 ABI 类型提示；
 *  3. 将目录打成 zip（zip 根层直接含 manifest.yaml）→ 应用内「安装扩展包」。
 *
 * 运行约定：ESM 默认导出；不得 import 外部模块，仅使用注入的 ctx。
 * 主站职责：周期发送查询报文，将应答关联到未决请求，超时重试并推送变量。
 * 典型做法：在 onRx 中按【请求标识（如从站地址 / 事务 ID）】匹配 pending 表。
 */

export default {
  init(ctx) {
    this.ctx = ctx
    this.pending = null
    this.online = false
    this.timer = null
    this._applyConfig()
    this._startTimer()
    this.pollOnce()
    ctx.log('info', '模板主站协议已启动')
  },

  dispose() {
    if (this.timer !== null) this.ctx.timer.clearInterval(this.timer)
    this.timer = null
    this.pending = null
  },

  setConfig(patch) {
    this._applyConfig()
    this.pending = null
    if (patch && ('cycle_ms' in patch || 'command' in patch || 'retry' in patch)) {
      this._startTimer()
      this.pollOnce()
    }
  },

  _applyConfig() {
    const raw = this.ctx.getParam('command') || ''
    this.cmdHex = this.ctx.utils.bytesToHex(this.ctx.utils.hexToBytes(String(raw)))
    this.cycleMs = Math.max(100, Number(this.ctx.getParam('cycle_ms')) || 500)
    this.timeoutMs = Math.max(50, Number(this.ctx.getParam('timeout_ms')) || 300)
    this.retry = Math.max(0, Math.min(10, Number(this.ctx.getParam('retry')) || 2))
  },

  _startTimer() {
    if (this.timer !== null) this.ctx.timer.clearInterval(this.timer)
    this.timer = this.ctx.timer.setInterval(() => this.pollOnce(), this.cycleMs)
  },

  pollOnce() {
    if (!this.cmdHex || this.pending) return
    const p = { sentAt: Date.now(), retries: 0 }
    this.pending = p
    this.ctx.sendHex(this.cmdHex).catch(err => {
      this.ctx.log('error', `发送失败: ${err && err.message ? err.message : String(err)}`)
      this.pending = null
    })
  },

  onRx(frame) {
    // 在此判断应答是否属于当前请求；示例：只接受非空响应
    if (!this.pending) return
    const b = frame.bytes
    if (!b || b.length === 0) return
    this.pending = null
    this._setOnline(true)
    // 示例：把首字节当作一个变量推送，替换为你自己的解码逻辑
    this.ctx.emitVar({ valueId: 'resp', value: b[0] })
    this.ctx.log('info', `收到应答 ${this.ctx.utils.bytesToHex(b)}`)
  },

  onTick(now) {
    if (!this.pending) return
    if (now - this.pending.sentAt < this.timeoutMs) return
    if (this.pending.retries < this.retry) {
      this.pending.retries++
      this.pending.sentAt = now
      this.ctx.sendHex(this.cmdHex).catch(() => {})
    } else {
      this.pending = null
      this._setOnline(false)
      this.ctx.log('warn', '连续超时，判定离线')
    }
  },

  _setOnline(v) {
    if (this.online === v) return
    this.online = v
    this.ctx.emitVar({ valueId: 'online', value: v ? 1 : 0 })
  },

  runAction(actionId) {
    if (actionId === 'poll_once') {
      this.pending = null
      this.pollOnce()
    }
  },

  getVariables() {
    return [
      { key: 'resp', label: '应答字节 0', unit: '' },
      { key: 'online', label: '在线状态', unit: '' },
    ]
  },
}
