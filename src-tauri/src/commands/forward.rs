//! 数据总线命令 — 参数校验与编排，线程生命周期交给 `BusRegistry`
//!
//! 点对点转发 = 2 个通道订阅同一总线（A:RxToBus, B:TxFromBus）
//! 广播 = 1 个 RxToBus + N 个 TxFromBus

use crate::domain::bus_registry::BusDirection;
use crate::error::CommandError;
use crate::state::AppState;
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
) -> Result<BusResponse, CommandError> {
    let bus_id = state.buses.create(&request.name).await;
    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Bus,
            &format!("总线 [{}] 已创建", request.name),
        )
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
) -> Result<BusResponse, CommandError> {
    if !state.channels.contains(&request.channel_id).await {
        return Err(CommandError::ChannelNotFound(request.channel_id.clone()));
    }

    let direction = match request.direction.as_str() {
        "rx_to_bus" => BusDirection::RxToBus,
        "tx_from_bus" => BusDirection::TxFromBus,
        "both" => BusDirection::Both,
        _ => {
            return Err(CommandError::InvalidRequest(format!(
                "不支持的方向: {}",
                request.direction
            )))
        }
    };

    let transport = state
        .channels
        .get_transport(&request.channel_id)
        .await
        .ok_or_else(|| CommandError::ChannelNotFound(request.channel_id.clone()))?;

    state
        .buses
        .subscribe(
            &request.bus_id,
            &request.channel_id,
            &direction,
            transport,
            state.packets.subscribe_rx(),
        )
        .await?;

    let dir_str = match direction {
        BusDirection::RxToBus => "rx_to_bus",
        BusDirection::TxFromBus => "tx_from_bus",
        BusDirection::Both => "both",
    };

    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Bus,
            &format!(
                "通道 {} 订阅总线 [{}] ({})",
                request.channel_id, request.bus_id, dir_str
            ),
        )
        .await;

    Ok(BusResponse {
        success: true,
        bus_id: request.bus_id,
        message: format!("通道 {} 已订阅", request.channel_id),
    })
}

/// 取消订阅
#[tauri::command]
pub async fn unsubscribe_bus(
    bus_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<BusResponse, CommandError> {
    state.buses.unsubscribe(&bus_id, &channel_id).await?;

    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Bus,
            &format!("通道 {} 取消订阅总线 [{}]", channel_id, bus_id),
        )
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
) -> Result<Vec<crate::state::BusInfo>, CommandError> {
    Ok(state.buses.list().await)
}

/// 停止总线
#[tauri::command]
pub async fn stop_bus(
    bus_id: String,
    state: State<'_, AppState>,
) -> Result<BusResponse, CommandError> {
    state.buses.stop(&bus_id).await?;
    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Bus,
            &format!("总线 [{}] 已停止", bus_id),
        )
        .await;

    Ok(BusResponse {
        success: true,
        bus_id,
        message: "总线已停止".to_string(),
    })
}

/// 删除总线（必须先停止）
#[tauri::command]
pub async fn delete_bus(bus_id: String, state: State<'_, AppState>) -> Result<bool, CommandError> {
    state.buses.delete(&bus_id).await?;
    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Bus,
            &format!("总线 [{}] 已删除", bus_id),
        )
        .await;
    Ok(true)
}
