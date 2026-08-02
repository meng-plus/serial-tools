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
| `runAction(actionId, args)` | 可选 | 仪表盘按钮 / 管理页动作触发 |
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
                              // 推送数值样本 → 监控 / 图表 / 数据导出 / 仪表盘（ruleId 固定为协议 id）

  log(level: 'info'|'warn'|'error', msg: string): void,
                              // 写入协议运行日志（管理页显示）

  getParam(key: string): unknown,
                              // 读取当前参数值（manifest 默认值 或 用户修改值）

  timer: {
    setTimeout(cb, ms): number
    setInterval(cb, ms): number
    clearTimeout(id): void
    clearInterval(id): void
  },                        // dispose 时自动清理

  utils: { ... },           // 见下
}
```

## utils

通用字节 / 校验 / 解码工具（`buildProtocolUtils`，复用既有二进制规则引擎）。

| 方法 | 说明 |
|------|------|
| `hexToBytes(hex)` / `bytesToHex(bytes)` / `bytesToHexCompact(bytes)` | hex 与字节互转 |
| `crc16Modbus(bytes): number` | CRC16-Modbus（小端返回） |
| `appendChecksum(payload, algo, endian?)` / `computeChecksum(algo, cover)` / `verifyFrameChecksum(frame, algo, endian?)` | 校验工具（algo 见前端校验目录） |
| `decodeBinary(bytes, fields)` | 按字段表（offset + 类型 + scale + bias）解码，返回 `{ name, value, unit, numberValue?, valueId? }` |
| `u16/i16/u32/f32(bytes, offset, endian?)` | 读数值 |
| `encodeU16(value, endian?)` / `encodeU32(value, endian?)` | 写数值（追加模式返回字节） |

## 关键约定

- **发送数据一律走 `ctx.sendHex`**，不要调其它 invoke。应答 / 轮询报文都由它发出。
- **数值必须经 `ctx.emitVar` 推送** 才能进监控 / 图表 / 数据导出 / 仪表盘。
- **从站用 `match`+`handle`**（不要在从站里写 `onRx`，运行时按 role 分发）。`match` 内做完整校验（地址、长度、CRC），保证无关报文不误处理。
- `onTick` 不要做重型计算；50ms 粒度足够超时重试等轻量逻辑。
- `setConfig` 在参数变更后立即调用，通常需要：清空 in-flight 请求 → 重启定时器 → 强制重发一轮，避免参数生效滞后。
- 值样本 key（`valueId`）建议用 ASCII（如 `temp`、`reg_0`），便于 CSV/JSON 导出与图表绑定。
- 全中文注释是仓库约定。
