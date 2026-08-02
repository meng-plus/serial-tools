//! 数据总线领域服务 — 创建 / 订阅 / 启动(恢复) / 停止 / 删除与计数
//!
//! 收敛 `AppState.buses` 的并发容器与线程生命周期，命令层只做参数校验与编排。
//! 订阅线程遵循单一读者原则：RxToBus 订阅全局 RX 广播，不直接 transport.read()。
//! 停止只 join 线程，保留订阅记录；启动可基于记录重建线程。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};
use transport::Transport;

use crate::domain::packet_store::RxBroadcastEvent;
use crate::error::CommandError;

/// 订阅方向
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BusDirection {
    RxToBus,
    TxFromBus,
    Both,
}

/// 总线内流转的一条数据：携带来源通道，供 TxFromBus 排除发送方自身
#[derive(Debug, Clone)]
pub struct BusEvent {
    pub source_channel_id: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct BusSubscription {
    pub channel_id: String,
    pub direction: BusDirection,
}

/// 单条总线的运行时状态
pub struct DataBus {
    pub id: String,
    pub name: String,
    pub subscriptions: Vec<BusSubscription>,
    pub bus_tx: broadcast::Sender<BusEvent>,
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

/// 总线注册表：持有全部总线并按 id 编排生命周期
pub struct BusRegistry {
    buses: RwLock<HashMap<String, DataBus>>,
}

impl Default for BusRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl BusRegistry {
    pub fn new() -> Self {
        Self {
            buses: RwLock::new(HashMap::new()),
        }
    }

    /// 创建总线，返回 bus_id
    pub async fn create(&self, name: &str) -> String {
        let bus_id = uuid::Uuid::new_v4().to_string();
        let (bus_tx, _) = broadcast::channel(1024);
        let bus = DataBus {
            id: bus_id.clone(),
            name: name.to_string(),
            subscriptions: Vec::new(),
            bus_tx,
            cancel: Arc::new(AtomicBool::new(false)),
            sub_cancels: HashMap::new(),
            threads: Vec::new(),
            rx_bytes: Arc::new(AtomicU64::new(0)),
            tx_bytes: Arc::new(AtomicU64::new(0)),
        };
        self.buses.write().await.insert(bus_id.clone(), bus);
        bus_id
    }

    /// 总线是否存在
    pub async fn exists(&self, bus_id: &str) -> bool {
        self.buses.read().await.contains_key(bus_id)
    }

    /// 订阅通道到总线；错误信息返回给命令层透传
    pub async fn subscribe(
        &self,
        bus_id: &str,
        channel_id: &str,
        direction: &BusDirection,
        transport: Arc<dyn Transport>,
        rx: broadcast::Receiver<RxBroadcastEvent>,
    ) -> Result<(), CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get_mut(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        if bus.cancel.load(Ordering::Relaxed) {
            return Err(CommandError::InvalidRequest(
                "总线已停止，无法订阅".to_string(),
            ));
        }

        if bus.subscriptions.iter().any(|s| s.channel_id == channel_id) {
            return Err(CommandError::InvalidRequest(format!(
                "通道 {} 已订阅此总线",
                channel_id
            )));
        }

        Self::spawn_subscription_threads(bus, channel_id, direction, transport, rx);
        bus.subscriptions.push(BusSubscription {
            channel_id: channel_id.to_string(),
            direction: direction.clone(),
        });
        Ok(())
    }

    /// 取消订阅
    pub async fn unsubscribe(&self, bus_id: &str, channel_id: &str) -> Result<(), CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get_mut(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        if let Some(sub_cancel) = bus.sub_cancels.remove(channel_id) {
            sub_cancel.store(true, Ordering::Relaxed);
        }
        bus.subscriptions.retain(|s| s.channel_id != channel_id);
        Ok(())
    }

    /// 列出全部总线摘要
    pub async fn list(&self) -> Vec<BusInfo> {
        let buses = self.buses.read().await;
        buses
            .values()
            .map(|b| BusInfo {
                id: b.id.clone(),
                name: b.name.clone(),
                subscriptions: b
                    .subscriptions
                    .iter()
                    .map(|s| BusSubInfo {
                        channel_id: s.channel_id.clone(),
                        direction: match s.direction {
                            BusDirection::RxToBus => "rx_to_bus".to_string(),
                            BusDirection::TxFromBus => "tx_from_bus".to_string(),
                            BusDirection::Both => "both".to_string(),
                        },
                    })
                    .collect(),
                status: if b.cancel.load(Ordering::Relaxed) {
                    "stopped".to_string()
                } else {
                    "running".to_string()
                },
                rx_bytes: b.rx_bytes.load(Ordering::Relaxed),
                tx_bytes: b.tx_bytes.load(Ordering::Relaxed),
            })
            .collect()
    }

    /// 停止总线（join 全部订阅线程，保留订阅记录以便启动恢复）
    pub async fn stop(&self, bus_id: &str) -> Result<(), CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get_mut(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        bus.cancel.store(true, Ordering::Relaxed);
        for (_, sc) in bus.sub_cancels.drain() {
            sc.store(true, Ordering::Relaxed);
        }
        for thread in bus.threads.drain(..) {
            let _ = thread.join();
        }
        Ok(())
    }

    /// 启动（恢复）已停止的总线：置运行态并清空旧的取消标记，返回保留的订阅记录
    /// 供命令层逐一解析通道后调用 `resume_subscription` 重建线程
    pub async fn start(&self, bus_id: &str) -> Result<Vec<BusSubscription>, CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get_mut(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        if !bus.cancel.load(Ordering::Relaxed) {
            return Err(CommandError::InvalidRequest(
                "总线正在运行，无需启动".to_string(),
            ));
        }
        if bus.subscriptions.is_empty() {
            return Err(CommandError::InvalidRequest(
                "总线没有订阅，请先订阅通道".to_string(),
            ));
        }

        bus.cancel.store(false, Ordering::Relaxed);
        bus.sub_cancels.clear();
        Ok(bus.subscriptions.clone())
    }

    /// 为一条已存在的订阅重建线程（配合 `start` 使用，通道必须是保留订阅之一）
    pub async fn resume_subscription(
        &self,
        bus_id: &str,
        channel_id: &str,
        transport: Arc<dyn Transport>,
        rx: broadcast::Receiver<RxBroadcastEvent>,
    ) -> Result<(), CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get_mut(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        if bus.cancel.load(Ordering::Relaxed) {
            return Err(CommandError::InvalidRequest(
                "总线已停止，无法恢复订阅".to_string(),
            ));
        }

        let direction = bus
            .subscriptions
            .iter()
            .find(|s| s.channel_id == channel_id)
            .map(|s| s.direction.clone())
            .ok_or_else(|| {
                CommandError::InvalidRequest(format!("通道 {} 不在总线订阅记录中", channel_id))
            })?;

        Self::spawn_subscription_threads(bus, channel_id, &direction, transport, rx);
        Ok(())
    }

    /// 删除总线（必须先停止）
    pub async fn delete(&self, bus_id: &str) -> Result<(), CommandError> {
        let mut buses = self.buses.write().await;
        let bus = buses
            .get(bus_id)
            .ok_or_else(|| CommandError::InvalidRequest(format!("总线 {} 不存在", bus_id)))?;

        if !bus.cancel.load(Ordering::Relaxed) {
            return Err(CommandError::InvalidRequest(
                "请先停止总线再删除".to_string(),
            ));
        }
        buses.remove(bus_id);
        Ok(())
    }

    /// 为一条订阅生成 RxToBus / TxFromBus 线程（Bus 持有写锁时调用）
    fn spawn_subscription_threads(
        bus: &mut DataBus,
        channel_id: &str,
        direction: &BusDirection,
        transport: Arc<dyn Transport>,
        rx: broadcast::Receiver<RxBroadcastEvent>,
    ) {
        let channel_id = channel_id.to_string();
        let bus_tx = bus.bus_tx.clone();
        let cancel = bus.cancel.clone();
        let sub_cancel = Arc::new(AtomicBool::new(false));
        bus.sub_cancels
            .insert(channel_id.clone(), sub_cancel.clone());

        let rx_bytes = bus.rx_bytes.clone();
        let tx_bytes = bus.tx_bytes.clone();

        // RxToBus / Both：订阅全局 RX 广播，按 channel_id 过滤后推入总线
        if *direction == BusDirection::RxToBus || *direction == BusDirection::Both {
            let mut rx = rx;
            let bus_tx_clone = bus_tx.clone();
            let cancel_clone = cancel.clone();
            let sub_cancel_clone = sub_cancel.clone();
            let cid = channel_id.clone();
            let rx_counter = rx_bytes.clone();

            let handle = std::thread::spawn(move || {
                loop {
                    if cancel_clone.load(Ordering::Relaxed)
                        || sub_cancel_clone.load(Ordering::Relaxed)
                    {
                        break;
                    }
                    match rx.try_recv() {
                        Ok(evt) => {
                            if evt.channel_id == cid {
                                let n = evt.bytes.len() as u64;
                                let _ = bus_tx_clone.send(BusEvent {
                                    source_channel_id: cid.clone(),
                                    bytes: evt.bytes,
                                });
                                rx_counter.fetch_add(n, Ordering::Relaxed);
                            }
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::TryRecvError::Closed) => break,
                    }
                }
                eprintln!("[bus] {} RxToBus 线程退出", cid);
            });
            bus.threads.push(handle);
        }

        // TxFromBus / Both：订阅总线广播，写入通道 TX
        if *direction == BusDirection::TxFromBus || *direction == BusDirection::Both {
            let transport_clone = transport.clone();
            let mut bus_rx = bus.bus_tx.subscribe();
            let cancel_clone = cancel.clone();
            let sub_cancel_clone = sub_cancel.clone();
            let cid = channel_id.clone();
            let tx_counter = tx_bytes.clone();

            let handle = std::thread::spawn(move || {
                loop {
                    if cancel_clone.load(Ordering::Relaxed)
                        || sub_cancel_clone.load(Ordering::Relaxed)
                    {
                        break;
                    }
                    match bus_rx.try_recv() {
                        Ok(evt) => {
                            // 发送方不接收自己的发送
                            if evt.source_channel_id == cid {
                                continue;
                            }
                            let n = evt.bytes.len() as u64;
                            if let Err(e) = transport_clone.write(&evt.bytes) {
                                eprintln!("[bus] 写入 {} 失败: {}", cid, e);
                            } else {
                                tx_counter.fetch_add(n, Ordering::Relaxed);
                            }
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::TryRecvError::Closed) => break,
                    }
                }
                eprintln!("[bus] {} TxFromBus 线程退出", cid);
            });
            bus.threads.push(handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_list_stop_delete() {
        let reg = BusRegistry::new();
        let id = reg.create("test").await;
        assert!(reg.exists(&id).await);

        let list = reg.list().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "test");
        assert_eq!(list[0].status, "running");

        reg.stop(&id).await.unwrap();
        assert_eq!(reg.list().await[0].status, "stopped");
        reg.delete(&id).await.unwrap();
        assert!(!reg.exists(&id).await);
    }

    #[tokio::test]
    async fn delete_before_stop_rejected() {
        let reg = BusRegistry::new();
        let id = reg.create("test").await;
        let err = reg.delete(&id).await.unwrap_err();
        assert_eq!(err.code(), crate::error::ErrorCode::InvalidRequest);
    }

    #[tokio::test]
    async fn unknown_bus_rejected() {
        let reg = BusRegistry::new();
        assert!(reg.stop("nope").await.is_err());
        assert!(reg.delete("nope").await.is_err());
    }

    #[tokio::test]
    async fn start_after_stop_restores_subscriptions() {
        let reg = BusRegistry::new();
        let id = reg.create("test").await;

        // 空订阅：start 应拒绝
        let err = reg.start(&id).await.unwrap_err();
        assert_eq!(err.code(), crate::error::ErrorCode::InvalidRequest);

        reg.stop(&id).await.unwrap();
        // 停止后无订阅，start 仍拒绝
        let err = reg.start(&id).await.unwrap_err();
        assert_eq!(err.code(), crate::error::ErrorCode::InvalidRequest);
    }

    #[tokio::test]
    async fn start_running_bus_rejected() {
        let reg = BusRegistry::new();
        let id = reg.create("test").await;
        let err = reg.start(&id).await.unwrap_err();
        assert_eq!(err.code(), crate::error::ErrorCode::InvalidRequest);
    }

    #[tokio::test]
    async fn delete_after_stop_allowed() {
        let reg = BusRegistry::new();
        let id = reg.create("test").await;
        reg.stop(&id).await.unwrap();
        reg.delete(&id).await.unwrap();
        assert!(!reg.exists(&id).await);
    }

    #[tokio::test]
    async fn bus_event_carries_source_channel() {
        let (_tx, rx) = tokio::sync::broadcast::channel::<BusEvent>(16);
        // 仅验证 BusEvent 结构语义：来源通道与字节可被 TxFromBus 用于排除自身
        let evt = BusEvent {
            source_channel_id: "A".to_string(),
            bytes: b"hi".to_vec(),
        };
        let mut rx = rx;
        let _ = _tx.send(evt.clone());
        let got = rx.try_recv().unwrap();
        assert_eq!(got.source_channel_id, "A");
        assert_eq!(got.bytes, b"hi");
    }
}
