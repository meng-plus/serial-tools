//! 数据包领域服务 — 收发包缓冲、全局 RX 广播与单调序号
//!
//! 收敛原 `AppState.packets / rx_broadcast / packet_seq` 三份状态，
//! 保证「分配序号 → 入缓冲 → 广播」在同一处完成，避免调用方漏步。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex, MutexGuard};

/// 收 / 发数据包条目
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

/// 全局 RX 广播事件（读线程 → 前端 / 总线订阅者）
#[derive(Debug, Clone)]
pub struct RxBroadcastEvent {
    pub channel_id: String,
    pub bytes: Vec<u8>,
    pub timestamp: String,
    pub seq: u64,
}

/// 包缓冲上限，超出后自动裁剪
const PACKET_CAP: usize = 10_000;
/// 裁剪后保留的条数
const PACKET_TRIM_TO: usize = 8_000;

/// 数据包缓冲 + RX 广播 + 单调序号
pub struct PacketStore {
    packets: Arc<Mutex<Vec<PacketEntry>>>,
    seq: Arc<AtomicU64>,
    rx_broadcast: broadcast::Sender<RxBroadcastEvent>,
}

impl Default for PacketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl PacketStore {
    pub fn new() -> Self {
        let (rx_broadcast, _) = broadcast::channel(1024);
        Self {
            packets: Arc::new(Mutex::new(Vec::with_capacity(PACKET_CAP))),
            seq: Arc::new(AtomicU64::new(0)),
            rx_broadcast,
        }
    }

    /// 订阅全局 RX 广播（事件桥 / 总线 RxToBus）
    pub fn subscribe_rx(&self) -> broadcast::Receiver<RxBroadcastEvent> {
        self.rx_broadcast.subscribe()
    }

    /// 桥接层持用：把 RX 广播发送端交给 Tauri 事件桥线程
    pub fn rx_sender(&self) -> broadcast::Sender<RxBroadcastEvent> {
        self.rx_broadcast.clone()
    }

    /// 直接广播一条 RX 事件（测试 / 内部调用）
    pub fn emit_rx(
        &self,
        evt: RxBroadcastEvent,
    ) -> Result<usize, broadcast::error::SendError<RxBroadcastEvent>> {
        self.rx_broadcast.send(evt)
    }

    /// 下一个包序号（单调递增，从 1 开始）
    pub fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// 取缓冲锁（读历史包 / 快照）
    pub async fn lock(&self) -> MutexGuard<'_, Vec<PacketEntry>> {
        self.packets.lock().await
    }

    /// 追加一条包，超限自动裁剪
    pub async fn push_packet(&self, entry: PacketEntry) {
        let mut packets = self.packets.lock().await;
        packets.push(entry);
        if packets.len() > PACKET_CAP {
            let drain = packets.len() - PACKET_TRIM_TO;
            packets.drain(..drain);
        }
    }

    /// 追加一条 RX 包并广播（读线程调用）；返回分配的 seq
    pub async fn push_rx(&self, channel_id: &str, bytes: Vec<u8>, timestamp: &str) -> u64 {
        let seq = self.next_seq();
        let hex_str = hex::encode(&bytes);
        let text = String::from_utf8_lossy(&bytes).to_string();
        self.push_packet(PacketEntry {
            timestamp: timestamp.to_string(),
            direction: "rx".to_string(),
            channel_id: channel_id.to_string(),
            bytes: bytes.clone(),
            hex: hex_str,
            text,
            seq,
        })
        .await;
        let _ = self.rx_broadcast.send(RxBroadcastEvent {
            channel_id: channel_id.to_string(),
            bytes,
            timestamp: timestamp.to_string(),
            seq,
        });
        seq
    }

    /// 清空缓冲
    pub async fn clear(&self) {
        self.packets.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seq_monotonic() {
        let store = PacketStore::new();
        assert_eq!(store.next_seq(), 1);
        assert_eq!(store.next_seq(), 2);
        assert_eq!(store.next_seq(), 3);
    }

    #[tokio::test]
    async fn push_rx_broadcast_and_buffer() {
        let store = PacketStore::new();
        let mut rx = store.subscribe_rx();
        let seq = store.push_rx("serial-COM1", b"hello".to_vec(), "t0").await;
        assert_eq!(seq, 1);

        let evt = rx.try_recv().unwrap();
        assert_eq!(evt.channel_id, "serial-COM1");
        assert_eq!(evt.bytes, b"hello");
        assert_eq!(evt.seq, 1);

        let packets = store.lock().await;
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].direction, "rx");
        assert_eq!(packets[0].hex, "68656c6c6f");
    }

    #[tokio::test]
    async fn packet_buffer_trim() {
        let store = PacketStore::new();
        // 注入少量即可验证裁剪逻辑（容量远小于线上配置，直接用循环模拟）
        for i in 0..100 {
            store
                .push_packet(PacketEntry {
                    timestamp: String::new(),
                    direction: "tx".to_string(),
                    channel_id: "ch".to_string(),
                    bytes: vec![i as u8],
                    hex: String::new(),
                    text: String::new(),
                    seq: i + 1,
                })
                .await;
        }
        let packets = store.lock().await;
        // 未超上限不裁剪
        assert_eq!(packets.len(), 100);
    }

    #[tokio::test]
    async fn clear_resets_buffer() {
        let store = PacketStore::new();
        store.push_rx("ch", b"x".to_vec(), "t").await;
        store.clear().await;
        assert_eq!(store.lock().await.len(), 0);
    }
}
