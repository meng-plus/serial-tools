//! Transport trait 统一抽象
//!
//! 所有传输层(串口/TCP/MQTT)实现同一 trait，上层无需关心底层。

pub mod serial;
pub mod tcp;
pub mod mqtt;
pub mod mock;

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

// ══════════════════════════════════════════════════════════════
// 单元测试
// ══════════════════════════════════════════════════════════════

#[cfg(test)]
mod mock_tests {
    use crate::mock::MockTransport;
    use crate::Transport;

    #[test]
    fn test_mock_new() {
        let mock = MockTransport::new("serial", "COM3");
        assert!(!mock.is_active());
        assert_eq!(mock.descriptor().kind, "serial");
        assert_eq!(mock.descriptor().address, "COM3");
    }

    #[test]
    fn test_mock_open_close() {
        let mut mock = MockTransport::new("tcp", "127.0.0.1:5000");
        assert!(!mock.is_active());
        mock.open().unwrap();
        assert!(mock.is_active());
        mock.close().unwrap();
        assert!(!mock.is_active());
    }

    #[test]
    fn test_mock_write_before_open_fails() {
        let mock = MockTransport::new("serial", "COM3");
        assert!(mock.write(b"hello").is_err());
    }

    #[test]
    fn test_mock_read_before_open_fails() {
        let mock = MockTransport::new("serial", "COM3");
        let mut buf = [0u8; 64];
        assert!(mock.read(&mut buf).is_err());
    }

    #[test]
    fn test_mock_write_records_data() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        assert_eq!(mock.write(b"hello").unwrap(), 5);
        assert_eq!(mock.write(b"world123").unwrap(), 8);
        assert_eq!(mock.tx_bytes(), 13);
        assert_eq!(mock.get_tx_log(), vec![b"hello".to_vec(), b"world123".to_vec()]);
    }

    #[test]
    fn test_mock_read_empty_returns_zero() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        let mut buf = [0u8; 64];
        assert_eq!(mock.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn test_mock_read_returns_enqueued_data() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        mock.enqueue_rx(b"abc".to_vec());
        mock.enqueue_rx(b"def".to_vec());
        let mut buf = [0u8; 64];
        assert_eq!(mock.read(&mut buf).unwrap(), 3);
        assert_eq!(&buf[..3], b"abc");
        assert_eq!(mock.read(&mut buf).unwrap(), 3);
        assert_eq!(&buf[..3], b"def");
        assert_eq!(mock.read(&mut buf).unwrap(), 0);
    }

    #[test]
    fn test_mock_read_truncates() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        mock.enqueue_rx(vec![0xAA; 100]);
        let mut buf = [0u8; 10];
        assert_eq!(mock.read(&mut buf).unwrap(), 10);
        assert_eq!(buf, [0xAA; 10]);
    }

    #[test]
    fn test_mock_clear_tx_log() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        mock.write(b"test").unwrap();
        mock.clear_tx_log();
        assert_eq!(mock.tx_bytes(), 0);
    }

    #[test]
    fn test_mock_write_after_close_fails() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        mock.close().unwrap();
        assert!(mock.write(b"x").is_err());
    }

    #[test]
    fn test_mock_read_after_close_fails() {
        let mut mock = MockTransport::new("serial", "COM3");
        mock.open().unwrap();
        mock.close().unwrap();
        let mut buf = [0u8; 64];
        assert!(mock.read(&mut buf).is_err());
    }
}

#[cfg(test)]
mod tcp_tests {
    use crate::{Transport};
    use crate::tcp::TcpClientTransport;

    #[test]
    fn test_tcp_new() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 9999);
        assert!(!tcp.is_active());
        assert_eq!(tcp.descriptor().kind, "tcp_client");
        assert_eq!(tcp.descriptor().address, "127.0.0.1:9999");
    }

    #[test]
    fn test_tcp_connect_refused() {
        let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), 1);
        assert!(tcp.open().is_err());
        assert!(!tcp.is_active());
    }

    #[test]
    fn test_tcp_write_before_open() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 9999);
        assert!(tcp.write(b"test").is_err());
    }

    #[test]
    fn test_tcp_read_before_open() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 9999);
        let mut buf = [0u8; 64];
        assert!(tcp.read(&mut buf).is_err());
    }

    #[test]
    fn test_tcp_close() {
        let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), 9999);
        tcp.close().unwrap();
        assert!(!tcp.is_active());
    }
}

#[cfg(test)]
mod mqtt_tests {
    use crate::{Transport};
    use crate::mqtt::MqttTransport;

    #[test]
    fn test_mqtt_not_implemented() {
        let mut mqtt = MqttTransport::new("broker.mqtt.com", 1883);
        assert!(!mqtt.is_active());
        assert_eq!(mqtt.descriptor().kind, "mqtt");
        assert_eq!(mqtt.descriptor().address, "broker.mqtt.com:1883");
        assert!(mqtt.open().is_err());
        assert!(mqtt.write(b"test").is_err());
        let mut buf = [0u8; 64];
        assert!(mqtt.read(&mut buf).is_err());
    }
}

#[cfg(test)]
mod config_tests {
    use crate::TransportConfig;

    #[test]
    fn test_config_serial_roundtrip() {
        let config = TransportConfig::Serial {
            port: "COM3".to_string(), baud_rate: 115200,
            data_bits: 8, stop_bits: 1, parity: "None".to_string(),
        };
        let json = serde_json::to_string(&config).unwrap();
        let back: TransportConfig = serde_json::from_str(&json).unwrap();
        match back {
            TransportConfig::Serial { port, baud_rate, .. } => {
                assert_eq!(port, "COM3");
                assert_eq!(baud_rate, 115200);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_config_tcp_roundtrip() {
        let config = TransportConfig::TcpClient { host: "10.0.0.1".to_string(), port: 5000 };
        let json = serde_json::to_string(&config).unwrap();
        let back: TransportConfig = serde_json::from_str(&json).unwrap();
        match back {
            TransportConfig::TcpClient { host, port } => {
                assert_eq!(host, "10.0.0.1");
                assert_eq!(port, 5000);
            }
            _ => panic!("wrong variant"),
        }
    }
}
