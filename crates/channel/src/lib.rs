//! Channel — 统一通信链路管理
//!
//! 组合 Transport、双向队列、状态和统计。
//! Channel 不包含 Framer 或协议编解码器。

use transport::{Transport, TransportChunk, Direction, TransportError};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub mod state;
pub mod manager;

/// Channel 事件
#[derive(Debug, Clone)]
pub enum ChannelEvent {
    StateChanged {
        channel_id: String,
        state: ChannelState,
    },
    Rx {
        channel_id: String,
        timestamp: String,
        bytes: Vec<u8>,
    },
    TxCompleted {
        channel_id: String,
        request_id: String,
        timestamp: String,
        bytes: Vec<u8>,
    },
    Error {
        channel_id: String,
        message: String,
    },
}

/// Channel 状态
#[derive(Debug, Clone, PartialEq)]
pub enum ChannelState {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

/// Channel 统计
#[derive(Debug, Default)]
pub struct ChannelStats {
    pub rx_bytes: AtomicU64,
    pub tx_bytes: AtomicU64,
    pub rx_packets: AtomicU64,
    pub tx_packets: AtomicU64,
    pub errors: AtomicU64,
}

/// 通信通道
pub struct Channel {
    id: String,
    name: String,
    transport: RwLock<Option<Box<dyn Transport>>>,
    state: RwLock<ChannelState>,
    stats: ChannelStats,
    events: broadcast::Sender<ChannelEvent>,
    active: AtomicBool,
}

impl Channel {
    pub fn new(id: String, name: String) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            id,
            name,
            transport: RwLock::new(None),
            state: RwLock::new(ChannelState::Disconnected),
            stats: ChannelStats::default(),
            events,
            active: AtomicBool::new(false),
        }
    }

    pub async fn open(&self, mut transport: Box<dyn Transport>) -> Result<(), TransportError> {
        *self.state.write().await = ChannelState::Connecting;
        transport.open()?;
        *self.transport.write().await = Some(transport);
        *self.state.write().await = ChannelState::Connected;
        self.active.store(true, Ordering::SeqCst);
        let _ = self.events.send(ChannelEvent::StateChanged {
            channel_id: self.id.clone(),
            state: ChannelState::Connected,
        });
        Ok(())
    }

    pub async fn close(&self) -> Result<(), TransportError> {
        if let Some(mut transport) = self.transport.write().await.take() {
            transport.close()?;
        }
        self.active.store(false, Ordering::SeqCst);
        *self.state.write().await = ChannelState::Disconnected;
        let _ = self.events.send(ChannelEvent::StateChanged {
            channel_id: self.id.clone(),
            state: ChannelState::Disconnected,
        });
        Ok(())
    }

    pub async fn send(&self, bytes: Vec<u8>) -> Result<(), TransportError> {
        let transport = self.transport.read().await;
        let transport = transport.as_ref().ok_or(TransportError::NotConnected)?;
        let sent = transport.write(&bytes)?;
        self.stats.tx_bytes.fetch_add(sent as u64, Ordering::Relaxed);
        self.stats.tx_packets.fetch_add(1, Ordering::Relaxed);
        let _ = self.events.send(ChannelEvent::TxCompleted {
            channel_id: self.id.clone(),
            request_id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            bytes,
        });
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ChannelEvent> {
        self.events.subscribe()
    }

    pub fn stats(&self) -> &ChannelStats {
        &self.stats
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}
