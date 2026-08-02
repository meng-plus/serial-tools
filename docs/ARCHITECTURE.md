# Serial Tools 架构文档

> 基于实际代码校对，2026-08-02（v0.1.0 基线 + S1–S5 规范化）
> 配套：[DESIGN-DECISIONS.md](./DESIGN-DECISIONS.md) · [ROADMAP.md](./ROADMAP.md) · [COMMUNICATION-ARCH-REFINEMENT.md](./COMMUNICATION-ARCH-REFINEMENT.md)

## 0. 能力基线（已实现 / 计划中）

| 能力 | 状态 | 说明 |
|------|------|------|
| UART / RS485 半双工标记 | ✅ | `DuplexMode::Half`；无软件 DE/RTS |
| TCP Client（3s 连接超时） | ✅ | |
| TCP Server 多客户端 | ✅ | 每客户端独立 `tcp_client-{addr}` 通道 |
| 踢客户端 / 列表 / 事件刷新 | ✅ | `disconnect_client` + `server_clients` |
| 终端 RX/TX | ✅ | **事件驱动** `rx-data`；TX 用 `send_data` 回包 |
| 编码 UTF-8 / GBK / HEX | ✅ | 显示前端；GBK 发送走 `encoding_rs` |
| 数据总线转发 | ✅ | RxToBus 订 `rx_broadcast`，不抢读 |
| 断开原因 local/remote/error | ✅ | 优雅 FIN vs RST |
| 自定义右键菜单 | ✅ | 替代浏览器默认菜单 |
| MQTT | ⏳ 占位 | `mqtt.rs` stub，无 UI |
| UDP | ❌ 未实现 | 勿写成已交付 |
| 协议解析管线 | 🚧 前端引擎 | 见 protocol-multi-view；后端 `protocol.rs` 仍 stub |
| 协议扩展系统（protocol-ext） | ✅ 前端运行时 | 前端 JS 脚本 + manifest.yaml；新增协议免重编译。后端 `protocol_fs.rs` 仅做包管理（列表/读文件/安装 zip/移除） |
| Framer 接线 | ✅ serial 读路径 | `spawn_reader` 仅用 byte/frame 超时；`delimiter` 恒为 None |
| 通道数据录制 | ✅ | `recording.rs` DataLogger，CSV/HEX/BIN/TXT → `serial-tools-data/recordings/<channel>` |
| 命令错误契约 | ✅ | `CommandError` 序列化 `{code,message}`；前端 `errorMessage()` |
| 日志来源枚举 | ✅ | `LogSource` 枚举，序列化保持 snake_case |
| 更新检查 | ✅ | About 页 GitHub Releases 检查 + shell 打开外部 |
| 领域服务拆分 | ✅ 内部模块 | `domain/{packet_store,bus_registry,channel_manager,log_source}` |
| ChannelManager crate | 🔮 延后 | 内部模块已落地，独立 crate 待稳定后拆 |

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                   前端 (Vue 3 + TypeScript)               │
│  Connection / Terminal / Forward / Protocol / Log / …    │
│  Pinia: connectionStore · terminalStore · logStore · …   │
│  自定义 AppContextMenu（屏蔽 WebView 浏览器右键）          │
└──────────────────────┬───────────────────────────────────┘
                       │ invoke / listen
┌──────────────────────┴───────────────────────────────────┐
│                 后端 (Rust + Tauri v2)                    │
│  Commands: connection · data · forward · protocol · …    │
│  AppState: channels(ChannelManager) · buses(BusRegistry) │
│            packets(PacketStore) · recordings · log 事件   │
│  domain/: packet_store · bus_registry · channel_manager  │
│  event_bridge: packets→emit("rx-data")                   │
│                log_broadcast → emit("log-entry")         │
│  Transport: Serial │ TCP Client │ TCP Server │ MQTT stub │
└──────────────────────────────────────────────────────────┘
```

### 真实数据路径

```
spawn_reader / Server 子通道读线程
  → packets.push_rx（PacketStore 一步完成：分配 seq → 入缓冲 → rx_broadcast.send，direction=rx）
       ├─ event_bridge → 前端 rxHub（主路径，仅 rx）
       └─ DataBus RxToBus → bus_tx → TxFromBus → write

send_data
  → Transport.write
  → packets.push_tx（入缓冲 + rx_broadcast.send，direction=tx）
       └─ DataBus RxToBus → bus_tx → TxFromBus → write（总线可转发本端发出的数据）
```

---

## 2. Crate / 目录

```
serial-tools/
├── crates/transport/     # 唯一独立业务 crate
│   └── serial / tcp/{client,server} / mqtt(stub) / mock / framer(已接入 serial)
├── src-tauri/src/
│   ├── state.rs · channel_lifecycle · tcp_server_monitor · recording · error
│   ├── domain/           # packet_store · bus_registry · channel_manager · log_source
│   └── commands/         # connection · data · forward · recording · config · log · …
├── src/                  # Vue
│   ├── pages/            # Connection · ChannelWorkspace · About · …
│   ├── views/            # TerminalView · ParsedLogView · MonitorView（单通道）
│   ├── protocol/         # 前端解析引擎（regex/json）
│   ├── stores/           # rxHub · protocol · valueBus · workspace · …
│   └── utils/            # error · recording · updater · diskLog · …
└── docs/
    └── protocol-multi-view/  # 协议+多视图设计
```

**规范**：不提前拆 `channel` / `protocol` crate；稳定后再拆（见 DESIGN-DECISIONS §2）。

---

## 3. Transport 层

```rust
pub trait Transport: Send + Sync {
    fn open(&mut self) -> Result<(), TransportError>;
    fn close(&mut self) -> Result<(), TransportError>;
    fn shutdown(&self) -> Result<(), TransportError>; // 主动关：发 FIN
    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError>;
    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError>;
    fn is_active(&self) -> bool;
    fn descriptor(&self) -> &TransportDescriptor;
    fn duplex_mode(&self) -> DuplexMode; // 默认 Full；Serial 半双工 → Half
}
```

| 类型 | kind | 说明 |
|------|------|------|
| Serial | `serial` | serialport，可选 half_duplex |
| TCP Client | `tcp_client` | connect_timeout 3s |
| TCP Server 子客户端 | `tcp_server_client` | `from_stream` |
| TCP Server | `tcp_server` | 监听 + `new_clients`；自身不 spawn_reader |
| MQTT | `mqtt` | 占位 |

**TCP Server 规范**：
1. 单读者：子客户端流独占读，Server 不 pending 双读  
2. 踢人 / 关服：先 `Shutdown::Both`（FIN），避免对端「服务异常」  
3. 事件：`connection-changed` 携带 `parent_channel_id`、`server_clients`、`reason`

---

## 4. AppState / 通道生命周期

收口模块：`disconnect_reason` + `channel_lifecycle`（命令层只编排，不复制清理逻辑）。

```
connect
  → register_channel（serial / tcp_client）
  → 或 insert tcp_servers + spawn_tcp_server_monitor（tcp_server）
  → emit_connected

register_server_client
  → channels.register_server_client（含 client_parents 表） → spawn_reader

remove_channel → cancel → shutdown → join 读线程(≤2s)

对端断开（读线程）:
  Ok(0) / fatal → DisconnectReason::Remote|Error
               → finalize_peer_disconnect（kick 写侧 + 清 map + emit）
本端 disconnect:
  close_server_local / close_channel_local → reason=local emit
  读线程见 cancel → note_reader_exit（不重复 toast）
```

命令名：`connect` / `disconnect` / `disconnect_client` / `disconnect_all`（非 open/close）。

---

## 5. 前端事件规范

| 事件 | 消费者 | 说明 |
|------|--------|------|
| `rx-data` | rxHub | 主路径；含 `seq`，去重后扇出各视图 |
| `connection-changed` | connectionStore | 含 `reason` / `server_clients` |
| `log-entry` | logStore | |

**终端规范**：
- 正常情况 **禁止周期轮询**；仅 `onRxData` 失败时 400ms 兜底  
- 去重：`seq` 优先，其次 `direction|channelId|timestamp|hex`  
- 启动可一次性 `get_packets` 拉历史  

---

## 6. 数据总线

```
RxToBus / Both.rx  → 订阅 rx_broadcast（含 rx+tx，禁止 transport.read），按目标通道过滤后推入 bus_tx
TxFromBus / Both.tx → 订阅 bus_tx → write（跳过 source == 本通道的事件，发送方不接收自己的发送）
```

- 总线内事件 `BusEvent { source_channel_id, bytes }`：来源通道标记，供广播排除自身。
- `rx_broadcast` 现同时承载 rx / tx：`send_data` 成功后也广播 tx，总线可转发本端发出的数据（如串口→网口双向）。
- 前端 `rx-data` 事件仍只推送真实接收（`event_bridge` 过滤 direction=rx）；tx 由发送回包入账终端。
- 生命周期：创建 → 订阅 → 运行 → 停止 → 启动（恢复）。`stop` 只 join 线程并**保留订阅记录**；`start_bus` 按保留记录重建线程，无需重新订阅。删除仍要求先停止。
- 组合：点对点 / 广播 / 双向 / 仅监听。详见 DESIGN-DECISIONS §9。

---

## 7. 编码

| 方向 | UTF-8 | GBK | HEX |
|------|-------|-----|-----|
| 显示 | 事件 text / TextDecoder | TextDecoder('gbk') on rawBytes | hex 格式化 |
| 发送 | `format=text` | `encoding_rs::GBK` | `format=hex` |

GB2312：UI 已移除；后端若收到 `gb2312` 按 GBK 兼容处理。

---

## 8. Duplex / Channel 抽象（目标态 vs 现状）

**现状**：逻辑 Channel ≈ `AppState.channels` 中的一项 + 读线程；无独立 `ChannelInstance` trait。

**目标态**（REFINEMENT，未落地）：Transport → Channel → ProtocolChannel。

半双工软件互斥（`receiving` 标志）：⏳ 未做，当前依赖硬件方向控制。

---

## 9. 通信安全与体验约定

1. 主动断开必须优雅 FIN（`shutdown(Both)`）  
2. 异常与主动断开提示分离（remote / error / local）  
3. WebView 禁用浏览器默认右键，使用应用菜单  
4. 产品文案勿宣称未实现能力（UDP / 日志导出 / 完整协议解析）

---

## 10. 协议扩展系统（protocol-ext）

> 详设见 [protocol-ext/](./protocol-ext/README.md)。核心约定：

- **运行时全在前端**：`src/protocol-ext/`（pinia store `useProtocolRuntime`）。后端只做包管理 `src-tauri/src/commands/protocol_fs.rs`（`list_protocols` / `read_protocol_file` / `install_protocol_zip` / `remove_protocol`），协议校验/加载/生命周期由前端完成。
- **协议包** = 目录：`manifest.yaml`（声明式参数/动作/变量表）+ `main.js`（ESM 默认导出）+ 可选 `main.d.ts`。新增/修改协议无需重新编译 Rust。
- **来源**：builtin（`public/protocols/builtin/`，随包分发）/ user（数据目录 `protocols/`，zip 安装）/ templates（新协议起点）。
- **ABI 钩子**：`init`（必选）/ `dispose` / `onRx` / `onTick`（~50ms）/ `setConfig` / `match+handle`（从站）/ `runAction` / `getVariables`。
- **ctx 注入**：`sendHex`（经 `send_data`）、`emitVar`（→ valueBus，ruleId=协议 id）、`log`、`getParam`、`timer`、`utils`。发送只走 `ctx.sendHex`；数值只走 `ctx.emitVar`。
- **RX 分发**：rxHub 订阅；从站角色用 `match`/`handle`，其它用 `onRx`。
- **安全**：zip 安装做路径穿越防护、manifest 校验、剥唯一顶层目录、同/降版本需 force、临时目录解压后原子 rename。
- **内置参考实现**：Modbus RTU/TCP 主站+从站（可同一通道主从闭环自测）；演示包 `public/protocols/demo/demo-passive.zip`。
- 测试：后端 `protocol_fs` 单测（14 个，含真实 demo zip 冒烟）；前端 `src/protocol-ext/*.test.ts`。
- 能力边界：协议运行在前端进程，**不占用 Rust 侧 I/O**；它只是消费 rxHub 数据 + `send_data` 发送。

---

## 11. 相关文档索引

| 文档 | 职责 |
|------|------|
| 本文 | 架构真相与规范 |
| protocol-multi-view/DESIGN_* | 协议引擎 + 通道多视图设计 |
| protocol-ext/ | 协议扩展系统（manifest/ABI/编写/模板/排查） |
| DESIGN-DECISIONS.md | 为何这样选 |
| COMMUNICATION-ARCH-REFINEMENT.md | 演进路线（含未做项） |
| ROADMAP.md | 下一步优先级 |
| requirements.md | 需求（含计划项） |
| tcp-server-bus-fix/* | 已完成专项验收 |

## 12. 错误契约与可观测性

- **命令错误契约**：`CommandError` 序列化为 `{ code, message }`；前端 `parseCommandError` / `errorMessage` 统一取后端中文消息（`Message` 弹窗用 `code !== 'internal'` 判断是否吞错）。后端经 `From<TransportError>` + `fatal_kind()` 把 IO 错误分类（WSAECONNRESET=10054 等映射为连接错误）。
- **日志来源**：`LogSource` 枚举（`domain/log_source.rs`）收敛来源魔法字符串，序列化保持 snake_case 契约，前端无需感知。
- **通道数据录制**：`recording.rs`（RecordingRegistry）start/stop/list/remove；读线程录 RX、`send_data` 录 TX；CSV 真实 channel_id，文件名 sanitize。

---
