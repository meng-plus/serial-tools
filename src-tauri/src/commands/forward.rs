//! 数据总线命令 — 多通道共享数据管道
//!
//! 总线模型：
//!   - create_bus: 创建命名总线
//!   - subscribe_bus: 将通道订阅到总线（可选方向）
//!   - unsubscribe_bus: 取消订阅
//!   - list_buses: 列出所有总线
//!   - stop_bus / delete_bus: 停止/删除总线
//!
//! 点对点转发 = 2 个通道订阅同一总线（A:RxToBus, B:TxFromBus）
//! 广播 = 1 个 RxToBus + N 个 TxFromBus

use crate::state::{AppState, BusDirection, BusInfo, BusSubInfo, DataBus};
use std::sync::atomic::{AtomicBool, Ordering};
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
        threads: Vec::new(),
        rx_bytes: 0,
        tx_bytes: 0,
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
    // 验证通道存在
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

    // 检查是否已订阅
    if bus.subscriptions.iter().any(|s| s.channel_id == request.channel_id) {
        return Err(format!("通道 {} 已订阅此总线", request.channel_id));
    }

    // 获取通道 transport
    let channels = state.channels.read().await;
    let transport = channels
        .get(&request.channel_id)
        .ok_or_else(|| format!("通道 {} 不存在", request.channel_id))?
        .clone();
    drop(channels);

    let channel_id = request.channel_id.clone();
    let bus_tx = bus.bus_tx.clone();
    let cancel = bus.cancel.clone();

    // RxToBus / Both: 启动读线程，将通道 RX 推送到总线
    if direction == BusDirection::RxToBus || direction == BusDirection::Both {
        let transport_clone = transport.clone();
        let bus_tx_clone = bus_tx.clone();
        let cancel_clone = cancel.clone();
        let cid = channel_id.clone();

        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match transport_clone.read(&mut buf) {
                    Ok(0) => {
                        let desc = transport_clone.descriptor();
                        if desc.kind.starts_with("tcp") {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let _ = bus_tx_clone.send(data);
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
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
        let cid = channel_id.clone();

        let handle = std::thread::spawn(move || {
            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match bus_rx.try_recv() {
                    Ok(data) => {
                        if let Err(e) = transport_clone.write(&data) {
                            eprintln!("[bus] 写入 {} 失败: {}", cid, e);
                        }
                    }
                    Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                        // 跳过滞后的数据
                    }
                    Err(tokio::sync::broadcast::error::TryRecvError::Closed) => {
                        break;
                    }
                }
            }
            eprintln!("[bus] {} TxFromBus 线程退出", cid);
        });
        bus.threads.push(handle);
    }

    bus.subscriptions.push(crate::state::BusSubscription {
        channel_id: channel_id.clone(),
        direction: direction.clone(),
    });

    let dir_str = match direction {
        BusDirection::RxToBus => "rx_to_bus",
        BusDirection::TxFromBus => "tx_from_bus",
        BusDirection::Both => "both",
    };

    state
        .log("info", "bus", &format!("通道 {} 订阅总线 [{}] ({})", channel_id, bus.name, dir_str))
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

    bus.subscriptions.retain(|s| s.channel_id != channel_id);

    state
        .log("info", "bus", &format!("通道 {} 取消订阅总线 [{}]", channel_id, bus.name))
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
            rx_bytes: b.rx_bytes,
            tx_bytes: b.tx_bytes,
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
    for thread in bus.threads.drain(..) {
        let _ = thread.join();
    }

    state
        .log("info", "bus", &format!("总线 [{}] 已停止", bus.name))
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
    state
        .log("info", "bus", &format!("总线 [{}] 已删除", bus.name))
        .await;
    Ok(true)
}
