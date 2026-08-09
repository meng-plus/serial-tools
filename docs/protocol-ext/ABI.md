# 协议实现体（main.js）API —— ABI

main.js 是 ESM 模块，**默认导出**一个实现对象。不得 `import` 任何外部模块——运行时代码只应依赖注入的 `ctx`。类型定义见 `src/protocol-ext/types.ts`（模板里的 `main.d.ts` 为编辑器提供同样提示）。

## 生命周期钩子

| 钩子 | 是否必选 | 说明 |
|------|---------|------|
| `init(ctx)` | ✅ 必选 | 启动：读参数、注册定时器、发起首轮轮询 |
| `dispose()` | 可选 | 实例停止 / 移除：清理额外资源（ctx.timer 定时器自动清理） |
| `onRx(frame)` | 可选 | 通道收到数据。passive/master 用；slave 用 match+handle |
| `onTick(now)` | 可选 | 定时驱动：运行时统一每 ~50ms 调用，自判时间间隔（用 `Date.now()` / 入参 now） |
| `setConfig(patch)` | 可选 | 参数变更即时生效（例如清空 pending + 重启定时器 + 强制重发一轮） |
| `match(frame)` | slave 必选 | 判断报文是否属于本设备（校验地址/长度/CRC） |
| `handle(frame)` | slave 必选 | 匹配后解析并应答（`ctx.sendHex` 回发） |
| `runAction(actionId, args)` | 可选 | 协议面板按钮 / 管理页动作触发 |
| `getVariables()` | 可选 | 动态变量表（与 manifest `ui.variables` 并集） |
`frame`（`RxRecord`）字段：

```ts
{ seq?: number; channelId: string; timestamp: string; direction: 'rx'|'tx'; hex: string; text: string; bytes: number[] }
```

> **收发分开订阅**：协议引擎通过 `rxHub.subscribe(fn, { direction: 'rx' })` 只订阅真实接收（rx），`tx`（本端自己 `sendHex` 发出的数据）只进终端/转发展示，**不会**回灌给协议引擎——否则从站会 match 到自己的应答帧造成自应答死循环。前端总线 `rxHub` 的订阅接口支持 `{ direction?: 'rx'|'tx'|'all'; channelId?: string }`，默认 all + 全部通道。

## ctx（ProtocolContext）

`init(ctx)` 传入的上下文对象：

```ts
ctx = {
  channelId: string,          // 绑定通道 id
  instanceId: string,         // 实例 id

  sendHex(hex: string): Promise<{ bytesSent: number; seq: number }>,
                              // 经 send_data 发送 hex（无后缀追加）；发送成功后自动推入 txHub

  emitVar({ valueId, value, unit?, timestamp? }): void,
                              // 推送数值样本 → 监控 / 图表 / 数据导出（ruleId 固定为协议 id）
                              // **仅数值**；文本/状态请用 emitInfo

  emitInfo({ key, text, label?, level? }): void,
                              // 推送文本/状态查询结果 → 面板 info_panel（不进 valueBus）
                              // level: 'info'|'warn'|'error'

  emitProgress({ id, current, total, label?, done? }): void,
                              // 长事务进度 → 面板 progress 控件（OTA / 文件传输）
                              // done=true 表示结束（成功或失败）

  applyQuery(actionId, data): boolean,
                              // 按 manifest.ui.queries 将结构化 data 绑定到 emitInfo / setParam
                              // data 支持点分路径（如 upgrade.addr_start）；无匹配返回 false

  request({ hex, match, timeout?, retry? }): Promise<{ bytes, hex }>,
                              // 主站请求–应答：sendHex 后等待本通道 rx 命中 match
                              // timeout 默认 1000ms；retry 为额外重试次数；实例停止时取消

  setParam(patch: Record<string, unknown>): void,
                              // 合并回写实例参数 → 同步参数表单；实例运行中触发 setConfig
                              // 用于查询结果落到可编辑配置（如 APP 起始地址）

  log(level: 'info'|'warn'|'error', msg: string): void,
                              // 写入协议运行日志（管理页显示）

  getParam(key: string): unknown,
                              // 读取当前参数值（manifest 默认值 或 用户修改值）

  getFile(key: string): { name: string; bytes: number[] } | null,
                              // 读取 file 类型参数的真实字节；未选择或会话重启后缓存失效返回 null

  saveFile(name: string, bytes: number[]): Promise<string>,
                              // 保存二进制到磁盘：Tauri 写 exports/ 并返回绝对路径；浏览器触发下载

  timer: {
    setTimeout(cb, ms): number
    setInterval(cb, ms): number
    clearTimeout(id): void
    clearInterval(id): void
  },                        // dispose 时自动清理

  utils: { ... },           // 见下
}
```

> **file 参数与工作区持久化**：file 参数值只保存 `{ name, size, token }` 元数据，
> 真实字节存运行时瞬态缓存（`src/protocol-ext/fileCache.ts`），**不写入工作区 YAML**。
> 因此重启应用后需在参数配置里重新选择文件。`ctx.getFile` 返回 `null` 时协议应给出提示。

## utils

通用字节 / 校验 / 解码工具（`buildProtocolUtils`，复用既有二进制规则引擎）。

| 方法 | 说明 |
|------|------|
| `hexToBytes(hex)` / `bytesToHex(bytes)` / `bytesToHexCompact(bytes)` | hex 与字节互转 |
| `crc16Modbus(bytes): number` | CRC16-Modbus（小端返回） |
| `crc16Xmodem(bytes): number` | CRC16-XMODEM（poly 0x1021，初值 0x0000，YMODEM 传输用） |
| `appendChecksum(payload, algo, endian?)` / `computeChecksum(algo, cover)` / `verifyFrameChecksum(frame, algo, endian?)` | 校验工具（algo 见前端校验目录） |
| `decodeBinary(bytes, fields)` | 按字段表（offset + 类型 + scale + bias）解码，返回 `{ name, value, unit, numberValue?, valueId? }` |
| `u16/i16/u32/f32(bytes, offset, endian?)` | 读数值 |
| `encodeU16(value, endian?)` / `encodeU32(value, endian?)` | 写数值（追加模式返回字节） |

## 关键约定

- **发送数据一律走 `ctx.sendHex`**，不要调其它 invoke。应答 / 轮询报文都由它发出。
- **数值必须经 `ctx.emitVar` 推送** 才能进监控 / 图表 / 数据导出。
- **从站用 `match`+`handle`**（不要在从站里写 `onRx`，运行时按 role 分发）。`match` 内做完整校验（地址、长度、CRC），保证无关报文不误处理。
- `onTick` 不要做重型计算；50ms 粒度足够超时重试等轻量逻辑。
- `setConfig` 在参数变更后立即调用，通常需要：清空 in-flight 请求 → 重启定时器 → 强制重发一轮，避免参数生效滞后。
- 值样本 key（`valueId`）建议用 ASCII（如 `temp`、`reg_0`），便于 CSV/JSON 导出与图表绑定。
- **字节流协议（YMODEM 等）请在 `onRx` 里做字节累积**：串口分帧按超时切帧，一个 1024B 突发块可能被切碎或与相邻字节合并。协议实现应维护自己的字节缓冲，按帧头（SOH/STX/ACK/NAK/CAN/EOT）自行解析整块，再配合 `onTick` 做超时重试。可参考 `public/protocols/demo/ymodem/main.js`。
- 全中文注释是仓库约定。
