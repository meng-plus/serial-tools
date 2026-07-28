//! 应用状态管理

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

/// 应用全局状态
pub struct AppState {
    /// 连接状态
    pub connected: Arc<AtomicBool>,
    /// 当前传输类型
    pub transport_type: Arc<RwLock<Option<String>>>,
    /// 当前端口/地址
    pub port_name: Arc<RwLock<Option<String>>>,
    /// 收包缓冲（最近 N 条）
    pub packets: Arc<Mutex<Vec<PacketEntry>>>,
    /// 日志
    pub logs: Arc<Mutex<Vec<LogEntry>>>,
    /// 扫描取消标志
    pub scan_cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PacketEntry {
    pub timestamp: String,
    pub direction: String, // rx / tx
    pub source: String,
    pub bytes: Vec<u8>,
    pub hex: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connected: Arc::new(AtomicBool::new(false)),
            transport_type: Arc::new(RwLock::new(None)),
            port_name: Arc::new(RwLock::new(None)),
            packets: Arc::new(Mutex::new(Vec::with_capacity(10000))),
            logs: Arc::new(Mutex::new(Vec::with_capacity(1000))),
            scan_cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl AppState {
    pub fn set_connected(&self, connected: bool) {
        self.connected.store(connected, Ordering::SeqCst);
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    pub async fn log(&self, level: &str, source: &str, message: &str) {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            level: level.to_string(),
            source: source.to_string(),
            message: message.to_string(),
        };
        self.logs.lock().await.push(entry);
    }
}
