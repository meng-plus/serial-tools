# 通信层架构改进方案

## 设计目标

1. **统一抽象**：UART/TCP/UDP 使用相同的通道模型
2. **灵活 duplex 模式**：支持全双工、半双工、单向
3. **多路复用基础**：为未来协议分包预留扩展点
4. **清晰的线程模型**：明确每个线程管理的资源边界

## 核心概念

### 1. 传输层 (Transport)

**职责**：管理物理连接，提供原始字节收发

```rust
/// 传输类型
pub enum TransportKind {
    /// UART: 单通道，线程独占串口
    Uart { port: String, half_duplex: bool },
    
    /// TCP Server: 多通道，每客户端一个通道
    TcpServer { port: u16, max_connections: u32 },
    
    /// TCP Client: 单通道
    TcpClient { host: String, port: u16 },
    
    /// UDP: 单通道或多通道 (取决于模式)
    Udp { mode: UdpMode },
}

/// Transport trait (保持现有设计，微调)
#[async_trait]
pub trait Transport: Send {
    async fn open(&mut self, config: TransportConfig) -> Result<(), TransportError>;
    async fn close(&mut self) -> Result<(), TransportError>;
    async fn send(&mut self, data: &[u8]) -> Result<usize, TransportError>;
    async fn recv(&mut self, buf: &mut [u8]) -> Result<usize, TransportError>;
    fn is_open(&self) -> bool;
    
    /// 新增：获取 duplex 能力
    fn duplex_mode(&self) -> DuplexMode;
    
    /// 新增：Transport 可创建的最大通道数
    fn max_channels(&self) -> usize;
}
```

### 2. 通道层 (Channel)

**职责**：逻辑通信通道，封装 duplex 控制

```rust
/// Duplex 模式
#[derive(Debug, Clone, Copy)]
pub enum DuplexMode {
    /// 全双工：TX/RX 独立
    Full,
    
    /// 半双工：TX/RX 互斥，需要方向控制
    Half,
    
    /// 单向 - 只发送
    SimplexTx,
    
    /// 单向 - 只接收
    SimplexRx,
}

/// 通道配置
pub struct ChannelConfig {
    pub id: ChannelId,
    pub transport_id: TransportId,
    pub duplex_mode: DuplexMode,
    pub metadata: ChannelMetadata, // 可选：协议类型、优先级等
}

/// 通道实例 trait
pub trait ChannelInstance: Send + Sync {
    fn id(&self) -> ChannelId;
    fn duplex_mode(&self) -> DuplexMode;
    
    /// 发送数据 (半双工时需等待 RX 空闲)
    async fn send(&self, data: &[u8]) -> Result<usize, ChannelError>;
    
    /// 接收数据 (返回 (data, timestamp))
    async fn recv(&self, buf: &mut [u8]) -> Result<usize, ChannelError>;
    
    /// 非阻塞发送 (满时返回 WouldBlock)
    fn try_send(&self, data: &[u8]) -> Result<usize, ChannelError>;
    
    /// 订阅接收事件
    fn subscribe(&self) -> broadcast::Receiver<ChannelEvent>;
    
    fn close(&self);
    fn is_active(&self) -> bool;
}
```

### 3. 线程模型

#### UART (单通道)
```
[UART Thread]
  ├── 打开串口 (独占)
  ├── RX Loop: 读取 → 解码 → 广播到 Channel
  └── TX Queue: 从 Channel 发送 (半双工时检查 RX 状态)

Channel 数量：1 (未来可扩展：基于协议分包创建多个逻辑通道)
```

#### TCP Server (多通道)
```
[Listener Thread]
  └── 接受新连接 →  spawn [Client Thread]

[Client Thread 1] ──> ClientConnection { addr, tx, rx }
  └── 绑定到 Channel #1

[Client Thread 2] ──> ClientConnection { addr, tx, rx }
  └── 绑定到 Channel #2

Channel 数量：N (每客户端一个)
```

#### TCP Client (单通道)
```
[Connection Thread]
  ├── RX Loop: 读取 → 广播
  └── TX Queue: 发送

Channel 数量：1
```

### 4. 管理器架构

```rust
/// Transport 管理器
pub struct TransportManager {
    transports: DashMap<TransportId, Arc<dyn Transport>>,
}

impl TransportManager {
    /// 创建 Transport 并打开
    pub fn create_transport(&self, config: TransportConfig) -> TransportId;
    
    /// 基于 Transport 创建 Channel
    pub fn create_channel(
        &self,
        transport_id: TransportId,
        channel_config: ChannelConfig,
    ) -> Result<ChannelId, ChannelError>;
}

/// Channel 管理器
pub struct ChannelManager {
    channels: DashMap<ChannelId, Arc<dyn ChannelInstance>>,
    transport_map: Arc<TransportManager>,
}

impl ChannelManager {
    pub fn create_from_transport(
        &self,
        transport_id: TransportId,
        duplex_mode: DuplexMode,
    ) -> Result<ChannelId, ChannelError>;
    
    pub fn get_channel(&self, id: ChannelId) -> Option<Arc<dyn ChannelInstance>>;
}
```

## 实现示例

### UART 半双工通道

```rust
pub struct UartChannel {
    id: ChannelId,
    transport: Arc<Mutex<UartTransport>>,
    duplex_mode: DuplexMode,
    receiving: Arc<AtomicBool>, // 半双工标志
    event_tx: broadcast::Sender<ChannelEvent>,
}

#[async_trait]
impl ChannelInstance for UartChannel {
    async fn send(&self, data: &[u8]) -> Result<usize, ChannelError> {
        // 半双工：等待 RX 空闲
        if self.duplex_mode == DuplexMode::Half {
            while self.receiving.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        }
        
        let mut transport = self.transport.lock().await;
        transport.send(data).await.map_err(|e| e.into())
    }
    
    async fn recv(&self, buf: &mut [u8]) -> Result<usize, ChannelError> {
        if self.duplex_mode == DuplexMode::Half {
            self.receiving.store(true, Ordering::SeqCst);
        }
        
        let mut transport = self.transport.lock().await;
        let result = transport.recv(buf).await;
        
        if self.duplex_mode == DuplexMode::Half {
            self.receiving.store(false, Ordering::SeqCst);
        }
        
        result.map_err(|e| e.into())
    }
}
```

### TCP Server 多通道

```rust
pub struct TcpServerChannelManager {
    listener: Arc<TcpListener>,
    channels: DashMap<SocketAddr, Arc<TcpClientChannel>>,
    broadcast_tx: broadcast::Sender<(SocketAddr, Vec<u8>)>,
}

impl TcpServerChannelManager {
    pub async fn run(self: Arc<Self>) {
        loop {
            match self.listener.accept().await {
                Ok((stream, addr)) => {
                    let channel = Arc::new(TcpClientChannel::new(addr, stream));
                    self.channels.insert(addr, channel.clone());
                    
                    // 启动客户端线程
                    let ch = channel.clone();
                    tokio::spawn(async move {
                        ch.run_event_loop().await;
                    });
                }
                Err(e) => warn!("接受连接失败：{}", e),
            }
        }
    }
    
    pub fn get_channel(&self, addr: SocketAddr) -> Option<Arc<TcpClientChannel>> {
        self.channels.get(&addr).map(|c| c.clone())
    }
}
```

## 未来扩展：协议层

```rust
/// 协议通道 (基于物理通道多路复用)
pub struct ProtocolChannel {
    id: ProtocolChannelId,
    base_channel: Arc<dyn ChannelInstance>,
    protocol_id: u16, // 协议标识 (用于分包)
    framer: Box<dyn Framer>,
}

pub trait Framer {
    /// 将原始字节流分帧
    fn frame(&self, data: &[u8]) -> Vec<Frame>;
    
    /// 将帧组装为消息
    fn deframe(&self, frames: &[Frame]) -> Option<Vec<u8>>;
}

// 使用示例：
// 1 个 UART 物理通道 → N 个 ProtocolChannel (Modbus, CAN, 自定义协议)
```

## 迁移路径

### Phase 1: 重构现有代码
- [x] 添加 `DuplexMode` 枚举（`transport::DuplexMode`）
- [x] 修改 `Transport` trait 添加 `duplex_mode()` 方法
- [x] Serial 半双工返回 `Half`；其余默认 `Full`
- [ ] 独立 `ChannelInstance` trait / crate（当前以 AppState.channels 实现等价行为）

### Phase 2: 统一管理器
- [x] 行为层：TCP Server 每客户端独立通道 + kick/list/send
- [x] 事件：`connection-changed`（含 server_clients / reason）+ `rx-data`（含 seq）
- [ ] 独立 `TransportManager` / `ChannelManager` crate（延后，现用 AppState）

### Phase 3: 多路复用基础
- [x] 简单 Framer（超时/定界符，见 `crates/transport/src/framer.rs`）
- [ ] Framer 接入读路径 / 协议解析管线
- [ ] `ProtocolChannel` 抽象（未实现）

> **落地约束**：当前实现为 **sync Transport + std::thread**，不以孤立提交的 async 重写为准。详见 ARCHITECTURE.md / DESIGN-DECISIONS.md / ROADMAP.md。

### 已落地的关键行为（相对孤立提交）

| 设计意图 | 状态 |
|---------|------|
| 每客户端一通道 | ✅ `tcp_client-{addr}` |
| DuplexMode | ✅ Transport 层 |
| kick / list clients | ✅ Tauri 命令 + 事件 |
| 连接/断开事件推前端 | ✅ `connection-changed`（含 server_clients） |
| RX 事件推前端 | ✅ `rx-data` + capabilities |
| ChannelManager crate | ⏳ 延后 |

## 关键设计决策

1. **Transport 不直接暴露给上层**：上层只操作 Channel，Transport 由 Manager 管理
2. **Channel 是逻辑概念**：同一 Transport 可创建多个 Channel (未来扩展)
3. **Duplex 模式在 Channel 层控制**：Transport 只提供原始能力
4. **线程归属清晰**：每个 Transport 类型决定自己的线程模型

这个设计既满足了当前的 UART 单线程单通道、TCP Server 单线程多通道需求，又为未来的协议分包多路复用预留了扩展点。
