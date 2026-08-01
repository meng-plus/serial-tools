# Serial Tools 架构文档

> 基于实际代码校对，2026-07-31（v0.1.0 基线）
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
| Framer 接线 | ✅ serial 读路径 | `spawn_reader` 仅用 byte/frame 超时；`delimiter` 恒为 None |
| 日志 BIN/CSV/HEX 导出 | ❌ 未实现 | 仅内存系统日志 |
| ChannelManager crate | 🔮 延后 | 现用 `AppState` |

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
│  AppState: channels · tcp_servers · buses · packets      │
│            rx_broadcast · log_broadcast · packet_seq     │
│  event_bridge: rx_broadcast → emit("rx-data")            │
│                log_broadcast → emit("log-entry")         │
│  Transport: Serial │ TCP Client │ TCP Server │ MQTT stub │
└──────────────────────────────────────────────────────────┘
```

### 真实数据路径

```
spawn_reader / Server 子通道读线程
  → PacketEntry{seq} 入 packets
  → rx_broadcast.send(RxBroadcastEvent{seq})
       ├─ event_bridge → 前端 terminalStore（主路径）
       └─ DataBus RxToBus → bus_tx → TxFromBus → write

send_data
  → Transport.write
  → PacketEntry{seq} 入 packets
  → 回包给前端入账 TX（不再依赖轮询）
```

---

## 2. Crate / 目录

```
serial-tools/
├── crates/transport/     # 唯一独立业务 crate
│   └── serial / tcp/{client,server} / mqtt(stub) / mock / framer(未接线)
├── src-tauri/src/
│   ├── state.rs · channel_lifecycle · tcp_server_monitor · …
│   └── commands/
├── src/                  # Vue
│   ├── pages/            # Connection · ChannelWorkspace · …
│   ├── views/            # TerminalView · ParsedLogView · MonitorView（单通道）
│   ├── protocol/         # 前端解析引擎（regex/json）
│   ├── stores/           # rxHub · protocol · valueBus · workspace · …
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
  → client_parents + register_channel → spawn_reader

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
| `rx-data` | terminalStore | 主路径；含 `seq` |
| `connection-changed` | connectionStore | 含 `reason` / `server_clients` |
| `log-entry` | logStore | |

**终端规范**：
- 正常情况 **禁止周期轮询**；仅 `onRxData` 失败时 400ms 兜底  
- 去重：`seq` 优先，其次 `direction|channelId|timestamp|hex`  
- 启动可一次性 `get_packets` 拉历史  

---

## 6. 数据总线

```
RxToBus / Both.rx  → 订阅 rx_broadcast（禁止 transport.read）
TxFromBus / Both.tx → 订阅 bus_tx → write
```

组合：点对点 / 广播 / 双向 / 仅监听。详见 DESIGN-DECISIONS §9。

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

## 10. 相关文档索引

| 文档 | 职责 |
|------|------|
| 本文 | 架构真相与规范 |
| protocol-multi-view/DESIGN_* | 协议引擎 + 通道多视图设计 |
| DESIGN-DECISIONS.md | 为何这样选 |
| COMMUNICATION-ARCH-REFINEMENT.md | 演进路线（含未做项） |
| ROADMAP.md | 下一步优先级 |
| requirements.md | 需求（含计划项） |
| tcp-server-bus-fix/* | 已完成专项验收 |
