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
    subscriptions: Vec<BusSubscription>,  // 订阅列表
    bus_tx: broadcast::Sender<Vec<u8>>,   // 内部广播通道
    cancel, threads, rx_bytes, tx_bytes,
}

BusSubscription {
    channel_id: String,
    direction: BusDirection,  // RxToBus | TxFromBus | Both
}
```

**订阅方向语义**:
- `RxToBus`: 通道读线程读取 RX → 发送到 `bus_tx` 广播
- `TxFromBus`: 订阅 `bus_tx` → 写入通道 TX
- `Both`: 同时执行上述两个方向

**组合模式**:
- 点对点转发: A(RxToBus) + B(TxFromBus)
- 广播: A(RxToBus) + B(TxFromBus) + C(TxFromBus)
- 双向桥接: A(Both) + B(Both)
- 监听: A(RxToBus) — 仅抓包不转发

**线程模型**:
- 每个 RxToBus 订阅启动 1 个读线程（从通道读 → 推入 bus）
- 每个 TxFromBus 订阅启动 1 个写线程（从 bus 收 → 写入通道）
- 所有线程共享 `cancel` 标志，停止时 `join()` 等待退出

**替代方案（已排除）**:
- 保留点对点转发器 + 新增广播功能：两套代码维护成本高
- 全局事件总线（所有数据流经同一条总线）：无法隔离不同转发场景

## 10. 前端事件驱动 + 轮询兜底

**决策**: 前端优先使用 Tauri 事件监听，增加 500ms 轮询作为兜底。

**理由**:
- Tauri 事件驱动是理想路径（零延迟、低开销）
- 浏览器预览模式无法使用 Tauri 事件，轮询保证功能可用
- 事件监听和轮询通过时间戳去重，避免重复显示
- 500ms 间隔对调试场景足够，不会造成明显 CPU 开销

## 11. 数据包缓冲 + 时间戳

**决策**: 每个数据包附带毫秒级时间戳，存入共享缓冲区。

**理由**:
- 调试场景需要知道数据到达的精确时间
- 缓冲区上限 10000 条，超出淘汰旧数据
- 时间戳在读线程中生成（`chrono::Local`），保证精度

## 12. 编码切换在前端处理

**决策**: UTF8/GBK/HEX 编码切换在前端完成，后端只传原始字节。发送端同样支持编码选择。

**理由**:
- 原始字节是通用格式，编码是展示层逻辑
- 前端切换无需请求后端
- HEX 发送模式由前端解析 hex 字符串后调用 `send_data(format='hex')`
- 减少后端复杂度

## 13. Tauri v2 事件桥接（event_bridge）

**决策**: 新增 `event_bridge.rs`，订阅内部 `tokio::sync::broadcast` 频道，通过 `tauri::Emitter::emit()` 推送给前端。RX 数据以 hex 字符串传输，避免 `Vec<u8>` 序列化歧义。

**理由**:
- 后端 `rx_broadcast` 和 `log_broadcast` 是 Rust 内部频道，不能直接序列化给前端
- `Vec<u8>` 在 Tauri IPC 中的序列化行为不确定（可能变为 typed array），改用 hex 字符串更可靠
- 前端通过 `hexToBytes()` 从 hex 字符串还原原始字节

**关键类型**:
- `RxEventPayload` — RX 数据事件（channel_id, bytes_hex, hex, text, timestamp）
- `ConnectionEventPayload` — 连接状态变更（channel_id, connected, transport_type, port_name）
- `LogEntry`（直接序列化）— 日志事件

## 14. Tauri v2 环境检测

**决策**: 使用 `__TAURI_INTERNALS__` 而非 `__TAURI__` 检测 Tauri 环境。

**理由**:
- Tauri v2 默认不注入 `window.__TAURI__` 全局对象（Tauri v1 行为）
- `window.__TAURI_INTERNALS__` 在 Tauri v2 中始终可用
- 使用 `__TAURI__` 会导致前端误判为浏览器模式，所有 IPC 调用失败

## 15. TCP Server 客户端 descriptor 标记

**决策**: `TcpClientTransport::from_stream()` 创建的传输，descriptor.kind 标记为 `"tcp_server_client"` 而非 `"tcp_client"`。

**理由**:
- 前端需要区分「独立连接的 TCP 客户端」和「TCP Server 接受的子客户端」
- `get_connection_status` 返回的 transport_type 直接来自 descriptor.kind
- 前端 ConnectionPage 根据类型决定显示样式（客户端数量、缩进列表等）
- 终端页面根据类型决定过滤逻辑（选中 server 时包含所有 client 数据）
