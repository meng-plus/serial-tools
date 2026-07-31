//! 数据总线命令 — 多通道共享数据管道
//!
//! RxToBus 订阅 AppState.rx_broadcast（单一读者原则），不直接 transport.read()。
//! 点对点转发 = 2 个通道订阅同一总线（A:RxToBus, B:TxFromBus）
//! 广播 = 1 个 RxToBus + N 个 TxFromBus

use crate::state::{AppState, BusDirection, BusInfo, BusSubInfo, BusSubscription, DataBus};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;

#[derive(serde::Deserialize)]
pub struct CreateBusRequest {
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct SubscribeBusRequest {
    pub bus_id: String,
    pub channel_id: String,
    pub direction: String, // "rx_to_bus" / "tx_from_bus" / "both"
}

#[derive(serde::Serialize)]
pub struct BusResponse {
    pub success: bool,
    pub bus_id: String,
    pub message: String,
}

/// 创建数据总线
#[tauri::command]
pub async fn create_bus(
    request: CreateBusRequest,
    state: State<'_, AppState>,
) -> Result<BusResponse, String> {
    let bus_id = uuid::Uuid::new_v4().to_string();
    let (bus_tx, _) = tokio::sync::broadcast::channel(1024);

    let bus = DataBus {
        id: bus_id.clone(),
        name: request.name.clone(),
        subscriptions: Vec::new(),
        bus_tx,
        cancel: Arc::new(AtomicBool::new(false)),
        sub_cancels: HashMap::new(),
        threads: Vec::new(),
        rx_bytes: Arc::new(AtomicU64::new(0)),
        tx_bytes: Arc::new(AtomicU64::new(0)),
    };

    state.buses.write().await.insert(bus_id.clone(), bus);
    state
        .log("info", "bus", &format!("总线 [{}] 已创建", request.name))
        .await;

    Ok(BusResponse {
        success: true,
        bus_id,
        message: format!("总线 [{}] 已创建", request.name),
    })
}

/// 订阅通道到总线
#[tauri::command]
pub async fn subscribe_bus(
    request: SubscribeBusRequest,
    state: State<'_, AppState>,
) -> Result<BusResponse, String> {
    {
        let channels = state.channels.read().await;
        if !channels.contains_key(&request.channel_id) {
            return Err(format!("通道 {} 不存在", request.channel_id));
        }
    }

    let direction = match request.direction.as_str() {
        "rx_to_bus" => BusDirection::RxToBus,
        "tx_from_bus" => BusDirection::TxFromBus,
        "both" => BusDirection::Both,
        _ => return Err(format!("不支持的方向: {}", request.direction)),
    };

    let mut buses = state.buses.write().await;
    let bus = buses
        .get_mut(&request.bus_id)
        .ok_or_else(|| format!("总线 {} 不存在", request.bus_id))?;

    if bus.cancel.load(Ordering::Relaxed) {
        return Err("总线已停止，无法订阅".to_string());
    }

    if bus.subscriptions.iter().any(|s| s.channel_id == request.channel_id) {
        return Err(format!("通道 {} 已订阅此总线", request.channel_id));
    }

    let channels = state.channels.read().await;
    let transport = channels
        .get(&request.channel_id)
        .ok_or_else(|| format!("通道 {} 不存在", request.channel_id))?
        .clone();
    drop(channels);

    let channel_id = request.channel_id.clone();
    let bus_tx = bus.bus_tx.clone();
    let cancel = bus.cancel.clone();
    let sub_cancel = Arc::new(AtomicBool::new(false));
    bus.sub_cancels.insert(channel_id.clone(), sub_cancel.clone());

    let rx_bytes = bus.rx_bytes.clone();
    let tx_bytes = bus.tx_bytes.clone();

    // RxToBus / Both: 订阅全局 RX 广播，按 channel_id 过滤后推入总线
    if direction == BusDirection::RxToBus || direction == BusDirection::Both {
        let mut rx = state.rx_broadcast.subscribe();
        let bus_tx_clone = bus_tx.clone();
        let cancel_clone = cancel.clone();
        let sub_cancel_clone = sub_cancel.clone();
        let cid = channel_id.clone();
        let rx_counter = rx_bytes.clone();

        let handle = std::thread::spawn(move || {
            loop {
                if cancel_clone.load(Ordering::Relaxed) || sub_cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match rx.try_recv() {
                    Ok(evt) => {
                        if evt.channel_id == cid {
                            let n = evt.bytes.len() as u64;
                            let _ = bus_tx_clone.send(evt.bytes);
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

    // TxFromBus / Both: 订阅总线广播，写入通道 TX
    if direction == BusDirection::TxFromBus || direction == BusDirection::Both {
        let transport_clone = transport.clone();
        let mut bus_rx = bus.bus_tx.subscribe();
        let cancel_clone = cancel.clone();
        let sub_cancel_clone = sub_cancel.clone();
        let cid = channel_id.clone();
        let tx_counter = tx_bytes.clone();

        let handle = std::thread::spawn(move || {
            loop {
                if cancel_clone.load(Ordering::Relaxed) || sub_cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match bus_rx.try_recv() {
                    Ok(data) => {
                        let n = data.len() as u64;
                        if let Err(e) = transport_clone.write(&data) {
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

    bus.subscriptions.push(BusSubscription {
        channel_id: channel_id.clone(),
        direction: direction.clone(),
    });

    let dir_str = match direction {
        BusDirection::RxToBus => "rx_to_bus",
        BusDirection::TxFromBus => "tx_from_bus",
        BusDirection::Both => "both",
    };

    // 释放 buses 写锁后再记日志
    let bus_name = bus.name.clone();
    drop(buses);

    state
        .log("info", "bus", &format!("通道 {} 订阅总线 [{}] ({})", channel_id, bus_name, dir_str))
        .await;

    Ok(BusResponse {
        success: true,
        bus_id: request.bus_id,
        message: format!("通道 {} 已订阅", channel_id),
    })
}

/// 取消订阅
#[tauri::command]
pub async fn unsubscribe_bus(
    bus_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<BusResponse, String> {
    let mut buses = state.buses.write().await;
    let bus = buses
        .get_mut(&bus_id)
        .ok_or_else(|| format!("总线 {} 不存在", bus_id))?;

    if let Some(sub_cancel) = bus.sub_cancels.remove(&channel_id) {
        sub_cancel.store(true, Ordering::Relaxed);
    }
    bus.subscriptions.retain(|s| s.channel_id != channel_id);

    let bus_name = bus.name.clone();
    drop(buses);

    state
        .log("info", "bus", &format!("通道 {} 取消订阅总线 [{}]", channel_id, bus_name))
        .await;

    Ok(BusResponse {
        success: true,
        bus_id,
        message: format!("通道 {} 已取消订阅", channel_id),
    })
}

/// 列出所有总线
#[tauri::command]
pub async fn list_buses(
    state: State<'_, AppState>,
) -> Result<Vec<BusInfo>, String> {
    let buses = state.buses.read().await;
    Ok(buses
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
        .collect())
}

/// 停止总线
#[tauri::command]
pub async fn stop_bus(
    bus_id: String,
    state: State<'_, AppState>,
) -> Result<BusResponse, String> {
    let mut buses = state.buses.write().await;
    let bus = buses
        .get_mut(&bus_id)
        .ok_or_else(|| format!("总线 {} 不存在", bus_id))?;

    bus.cancel.store(true, Ordering::Relaxed);
    for (_, sc) in bus.sub_cancels.drain() {
        sc.store(true, Ordering::Relaxed);
    }
    for thread in bus.threads.drain(..) {
        let _ = thread.join();
    }
    bus.subscriptions.clear();

    let bus_name = bus.name.clone();
    drop(buses);

    state
        .log("info", "bus", &format!("总线 [{}] 已停止", bus_name))
        .await;

    Ok(BusResponse {
        success: true,
        bus_id,
        message: "总线已停止".to_string(),
    })
}

/// 删除总线（必须先停止）
#[tauri::command]
pub async fn delete_bus(
    bus_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut buses = state.buses.write().await;
    let bus = buses
        .get(&bus_id)
        .ok_or_else(|| format!("总线 {} 不存在", bus_id))?;

    if !bus.cancel.load(Ordering::Relaxed) {
        return Err("请先停止总线再删除".to_string());
    }

    let bus = buses.remove(&bus_id).unwrap();
    drop(buses);
    state
        .log("info", "bus", &format!("总线 [{}] 已删除", bus.name))
        .await;
    Ok(true)
}
