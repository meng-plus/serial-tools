//! 应用状态管理
//!
//! 核心职责:
//! - 管理活跃的 Transport 连接（支持多连接）
//! - 管理数据总线（多通道共享数据管道）
//! - 收发数据包缓冲

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{broadcast, Mutex, RwLock};
use transport::Transport;

use crate::channel_lifecycle::{finalize_from_app, note_reader_exit_from_app};
use crate::disconnect_reason::DisconnectReason;
use crate::domain::bus_registry::BusRegistry;
use crate::domain::packet_store::PacketStore;
use crate::error::CommandError;
use crate::recording::RecordingRegistry;

pub use crate::domain::bus_registry::{
    BusDirection, BusInfo, BusSubInfo, BusSubscription, DataBus,
};
pub use crate::domain::channel_manager::ChannelManager;
pub use crate::domain::log_source::LogSource;
pub use crate::domain::packet_store::{PacketEntry, RxBroadcastEvent};

/// 推送给前端的连接变更事件
#[derive(Clone, serde::Serialize)]
pub struct ConnectionEventPayload {
    pub channel_id: String,
    pub connected: bool,
    pub transport_type: String,
    pub port_name: String,
    pub parent_channel_id: Option<String>,
    /// 父 Server 当前在线客户端地址列表（事件驱动刷新用）
    pub server_clients: Option<Vec<String>>,
    /// 断开原因：local=本端主动 / remote=对端优雅关闭 / error=异常断开；连接成功时为 None
    pub reason: Option<String>,
}

// ── 数据包 & 日志 ──────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

// ── 应用全局状态 ────────────────────────────────────────────────

/// 串口超时分包时间对（字节间超时, 帧超时）
type SerialTimeoutPair = (AtomicU64, AtomicU64);

pub struct AppState {
    /// 通道注册表：transport / cancel / 读线程 / Server / 父子关系统一收口
    pub channels: Arc<ChannelManager>,
    /// 数据总线注册表
    pub buses: BusRegistry,
    /// 数据包缓冲 + 全局 RX 广播 + 单调序号
    pub packets: Arc<PacketStore>,
    pub logs: Arc<Mutex<Vec<LogEntry>>>,
    pub log_broadcast: broadcast::Sender<LogEntry>,
    /// 串口超时分包：(byte_timeout_ms, frame_timeout_ms)，仅 serial 通道使用
    pub serial_rx_timeouts: Arc<RwLock<HashMap<String, Arc<SerialTimeoutPair>>>>,
    /// 数据录制注册表：每通道一个 DataLogger
    pub recordings: Arc<RecordingRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        let (log_broadcast, _) = broadcast::channel(256);
        Self {
            channels: Arc::new(ChannelManager::new()),
            buses: BusRegistry::new(),
            packets: Arc::new(PacketStore::new()),
            logs: Arc::new(Mutex::new(Vec::with_capacity(1000))),
            log_broadcast,
            serial_rx_timeouts: Arc::new(RwLock::new(HashMap::new())),
            recordings: Arc::new(RecordingRegistry::default()),
        }
    }
}

impl AppState {
    pub async fn log(&self, level: &str, source: LogSource, message: &str) {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            level: level.to_string(),
            source: source.as_str().to_string(),
            message: message.to_string(),
        };
        let _ = self.log_broadcast.send(entry.clone());
        self.logs.lock().await.push(entry);
    }

    /// 若不存在则创建；已存在则不覆盖（避免 spawn 覆盖 connect 传入值）
    pub async fn get_or_init_serial_timeouts(
        &self,
        channel_id: &str,
        byte_timeout_ms: u64,
        frame_timeout_ms: u64,
    ) -> Arc<(AtomicU64, AtomicU64)> {
        let mut map = self.serial_rx_timeouts.write().await;
        if let Some(existing) = map.get(channel_id) {
            return existing.clone();
        }
        let pair = Arc::new((
            AtomicU64::new(byte_timeout_ms.max(1)),
            AtomicU64::new(frame_timeout_ms.max(1)),
        ));
        map.insert(channel_id.to_string(), pair.clone());
        pair
    }

    pub async fn set_serial_timeouts(
        &self,
        channel_id: &str,
        byte_timeout_ms: u64,
        frame_timeout_ms: u64,
    ) -> Result<(), CommandError> {
        let pair = self
            .get_or_init_serial_timeouts(channel_id, byte_timeout_ms, frame_timeout_ms)
            .await;
        pair.0.store(byte_timeout_ms.max(1), Ordering::Relaxed);
        pair.1.store(frame_timeout_ms.max(1), Ordering::Relaxed);
        Ok(())
    }

    /// 为某个 channel 启动读线程
    ///
    /// 对端断开经 `finalize_from_app` 收口；本端 `remove_channel` 置 cancel，不重复 emit。
    pub async fn spawn_reader(
        &self,
        channel_id: String,
        transport: Arc<dyn Transport>,
        app: AppHandle,
    ) {
        let cancel = Arc::new(AtomicBool::new(false));
        self.channels
            .put_cancel(channel_id.clone(), cancel.clone())
            .await;

        let packets = self.packets.clone();
        let recordings = self.recordings.clone();
        let cid = channel_id.clone();
        let rt = tokio::runtime::Handle::current();
        let rt_emit = rt.clone();
        let cid_emit = cid.clone();
        let use_framer = transport.descriptor().kind == "serial";
        let timeout_pair = if use_framer {
            Some(self.get_or_init_serial_timeouts(&channel_id, 50, 200).await)
        } else {
            None
        };

        let handle = std::thread::spawn(move || {
            use transport::framer::{Framer, FramerConfig};

            let mut buf = [0u8; 4096];
            let mut peer_reason: Option<DisconnectReason> = None;
            let mut framer = timeout_pair.as_ref().map(|pair| {
                Framer::new(FramerConfig {
                    byte_timeout_ms: pair.0.load(Ordering::Relaxed),
                    frame_timeout_ms: pair.1.load(Ordering::Relaxed),
                    delimiter: None,
                })
            });

            let emit_chunk = move |data: Vec<u8>| {
                if data.is_empty() {
                    return;
                }
                let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                recordings.log_rx(&cid_emit, &data, &ts);
                let cid_inner = cid_emit.clone();
                let ts_inner = ts;
                let pkts = packets.clone();
                rt_emit.block_on(async move {
                    let _ = pkts.push_rx(&cid_inner, data, &ts_inner).await;
                });
            };

            let flush_framer = |framer: &mut Framer| {
                while let Some(frame) = framer.try_extract() {
                    emit_chunk(frame);
                }
            };

            loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                if let (Some(framer), Some(pair)) = (framer.as_mut(), timeout_pair.as_ref()) {
                    framer.set_config(FramerConfig {
                        byte_timeout_ms: pair.0.load(Ordering::Relaxed),
                        frame_timeout_ms: pair.1.load(Ordering::Relaxed),
                        delimiter: None,
                    });
                }
                match transport.read(&mut buf) {
                    Ok(0) => {
                        let desc = transport.descriptor();
                        if desc.kind == "tcp_server" {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                            continue;
                        }
                        if desc.kind == "tcp_client" || desc.kind == "tcp_server_client" {
                            if !cancel.load(Ordering::Relaxed) {
                                peer_reason = Some(DisconnectReason::Remote);
                            }
                            break;
                        }
                        if let Some(framer) = framer.as_mut() {
                            flush_framer(framer);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        if let Some(framer) = framer.as_mut() {
                            framer.feed(&data);
                            flush_framer(framer);
                        } else {
                            emit_chunk(data);
                        }
                    }
                    Err(e) => {
                        if cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        if e.is_fatal_disconnect() {
                            let desc = transport.descriptor();
                            if desc.kind == "tcp_client" || desc.kind == "tcp_server_client" {
                                peer_reason = Some(DisconnectReason::Error);
                                break;
                            }
                        }
                        // 读超时：推进串口 Framer 的 byte/frame 超时判断
                        if let Some(framer) = framer.as_mut() {
                            flush_framer(framer);
                        }
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }

            if let Some(reason) = peer_reason {
                let kind = transport.descriptor().kind.clone();
                let addr = transport.descriptor().address.clone();
                finalize_from_app(&app, &rt, &cid, kind, addr, reason);
            } else {
                note_reader_exit_from_app(&app, &rt, &cid);
            }
        });

        self.channels.put_reader(channel_id.clone(), handle).await;
    }

    /// 停止 channel：先关传输解除阻塞，再在 blocking 池 join 读线程（避免死锁）
    pub async fn remove_channel(&self, channel_id: &str) {
        let (transport, cancel, reader) = self.channels.remove(channel_id).await;
        if let Some(cancel) = cancel {
            cancel.store(true, Ordering::Relaxed);
        }

        // 先关闭传输，让阻塞的 read 尽快返回
        if let Some(server) = self.channels.remove_server(channel_id).await {
            let _ = server.shutdown();
        }
        if let Some(transport) = transport {
            let _ = transport.shutdown();
        }
        self.channels.remove_parent(channel_id).await;
        self.recordings.remove(channel_id);
        {
            let mut t = self.serial_rx_timeouts.write().await;
            t.remove(channel_id);
        }

        if let Some(handle) = reader {
            let join = tokio::task::spawn_blocking(move || {
                let _ = handle.join();
            });
            // 最多等 2 秒，避免 UI 永久卡住
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), join).await;
        }
    }

    pub async fn send_to_channel(
        &self,
        channel_id: &str,
        bytes: &[u8],
    ) -> Result<usize, CommandError> {
        let transport = self
            .channels
            .get_transport(channel_id)
            .await
            .ok_or_else(|| CommandError::ChannelNotFound(channel_id.to_string()))?;
        transport.write(bytes).map_err(CommandError::from)
    }
}
