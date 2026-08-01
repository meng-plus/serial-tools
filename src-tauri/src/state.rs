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
use transport::tcp::TcpServerTransport;

use crate::channel_lifecycle::{finalize_from_app, note_reader_exit_from_app};
use crate::disconnect_reason::DisconnectReason;

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
pub struct PacketEntry {
    pub timestamp: String,
    pub direction: String, // rx / tx
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub hex: String,
    pub text: String,
    /// 与 rx_broadcast / 前端事件一致的序号，用于去重
    #[serde(default)]
    pub seq: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

// ── 数据总线 ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BusDirection {
    RxToBus,
    TxFromBus,
    Both,
}

#[derive(Debug, Clone)]
pub struct BusSubscription {
    pub channel_id: String,
    pub direction: BusDirection,
}

pub struct DataBus {
    pub id: String,
    pub name: String,
    pub subscriptions: Vec<BusSubscription>,
    pub bus_tx: broadcast::Sender<Vec<u8>>,
    pub cancel: Arc<AtomicBool>,
    pub sub_cancels: HashMap<String, Arc<AtomicBool>>,
    pub threads: Vec<std::thread::JoinHandle<()>>,
    pub rx_bytes: Arc<AtomicU64>,
    pub tx_bytes: Arc<AtomicU64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BusInfo {
    pub id: String,
    pub name: String,
    pub subscriptions: Vec<BusSubInfo>,
    pub status: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BusSubInfo {
    pub channel_id: String,
    pub direction: String,
}

// ── 应用全局状态 ────────────────────────────────────────────────

pub struct AppState {
    pub channels: Arc<RwLock<HashMap<String, Arc<dyn Transport>>>>,
    pub channel_cancels: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    pub channel_readers: Arc<RwLock<HashMap<String, std::thread::JoinHandle<()>>>>,
    pub tcp_servers: Arc<RwLock<HashMap<String, Arc<TcpServerTransport>>>>,
    pub client_parents: Arc<RwLock<HashMap<String, String>>>,
    pub buses: RwLock<HashMap<String, DataBus>>,
    pub packets: Arc<Mutex<Vec<PacketEntry>>>,
    pub rx_broadcast: broadcast::Sender<RxBroadcastEvent>,
    pub logs: Arc<Mutex<Vec<LogEntry>>>,
    pub log_broadcast: broadcast::Sender<LogEntry>,
    /// 单调递增包序号，供前端去重/增量拉取
    pub packet_seq: Arc<AtomicU64>,
    /// 串口超时分包：(byte_timeout_ms, frame_timeout_ms)，仅 serial 通道使用
    pub serial_rx_timeouts: Arc<RwLock<HashMap<String, Arc<(AtomicU64, AtomicU64)>>>>,
}

#[derive(Debug, Clone)]
pub struct RxBroadcastEvent {
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub timestamp: String,
    pub seq: u64,
}

impl Default for AppState {
    fn default() -> Self {
        let (rx_broadcast, _) = broadcast::channel(1024);
        let (log_broadcast, _) = broadcast::channel(256);
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            channel_cancels: Arc::new(RwLock::new(HashMap::new())),
            channel_readers: Arc::new(RwLock::new(HashMap::new())),
            tcp_servers: Arc::new(RwLock::new(HashMap::new())),
            client_parents: Arc::new(RwLock::new(HashMap::new())),
            buses: RwLock::new(HashMap::new()),
            packets: Arc::new(Mutex::new(Vec::with_capacity(10000))),
            rx_broadcast,
            logs: Arc::new(Mutex::new(Vec::with_capacity(1000))),
            log_broadcast,
            packet_seq: Arc::new(AtomicU64::new(0)),
            serial_rx_timeouts: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl AppState {
    pub async fn log(&self, level: &str, source: &str, message: &str) {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            level: level.to_string(),
            source: source.to_string(),
            message: message.to_string(),
        };
        let _ = self.log_broadcast.send(entry.clone());
        self.logs.lock().await.push(entry);
    }

    pub async fn push_packet(&self, entry: PacketEntry) {
        let mut packets = self.packets.lock().await;
        packets.push(entry);
        if packets.len() > 10000 {
            let drain_count = packets.len() - 8000;
            packets.drain(..drain_count);
        }
    }

    pub fn next_seq(&self) -> u64 {
        self.packet_seq.fetch_add(1, Ordering::Relaxed) + 1
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
    ) -> Result<(), String> {
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
        self.channel_cancels
            .write()
            .await
            .insert(channel_id.clone(), cancel.clone());

        let packets = self.packets.clone();
        let rx_tx = self.rx_broadcast.clone();
        let seq_counter = self.packet_seq.clone();
        let cid = channel_id.clone();
        let rt = tokio::runtime::Handle::current();
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

            let emit_chunk = |data: Vec<u8>| {
                if data.is_empty() {
                    return;
                }
                let ts = chrono::Local::now()
                    .format("%H:%M:%S%.3f")
                    .to_string();
                let hex_str = hex::encode(&data);
                let text = String::from_utf8_lossy(&data).to_string();
                let seq = seq_counter.fetch_add(1, Ordering::Relaxed) + 1;
                {
                    let pkts = packets.clone();
                    let cid = cid.clone();
                    let ts2 = ts.clone();
                    let data2 = data.clone();
                    let hex2 = hex_str;
                    let text2 = text;
                    rt.block_on(async {
                        let mut pkts = pkts.lock().await;
                        pkts.push(PacketEntry {
                            timestamp: ts2,
                            direction: "rx".to_string(),
                            channel_id: cid,
                            bytes: data2,
                            hex: hex2,
                            text: text2,
                            seq,
                        });
                        if pkts.len() > 10000 {
                            let drain = pkts.len() - 8000;
                            pkts.drain(..drain);
                        }
                    });
                }
                let _ = rx_tx.send(RxBroadcastEvent {
                    channel_id: cid.clone(),
                    bytes: data,
                    timestamp: ts,
                    seq,
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

        self.channel_readers
            .write()
            .await
            .insert(channel_id.clone(), handle);
    }

    /// 停止 channel：先关传输解除阻塞，再在 blocking 池 join 读线程（避免死锁）
    pub async fn remove_channel(&self, channel_id: &str) {
        if let Some(cancel) = self.channel_cancels.write().await.remove(channel_id) {
            cancel.store(true, Ordering::Relaxed);
        }

        // 先关闭传输，让阻塞的 read 尽快返回
        if let Some(server) = self.tcp_servers.write().await.remove(channel_id) {
            let _ = server.shutdown();
        }
        if let Some(transport) = self.channels.write().await.remove(channel_id) {
            let _ = transport.shutdown();
        }
        self.client_parents.write().await.remove(channel_id);
        {
            let mut t = self.serial_rx_timeouts.write().await;
            t.remove(channel_id);
        }

        if let Some(handle) = self.channel_readers.write().await.remove(channel_id) {
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
    ) -> Result<usize, String> {
        let channels = self.channels.read().await;
        let transport = channels
            .get(channel_id)
            .ok_or_else(|| format!("通道 {} 不存在", channel_id))?;
        transport
            .write(bytes)
            .map_err(|e| format!("发送失败: {}", e))
    }
}
