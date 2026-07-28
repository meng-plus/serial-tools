//! Transport trait 统一抽象
//!
//! 所有传输层(串口/TCP/MQTT)实现同一 trait，上层无需关心底层。

pub mod serial;
pub mod tcp;
pub mod mqtt;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum TransportError {
    #[error("连接失败: {0}")]
    Connect(String),
    #[error("发送失败: {0}")]
    Send(String),
    #[error("接收失败: {0}")]
    Receive(String),
    #[error("未连接")]
    NotConnected,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

/// 传输层数据块
#[derive(Debug, Clone)]
pub struct TransportChunk {
    pub direction: Direction,
    pub timestamp: String,
    pub bytes: Vec<u8>,
    pub metadata: EventMetadata,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Direction {
    Rx,
    Tx,
}

#[derive(Debug, Clone, Default)]
pub struct EventMetadata {
    pub topic: Option<String>,
    pub qos: Option<u8>,
    pub retain: Option<bool>,
    pub peer_id: Option<String>,
}

/// Transport trait — 统一传输层接口
pub trait Transport: Send + Sync {
    /// 打开连接
    fn open(&mut self) -> Result<(), TransportError>;
    /// 关闭连接
    fn close(&mut self) -> Result<(), TransportError>;
    /// 发送原始字节
    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError>;
    /// 读取原始字节（同步阻塞，由独立线程调用）
    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError>;
    /// 是否已连接
    fn is_active(&self) -> bool;
    /// 描述信息
    fn descriptor(&self) -> &TransportDescriptor;
}

/// 传输层描述信息
#[derive(Debug, Clone)]
pub struct TransportDescriptor {
    pub kind: String,
    pub address: String,
}

/// 传输层配置
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TransportConfig {
    Serial {
        port: String,
        baud_rate: u32,
        data_bits: u8,
        stop_bits: u8,
        parity: String,
    },
    TcpClient {
        host: String,
        port: u16,
    },
    TcpServer {
        bind_addr: String,
        port: u16,
    },
    Mqtt {
        broker: String,
        port: u16,
        client_id: String,
        topics: Vec<String>,
    },
}
