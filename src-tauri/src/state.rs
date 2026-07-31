//! 应用状态管理
//!
//! 核心职责:
//! - 管理活跃的 Transport 连接（支持多连接）
//! - 管理数据总线（多通道共享数据管道）
//! - 收发数据包缓冲

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use transport::Transport;
use transport::tcp::TcpServerTransport;

// ── 数据包 & 日志 ──────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct PacketEntry {
    pub timestamp: String,
    pub direction: String, // rx / tx
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub hex: String,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

// ── 数据总线 ──────────────────────────────────────────────────

/// 总线订阅方向
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BusDirection {
    /// 将通道的 RX 数据推送到总线
    RxToBus,
    /// 将总线数据写入通道的 TX
    TxFromBus,
    /// 双向：RX 推总线 + 总线写 TX
    Both,
}

/// 总线订阅条目
#[derive(Debug, Clone)]
pub struct BusSubscription {
    pub channel_id: String,
    pub direction: BusDirection,
}

/// 数据总线 — 多通道共享数据管道
///
/// 设计：任意数量的通道可以订阅同一条总线。
/// - RxToBus: 通道 RX → 总线广播
/// - TxFromBus: 总线广播 → 通道 TX
/// - Both: 双向
///
/// 点对点转发 = 2 个通道订阅同一总线，一个 RxToBus + 一个 TxFromBus
/// 广播 = 1 个 RxToBus + N 个 TxFromBus
pub struct DataBus {
    pub id: String,
    pub name: String,
    pub subscriptions: Vec<BusSubscription>,
    pub bus_tx: broadcast::Sender<Vec<u8>>,
    pub cancel: Arc<AtomicBool>,
    pub threads: Vec<std::thread::JoinHandle<()>>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// 总线信息（序列化给前端）
#[derive(Debug, Clone, serde::Serialize)]
pub struct BusInfo {
    pub id: String,
    pub name: String,
    pub subscriptions: Vec<BusSubInfo>,
    pub status: String, // "running" / "stopped"
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
    /// 活跃的传输通道: channel_id → transport
    pub channels: Arc<RwLock<HashMap<String, Arc<dyn Transport>>>>,
    /// 每个通道的取消标志
    pub channel_cancels: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    /// 每个通道的读线程句柄
    pub channel_readers: Arc<RwLock<HashMap<String, std::thread::JoinHandle<()>>>>,

    /// TCP Server 实例（用于提取新客户端）
    pub tcp_servers: Arc<RwLock<HashMap<String, Arc<TcpServerTransport>>>>,

    /// 数据总线: bus_id → DataBus
    pub buses: RwLock<HashMap<String, DataBus>>,

    /// 数据包缓冲（共享）
    pub packets: Arc<Mutex<Vec<PacketEntry>>>,
    /// RX 事件广播（转发器和终端都订阅）
    pub rx_broadcast: broadcast::Sender<RxBroadcastEvent>,

    /// 日志
    pub logs: Arc<Mutex<Vec<LogEntry>>>,
    /// 日志广播（事件桥接订阅）
    pub log_broadcast: broadcast::Sender<LogEntry>,
}

#[derive(Debug, Clone)]
pub struct RxBroadcastEvent {
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub timestamp: String,
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
            buses: RwLock::new(HashMap::new()),
            packets: Arc::new(Mutex::new(Vec::with_capacity(10000))),
            rx_broadcast,
            logs: Arc::new(Mutex::new(Vec::with_capacity(1000))),
            log_broadcast,
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

    /// 为某个 channel 启动读线程，将收到的数据推入 packets + broadcast
    pub async fn spawn_reader(
        &self,
        channel_id: String,
        transport: Arc<dyn Transport>,
    ) {
        let cancel = Arc::new(AtomicBool::new(false));
        self.channel_cancels
            .write()
            .await
            .insert(channel_id.clone(), cancel.clone());

        let packets = self.packets.clone();
        let rx_tx = self.rx_broadcast.clone();
        let log = self.logs.clone();
        let cid = channel_id.clone();
        let rt = tokio::runtime::Handle::current();

        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                match transport.read(&mut buf) {
                    Ok(0) => {
                        let desc = transport.descriptor();
                        if desc.kind == "tcp_client" || desc.kind == "tcp_server" || desc.kind == "tcp_server_client" {
                            cancel.store(true, Ordering::Relaxed);
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let ts = chrono::Local::now()
                            .format("%H:%M:%S%.3f")
                            .to_string();
                        let hex_str = hex::encode(&data);
                        let text = String::from_utf8_lossy(&data).to_string();

                        {
                            let pkts = packets.clone();
                            rt.block_on(async {
                                let mut pkts = pkts.lock().await;
                                pkts.push(PacketEntry {
                                    timestamp: ts.clone(),
                                    direction: "rx".to_string(),
                                    channel_id: cid.clone(),
                                    bytes: data.clone(),
                                    hex: hex_str,
                                    text,
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
                        });
                    }
                    Err(_e) => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }
            rt.block_on(async {
                let mut lg = log.lock().await;
                lg.push(LogEntry {
                    timestamp: chrono::Local::now()
                        .format("%H:%M:%S%.3f")
                        .to_string(),
                    level: "info".to_string(),
                    source: "reader".to_string(),
                    message: format!("读线程退出: {}", cid),
                });
            });
        });

        self.channel_readers
            .write()
            .await
            .insert(channel_id.clone(), handle);
    }

    /// 停止某个 channel 的读线程并移除
    pub async fn remove_channel(&self, channel_id: &str) {
        if let Some(cancel) = self.channel_cancels.write().await.remove(channel_id) {
            cancel.store(true, Ordering::Relaxed);
        }
        if let Some(handle) = self.channel_readers.write().await.remove(channel_id) {
            let _ = handle.join();
        }
        self.channels.write().await.remove(channel_id);
    }

    /// 发送数据到指定 channel
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
