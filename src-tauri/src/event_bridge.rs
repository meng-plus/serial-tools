//! 事件桥接层 — 将内部 broadcast 频道桥接到 Tauri 前端事件
//!
//! 使用 std::thread + 阻塞 recv，不依赖 tokio runtime。

use crate::state::{LogEntry, RxBroadcastEvent};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

pub use crate::state::ConnectionEventPayload;

/// 推送给前端的 RX 数据事件载荷
#[derive(Clone, serde::Serialize)]
pub struct RxEventPayload {
    pub channel_id: String,
    pub bytes_hex: String,
    pub hex: String,
    pub text: String,
    pub timestamp: String,
    pub seq: u64,
}

/// 启动事件桥接：独立线程订阅 rx_broadcast，通过 Tauri emit 推送给前端
pub fn start_event_bridge(app: AppHandle, rx_sender: broadcast::Sender<RxBroadcastEvent>) {
    std::thread::spawn(move || {
        let mut rx = rx_sender.subscribe();
        loop {
            match rx.blocking_recv() {
                Ok(event) => {
                    let hex_str = hex::encode(&event.bytes);
                    let payload = RxEventPayload {
                        channel_id: event.channel_id,
                        hex: hex_str.clone(),
                        bytes_hex: hex_str,
                        text: String::from_utf8_lossy(&event.bytes).to_string(),
                        timestamp: event.timestamp,
                        seq: event.seq,
                    };
                    if let Err(e) = app.emit("rx-data", payload) {
                        eprintln!("[event_bridge] emit rx-data failed: {}", e);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[event_bridge] lagged, skipped {} events", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    eprintln!("[event_bridge] rx_broadcast closed");
                    break;
                }
            }
        }
    });
}

/// 启动日志事件桥接：独立线程订阅 log_broadcast，通过 Tauri emit 推送给前端
pub fn start_log_bridge(app: AppHandle, log_sender: broadcast::Sender<LogEntry>) {
    std::thread::spawn(move || {
        let mut rx = log_sender.subscribe();
        loop {
            match rx.blocking_recv() {
                Ok(entry) => {
                    let _ = app.emit("log-entry", entry);
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[log_bridge] lagged, skipped {} entries", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });
}
