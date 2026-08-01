# Serial Tools 设计决策

> 基于实际代码，2026-08-02 更新

## 1. 选择 Tauri v2 而非 Electron

**决策**: 使用 Tauri v2 作为桌面应用框架。

**理由**:
- Rust 后端性能优秀，适合串口通信场景
- 包体积小 (相比 Electron 减少 90%+)
- 原生 Rust 串口库 (serialport) 集成方便
- 安全性更高

## 2. Rust Workspace 单 Crate 架构

**决策**: 当前阶段使用单一 transport crate + src-tauri，未拆分为多个 crate。

**理由**:
- 项目初期，拆分过早增加维护成本
- transport crate 独立后可复用
- 后续如需 framing/channel/protocol，再拆分不迟

**当前状态**: AppState 内部的领域状态已以 **模块** 形式拆分（`domain/packet_store` · `bus_registry` · `channel_manager` · `log_source`），收敛字段与操作；拆成独立 crate 仍延后，待接口稳定。

**未来计划**: 随功能增长，可拆分为 `transport` / `channel` / `framing` / `protocol` 等独立 crate。

## 3. Transport Trait 统一抽象

**决策**: 定义 `Transport` trait 统一串口、TCP、MQTT 传输层。

**理由**:
- 上层代码无需关心底层传输类型
- 端口转发功能可直接复用 Transport trait
- 便于添加新传输类型 (如 UDP、WebSocket)

## 4. Sync 阻塞 Transport + std::thread 读线程

**决策**: `Transport.read()` / `Transport.write()` 使用同步阻塞 API，配合独立 `std::thread` 读线程。

**理由**:
- `serialport` crate 本身是同步阻塞 API
- `std::net::TcpStream` 也是同步阻塞
- 读线程用 `std::thread` 而非 tokio spawn，避免在 async runtime 中阻塞
- 写入是瞬时操作（write + flush），不需要异步

**替代方案（已排除）**:
- tokio spawn + async Transport：serialport 不支持 async，需要额外 adapter
- mio + epoll：对串口不适用

## 5. Broadcast 广播模式

**决策**: 使用 `tokio::sync::broadcast` 广播接收数据事件。

**理由**:
- 多订阅者零拷贝：终端显示 + 转发器同时监听同一数据
- 无需轮询：数据到达立即推送
- 有 lagged 处理：慢消费者自动跳过旧数据

**实现**: `PacketStore`（`domain/packet_store.rs`）持有 `rx_broadcast` + 缓冲 + 单调序号，读线程 `push_rx` 一步完成（分配 seq → 入缓冲 → 广播），前端与转发器订阅。

## 6. AppState 统一管理 + 领域服务模块

**决策**: 所有通道、转发器、数据包缓冲集中在 `AppState`，按职责拆为领域服务模块（`domain/`）。

**理由**:
- Tauri `State<AppState>` 注入到每个 command，访问方便
- 通道注册表（ChannelManager）、总线（BusRegistry）、数据包缓冲（PacketStore）各自收敛操作，`AppState` 只做组合
- 数据包缓冲有上限（10000 条），防止内存无限增长

**替代方案（已排除）**:
- 每个通道独立管理：分散状态，转发器需要跨通道访问
- 立即拆独立 crate：接口未稳定，模块化已满足收敛目标

## 7. RS485 不做软件方向控制

**决策**: RS485 半双工模式不控制 DE/RTS GPIO。

**理由**:
- 硬件自动方向控制更可靠（大多数 RS485 转换器自带）
- 软件控制 GPIO 需要平台相关实现（Linux/Windows/macOS 各不同）
- 降低复杂度，专注通信调试功能

**未来扩展**: 如确需软件方向控制，可在 `SerialTransport` 中添加 `receiving` 标志 + GPIO 控制接口。

## 8. TCP Server 多客户端模型

**决策**: 每个接受的客户端创建独立 `TcpClientTransport`（`from_stream`），以独立 channel 注册到 `AppState.channels`。

**实现模型**:
- 1 个监听线程：`accept()` 循环，将新客户端推入 `new_clients` 队列
- 1 个监控线程（100ms 轮询）：从队列提取客户端，创建独立 channel + 读线程
- 每个客户端独立 channel_id（`tcp_client-{addr}`）
- 客户端 descriptor.kind = `"tcp_server_client"`，前端可区分展示
- 客户端断开时自动清理 channel 并通知前端
- Server 关闭时监控线程检测 `is_active()` 自动退出

**理由**: TCP Server 的多客户端本质是多个独立连接，每个连接对应一个 channel，与当前通道模型一致。descriptor 标记为 `tcp_server_client` 使前端能区分 server 子客户端和独立 tcp_client。

## 9. 数据总线架构（替代点对点转发）

**决策**: 用数据总线（DataBus）模型替代原有的点对点转发器。

**背景**: 原有转发器是 source→target 点对点桥接，无法满足一对多广播需求。总线模型统一了点对点和广播场景。

**核心设计**:
```
DataBus {
    id, name,
    subscriptions: Vec<BusSubscription>,
    bus_tx: broadcast::Sender<Vec<u8>>,
    cancel, threads, rx_bytes, tx_bytes,
}

BusSubscription { channel_id, direction: RxToBus | TxFromBus | Both }
```

**订阅方向语义**:
- `RxToBus`: **订阅** `AppState.rx_broadcast`，按 channel_id 过滤后写入 `bus_tx`（禁止再 `transport.read`，避免双读者）
- `TxFromBus`: 订阅 `bus_tx` → 写入通道 TX
- `Both`: 同时执行上述两个方向

**组合模式**:
- 点对点转发: A(RxToBus) + B(TxFromBus)
- 广播: A(RxToBus) + B(TxFromBus) + C(TxFromBus)
- 双向桥接: A(Both) + B(Both)
- 监听: A(RxToBus) — 仅抓包不转发

**线程模型**:
- 每个 RxToBus：1 个订阅 `rx_broadcast` 的转发线程
- 每个 TxFromBus：1 个写线程（从 bus 收 → 写入通道）
- 共享 `cancel` / 子订阅 cancel，停止时 join

**替代方案（已排除）**:
- 保留点对点转发器 + 新增广播：两套代码
- 全局单总线：无法隔离场景

## 10. 前端事件驱动（轮询仅兜底）

**决策**: 终端 **正常只订阅** `rx-data`；仅事件订阅失败时启用轮询。

**实现要点**:
- 启动可一次性 `get_packets` 拉历史
- 去重优先 `seq`，其次内容指纹 `direction|channelId|timestamp|hex`
- TX 仅用 `send_data` 回包入账，避免本地与轮询双记
- 浏览器预览无 Tauri 事件时走轮询兜底（约 400ms）

**已废弃**: 「始终 500ms 轮询 + 仅时间戳去重」方案（易导致双条显示）。

## 11. 数据包缓冲 + 序号

**决策**: 每包附毫秒时间戳 + 单调 `seq`，缓冲上限 10000。

**理由**:
- `seq` 供事件/历史/回包统一去重
- 时间戳用于展示与内容指纹辅助键

## 12. 编码：显示前端、GBK 发送后端

**决策**:
- 展示：UTF-8 / GBK / HEX 在前端切换（依赖保留的原始字节）
- 发送：UTF-8/`text`、HEX 前端组包；**GBK 由后端 `encoding_rs` 编码**
- UI 不再提供 GB2312（其为 GBK 子集）

## 13. Tauri v2 事件桥接（event_bridge）

**决策**: `event_bridge.rs` 将内部 broadcast 转为 Tauri emit；RX 用 hex 传字节。

**关键载荷**:
- `RxEventPayload` — channel_id, bytes_hex, hex, text, timestamp, **seq**
- `ConnectionEventPayload` — channel_id, connected, transport_type, port_name,
  parent_channel_id, **server_clients**, **reason** (`local`|`remote`|`error`)
- `LogEntry` — 日志

## 14. Tauri v2 环境检测

**决策**: 使用 `__TAURI_INTERNALS__` 而非 `__TAURI__` 检测 Tauri 环境。

## 15. TCP Server 客户端 descriptor 标记

**决策**: `from_stream` 的 descriptor.kind = `"tcp_server_client"`。

## 16. 主动断开 vs 异常断开

**决策**: 主动踢人/关连接必须 `Shutdown::Both` 发 FIN；读侧区分 `remote`(FIN) 与 `error`(RST)。

**理由**: 粗暴 drop 易导致对端提示「服务异常」；与 sscom 等工具的「已断开」体验对齐。

**实现收口**: `DisconnectReason` + `channel_lifecycle`（`close_*_local` / `finalize_peer_disconnect`），避免 connection 命令与读线程各写一套清理。

## 17. 应用内右键菜单

**决策**: 全局拦截 WebView 浏览器右键，提供调试相关动作（复制日志、清屏、剪切粘贴、刷新连接等）。

## 18. 维护边界（当前刻意不做）

**决策**: 本阶段只做结构整理与健壮性收口，不新增产品功能。

**已做**:
- `transport::tcp` 拆为 `client` / `server` 模块
- 通道生命周期统一入口；TCP Server 监控独立文件
- stub 标清：`mqtt` / `commands/protocol` / `framer`（已接入 serial 读路径）
- **结构化错误**：`CommandError {code,message}` + `TransportError::fatal_kind()`（WSAECONNRESET=10054 等分类）
- **领域服务模块**：`domain/{packet_store,bus_registry,channel_manager,log_source}` 收敛 AppState
- **通道数据录制**：`recording.rs`（DataLogger，CSV/HEX/BIN/TXT，TXT 按 UTF-8 容错解码）接线读线程 RX 与 `send_data` TX
- **更新检查**：About 页 GitHub Releases 检查 + shell 打开外部

**明确不做**（见 ROADMAP P3）:
- 独立 ChannelManager crate
- async Transport 整仓重写
- 在 stub 上假装已实现 MQTT / 完整后端协议解析

## 19. 协议解析放前端 + 通道优先多视图

**决策**: 正则/JSON 解析引擎在前端；UI 以通道为中心，一视图只绑一通道。

**理由**:
- 与现有 `rx-data` 扇出模型一致，多视图可并行订阅且不抢读
- 字符串协议与图表（vue-echarts）天然在前端闭环
- 避免过早建设后端 ProtocolChannel；二进制协议优先前端分帧+字段表（见 DESIGN_binary-protocol）
- **不做**完整 Modbus 主站/从站产品化

**详情**: [protocol-multi-view/DESIGN_protocol-multi-view.md](./protocol-multi-view/DESIGN_protocol-multi-view.md)

## 20. 命令错误契约：结构化 `{code, message}`

**决策**: `CommandError` 统一序列化为 `{ code, message }`（中文），前端 `parseCommandError` / `errorMessage` 集中解析；`Message` 弹窗变体 `code = "internal"`，其余视为非致命（`noError`）。

**理由**:
- 告别 `String(e)` 的「Command failed: …」前缀，前端只认后端中文消息
- 错误分类稳定（`code`）可做后续自动重试 / 分级展示

## 21. 日志来源枚举（LogSource）

**决策**: `domain/log_source.rs` 定义 `LogSource` 枚举（connection / bus / tcp_server / reader / config / system / recording / test），`AppState::log` 只接受枚举。

**理由**: 消除散落魔法字符串；序列化仍 `as_str()` 保持 snake_case，前端 `LogEntry.source: string` 零改动、契约不变。

## 22. 版本更新检查

**决策**: About 页提供「检查更新」：`checkForUpdate` 走 GitHub Releases API，`parseVersion` / `compareVersions` 为纯函数；打开外部链接经 Tauri shell（浏览器预览回退 `window.open`）。版本标识由构建期注入（`__APP_VERSION__` 等），发布流水线统一改写 package.json / tauri.conf.json。
