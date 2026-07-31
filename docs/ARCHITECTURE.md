# Serial Tools 架构文档

> 基于实际代码，2026-07-31 更新

## 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                   前端 (Vue 3 + TypeScript)               │
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐  │
│  │ConnectionPage│ │ TerminalPage │ │  ForwardPage     │  │
│  │ 连接管理      │ │ 数据终端      │ │  转发管理        │  │
│  └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘  │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌────────┴─────────┐  │
│  │ ProtocolPage │ │   LogPage    │ │  SettingsPage    │  │
│  │ 协议解析      │ │  日志管理     │ │  全局设置        │  │
│  └──────┬───────┘ └──────┬───────┘ └────────┬─────────┘  │
│         └────────────────┼──────────────────┘            │
│                          ▼                               │
│                   Pinia Stores                           │
│        (connectionStore / sessionStore / logStore)        │
└──────────────────────┬───────────────────────────────────┘
                       │ Tauri IPC (invoke / listen)
┌──────────────────────┴───────────────────────────────────┐
│                 后端 (Rust + Tauri v2)                    │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │              Commands Layer                        │   │
│  │  connection │ data │ forward │ protocol │ log │ cfg│   │
│  └─────────────────────┬─────────────────────────────┘   │
│                        ▼                                 │
│  ┌───────────────────────────────────────────────────┐   │
│  │              State (AppState)                      │   │
│  │  channels / forwarders / packets / rx_broadcast    │   │
│  │  每个通道 = 1 独立读线程 + broadcast 事件广播        │   │
│  └─────────────────────┬─────────────────────────────┘   │
│                        ▼                                 │
│  ┌───────────────────────────────────────────────────┐   │
│  │          Transport Layer (trait)                    │   │
│  │  Serial │ TCP Client │ TCP Server │ MQTT │ Mock     │   │
│  │  统一 read/write/close 接口                         │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## Crate 结构

```
serial-tools/
├── crates/
│   └── transport/          # 传输层 trait + 实现
│       └── src/
│           ├── lib.rs       # Transport trait 定义
│           ├── serial.rs    # UART/RS485 (serialport crate)
│           ├── tcp.rs       # TCP Client (std::net::TcpStream)
│           ├── mqtt.rs      # MQTT (占位，未实现)
│           └── mock.rs      # Mock 传输（测试用）
├── src-tauri/
│   └── src/
│       ├── lib.rs           # Tauri 入口 + 命令注册
│       ├── state.rs         # AppState 全局状态管理
│       ├── main.rs
│       └── commands/        # Tauri 命令层
│           ├── mod.rs
│           ├── connection.rs  # 连接管理
│           ├── data.rs        # 数据收发
│           ├── forward.rs     # 转发管理
│           ├── protocol.rs    # 协议解析
│           ├── log.rs         # 日志
│           └── config.rs      # 配置管理
├── src/                     # Vue 3 前端
│   ├── pages/               # 6 个页面
│   ├── stores/              # Pinia 状态管理
│   ├── api/                 # Tauri IPC 封装
│   └── App.vue
├── docs/                    # 设计文档
│   ├── ARCHITECTURE.md      # 本文档
│   ├── DESIGN-DECISIONS.md  # 设计决策
│   └── requirements.md      # 需求文档
└── tests/                   # 集成测试
```

**当前实际 crate**：仅 `transport`（独立 crate），其余逻辑在 `src-tauri` 中。

## Transport Trait

所有传输层实现统一的 `Transport` trait，sync 阻塞设计（配合独立读线程）：

```rust
pub trait Transport: Send + Sync {
    fn open(&mut self) -> Result<(), TransportError>;
    fn close(&mut self) -> Result<(), TransportError>;
    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError>;
    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError>;
    fn is_active(&self) -> bool;
    fn descriptor(&self) -> &TransportDescriptor;
}
```

### 实现列表

| 类型 | 类名 | 文件 | 说明 |
|------|------|------|------|
| Serial | `SerialTransport` | `serial.rs` | 基于 `serialport` crate，同步阻塞读写 |
| TCP Client | `TcpClientTransport` | `tcp.rs` | `std::net::TcpStream`，同步阻塞 |
| MQTT | `MqttTransport` | `mqtt.rs` | 占位，`open()` 返回未实现错误 |
| Mock | `MockTransport` | `mock.rs` | 内存模拟，测试用 |

### TransportConfig

```rust
pub enum TransportConfig {
    Serial { port, baud_rate, data_bits, stop_bits, parity },
    TcpClient { host, port },
    TcpServer { bind_addr, port },
    Mqtt { broker, port, client_id, topics },
}
```

## 数据流

### RX 路径（接收）

```
独立读线程 (std::thread)
  │
  ├── Transport.read(buf)          # 同步阻塞读取
  │
  ├── 构造 PacketEntry             # 时间戳 + hex + text + direction
  │
  ├── AppState.packets.push()      # 存入共享缓冲区（上限 10000 条）
  │
  └── AppState.rx_broadcast.send() # 广播 RxBroadcastEvent
        │
        ├── 前端 sessionStore       # Tauri listen → 更新 UI
        │
        └── Forwarder 线程          # 订阅 → 转发到目标通道
```

### TX 路径（发送）

```
前端输入 → Tauri invoke(data::send)
  │
  └── AppState.send_to_channel(channel_id, bytes)
        │
        └── Transport.write(bytes)  # 同步写入
```

### 广播事件

```rust
pub struct RxBroadcastEvent {
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub timestamp: String,
}
```

`broadcast::channel(1024)` 支持多个订阅者（终端 + 转发器同时监听）。

## 通信框架核心抽象：Transport → Channel → Duplex

通信层采用三层抽象，自底向上：

```
┌─────────────────────────────────────────────────────┐
│  Transport（物理连接）                                │
│  负责底层 IO：打开端口、读写字节、管理连接               │
│  一个 Transport 实例 = 一个物理连接                     │
├─────────────────────────────────────────────────────┤
│  Channel（逻辑通道）                                  │
│  封装 Duplex 控制、广播数据事件、统计信息               │
│  一个 Transport 可创建 1~N 个 Channel                  │
├─────────────────────────────────────────────────────┤
│  DuplexMode（双工模式）                               │
│  Full / Half / SimplexTx / SimplexRx                 │
│  控制通道的收发行为                                    │
└─────────────────────────────────────────────────────┘
```

### DuplexMode 枚举

```rust
pub enum DuplexMode {
    Full,       // 全双工：TX/RX 独立并行（UART 全双工、TCP）
    Half,       // 半双工：TX/RX 互斥（RS485 单总线）
    SimplexTx,  // 只发送
    SimplexRx,  // 只接收
}
```

### Transport 与 Channel 的映射关系

| Transport 类型 | 线程模型 | Channel 数量 | 说明 |
|---------------|---------|-------------|------|
| **UART** | 1 线程 | **1 个** | 独占串口，1 线程 = 1 Channel |
| **TCP Client** | 1 线程 | **1 个** | 单连接 |
| **TCP Server** | 1 监听 + N 线程 | **N 个** | 每客户端 = 1 Channel（独立线程） |
| **UDP** | 1 线程 | **1 个** | 单 socket |

### 关键设计原则

**1 Transport 可创建多个 Channel**

```
TCP Server Transport:
  ├── 接受客户端 A → 创建 Channel-A (thread-A)
  ├── 接受客户端 B → 创建 Channel-B (thread-B)
  └── 接受客户端 C → 创建 Channel-C (thread-C)

UART Transport:
  └── 打开串口 → 创建 Channel-0 (thread-0)
       未来协议分包扩展：
       └── 基于 Channel-0 创建 Protocol-Ch1, Protocol-Ch2 ...
```

**Channel 区分 Duplex 模式**

```
Channel-A: DuplexMode::Full    (TCP，全双工)
Channel-B: DuplexMode::Half    (RS485，半双工)
Channel-C: DuplexMode::SimplexRx (只读监控)
```

半双工控制逻辑（在 Channel 层）：
- TX 发送前检查 `receiving` 标志
- RX 接收期间设置 `receiving = true`
- TX 等待 RX 空闲后发送

**未来扩展：协议分包创建多 Channel**

```
UART Transport (1 物理连接)
  └── Channel-0 (物理通道，全双工)
       ├── Protocol-Ch1: Modbus RTU (DuplexMode::Half)
       ├── Protocol-Ch2: 自定义协议 (DuplexMode::Full)
       └── Protocol-Ch3: 原始数据 (DuplexMode::Full)
```

每个协议 Channel 独立广播自己的解码数据，上层 UI 可同时查看多个协议。

### 当前实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| Transport trait | ✅ 已实现 | read/write/sync 阻塞 |
| DuplexMode 枚举 | ✅ 已设计 | Full/Half/SimplexTx/SimplexRx |
| UART 1:1 Channel | ✅ 已实现 | 每通道独立读线程 |
| TCP Server 1:N Channel | ⏳ 预留 | TransportConfig::TcpServer 已定义 |
| RS485 半双工互斥 | ⏳ 待实现 | 需 receiving 标志 |
| 协议分包多 Channel | 🔮 远期 | 基于 Channel + Framer 扩展 |

## 通道模型

### 每个通道的生命周期

```
1. connection::open()
   └── 创建 Transport（Serial/TcpClient）
   └── 插入 AppState.channels

2. state::spawn_reader(channel_id, transport)
   └── 创建 cancel 标志
   └── 启动 std::thread 读循环
   └── 读取 → packets + broadcast

3. data::send(channel_id, bytes)
   └── Transport.write(bytes)

4. connection::close(channel_id)
   └── cancel.store(true)
   └── 等待读线程退出
   └── 从 channels 移除
```

### RS485 半双工

当前实现：**硬件层面**不控制 DE/RTS，程序层面**不区分半双工和全双工**。
读线程阻塞读取，写入直接调用 `Transport.write()`。
未来如需半双工互斥，需在 `SerialTransport` 中添加 `receiving` 标志。

### TCP Server 多通道

当前 `TcpClientTransport` 仅支持客户端模式。
TCP Server 功能在 `TransportConfig::TcpServer` 中有配置，但 `TcpServerTransport` 尚未实现。
预期模型：1 监听线程 + N 客户端读线程，每个客户端一个 channel_id。

## 转发器模型

```
AppState.forwarders: HashMap<String, ForwarderHandle>

ForwarderHandle {
    info: ForwarderInfo,      # 源/目标通道、方向、统计
    cancel: Arc<AtomicBool>,  # 停止标志
    threads: Vec<JoinHandle>, # 转发线程
}
```

转发线程订阅 `rx_broadcast`，收到数据后写入目标通道。支持：
- 单向（source → target）
- 双向（source ↔ target）

## 前端架构

### 页面

| 页面 | 文件 | 功能 |
|------|------|------|
| 连接管理 | `ConnectionPage.vue` | 创建/配置/连接通信通道 |
| 数据终端 | `TerminalPage.vue` | ASCII/HEX 显示收发数据 |
| 转发管理 | `ForwardPage.vue` | 配置转发规则、监控状态 |
| 协议解析 | `ProtocolPage.vue` | Modbus/JSON/正则匹配 |
| 日志管理 | `LogPage.vue` | 操作日志查看/导出 |
| 设置 | `SettingsPage.vue` | 全局配置 |

### 数据更新模式

**观察者模式**：Tauri 事件驱动，非轮询。
- 前端通过 `listen()` 订阅后端事件
- 后端 `rx_broadcast.send()` 触发事件
- 前端收到事件后更新 Pinia store → Vue 响应式渲染

### Pinia Stores

| Store | 职责 |
|-------|------|
| `connectionStore` | 连接状态、端口列表、配置持久化 |
| `sessionStore` | 数据包缓冲、发送历史 |
| `logStore` | 操作日志 |

## 配置格式

### 会话配置 (YAML)

```yaml
connection:
  type: serial          # serial | tcp_client | tcp_server | mqtt
  port: COM3
  baud_rate: 115200
  data_bits: 8
  stop_bits: 1
  parity: none

terminal:
  encoding: utf-8       # utf-8 | gbk | hex
  line_ending: crlf     # none | cr | lf | crlf
  timestamp: true

protocols:
  - name: modbus-slave1
    type: modbus_rtu
    slave_id: 1
```

### 转发配置

```yaml
forwarding:
  - name: 485-to-tcp
    source_channel: serial-001
    target_channel: tcp-001
    direction: bidirectional   # bidirectional | source_to_target | target_to_source
    enabled: true
```

## 线程模型总结

| 组件 | 线程类型 | 数量 | 说明 |
|------|---------|------|------|
| Tauri 主线程 | 异步 | 1 | UI + IPC |
| 读线程 | `std::thread`（同步阻塞） | N（每通道 1 个） | `Transport.read()` |
| 转发线程 | `std::thread` | M（每规则 1 个） | 订阅 broadcast |
| Tokio runtime | 异步 | 1 | 管理 async 任务 |

**设计选择**：读线程使用 `std::thread` 而非 tokio spawn，因为 `Transport.read()` 是同步阻塞的（`serialport` 和 `std::net::TcpStream` 不支持 async）。
