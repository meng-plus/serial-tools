# Serial Tools 设计决策

> 基于实际代码，2026-07-31 更新

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

**实现**: `AppState.rx_broadcast: broadcast::Sender<RxBroadcastEvent>`，读线程发送，前端和转发器订阅。

## 6. AppState 统一管理

**决策**: 所有通道、转发器、数据包缓冲集中在 `AppState`。

**理由**:
- Tauri `State<AppState>` 注入到每个 command，访问方便
- `RwLock<HashMap>` 支持并发读写
- 数据包缓冲有上限（10000 条），防止内存无限增长

**替代方案（已排除）**:
- 每个通道独立管理：分散状态，转发器需要跨通道访问

## 7. RS485 不做软件方向控制

**决策**: RS485 半双工模式不控制 DE/RTS GPIO。

**理由**:
- 硬件自动方向控制更可靠（大多数 RS485 转换器自带）
- 软件控制 GPIO 需要平台相关实现（Linux/Windows/macOS 各不同）
- 降低复杂度，专注通信调试功能

**未来扩展**: 如确需软件方向控制，可在 `SerialTransport` 中添加 `receiving` 标志 + GPIO 控制接口。

## 8. TCP Server 多客户端模型（预留）

**决策**: `TransportConfig::TcpServer` 已定义，但 `TcpServerTransport` 尚未实现。

**预期模型**:
- 1 个监听线程：`accept()` 循环
- 每个客户端连接创建独立 channel_id
- 每个客户端独立读线程
- 最大连接数可配置

**理由**: TCP Server 的多客户端本质是多个独立连接，每个连接对应一个 channel，与当前通道模型一致。

## 9. 转发器独立线程

**决策**: 每条转发规则启动独立 `std::thread`。

**理由**:
- 转发是持续性操作，需要独立生命周期
- `cancel` 标志控制停止，`JoinHandle` 等待退出
- 与读线程模型一致（都是 std::thread + cancel 标志）

## 10. 前端事件驱动（非轮询）

**决策**: 前端通过 Tauri `listen()` 订阅事件，数据到达立即更新 UI。

**理由**:
- 串口数据到达时间不确定，轮询浪费资源
- Tauri 事件机制成熟，性能优秀
- Pinia store 在事件回调中更新，Vue 响应式自动渲染

**替代方案（已排除）**:
- 定时轮询：浪费 CPU，延迟高

## 11. 数据包缓冲 + 时间戳

**决策**: 每个数据包附带毫秒级时间戳，存入共享缓冲区。

**理由**:
- 调试场景需要知道数据到达的精确时间
- 缓冲区上限 10000 条，超出淘汰旧数据
- 时间戳在读线程中生成（`chrono::Local`），保证精度

## 12. 编码切换在前端处理

**决策**: UTF8/GBK/HEX 编码切换在前端完成，后端只传原始字节。

**理由**:
- 原始字节是通用格式，编码是展示层逻辑
- 前端切换无需请求后端
- 减少后端复杂度

## 13. Tauri v2 事件桥接（event_bridge）

**决策**: 新增 `event_bridge.rs`，订阅内部 `tokio::sync::broadcast` 频道，通过 `tauri::Emitter::emit()` 推送给前端。

**理由**:
- 后端 `rx_broadcast` 和 `log_broadcast` 是 Rust 内部频道，不能直接序列化给前端
- 需要定义 `RxEventPayload` / `LogEventPayload` 等 `serde::Serialize` 类型作为桥接
- 前端通过 `@tauri-apps/api/event` 的 `listen()` 接收事件，实现零轮询

**关键类型**:
- `RxEventPayload` — RX 数据事件（channel_id, bytes, hex, text, timestamp）
- `ConnectionEventPayload` — 连接状态变更（channel_id, connected, transport_type, port_name）
- `LogEntry`（直接序列化）— 日志事件

## 14. Tauri v2 环境检测

**决策**: 使用 `__TAURI_INTERNALS__` 而非 `__TAURI__` 检测 Tauri 环境。

**理由**:
- Tauri v2 默认不注入 `window.__TAURI__` 全局对象（Tauri v1 行为）
- `window.__TAURI_INTERNALS__` 在 Tauri v2 中始终可用
- 使用 `__TAURI__` 会导致前端误判为浏览器模式，所有 IPC 调用失败
