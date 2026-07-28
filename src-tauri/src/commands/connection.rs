//! 连接管理命令

use crate::state::AppState;
use tauri::State;

#[derive(serde::Deserialize)]
pub struct ConnectRequest {
    pub conn_type: String, // serial / tcp_client / tcp_server / mqtt
    pub port: Option<String>,
    pub baud_rate: Option<u32>,
    pub host: Option<String>,
    pub tcp_port: Option<u16>,
}

#[derive(serde::Serialize)]
pub struct ConnectResponse {
    pub success: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct PortInfoResponse {
    pub name: String,
    pub description: String,
}

#[derive(serde::Serialize)]
pub struct ConnectionStatusResponse {
    pub connected: bool,
    pub status: String,
    pub transport_type: String,
    pub port_name: String,
}

#[tauri::command]
pub async fn connect(
    request: ConnectRequest,
    state: State<'_, AppState>,
) -> Result<ConnectResponse, String> {
    // TODO: 使用 transport crate 建立连接
    state.set_connected(true);
    {
        *state.transport_type.write().await = Some(request.conn_type.clone());
        *state.port_name.write().await = request.port.clone();
    }
    state.log("info", "connection", &format!("连接到 {:?} 成功", request.port)).await;

    Ok(ConnectResponse {
        success: true,
        message: format!("已连接到 {}", request.port.unwrap_or_default()),
    })
}

#[tauri::command]
pub async fn disconnect(
    state: State<'_, AppState>,
) -> Result<ConnectResponse, String> {
    state.set_connected(false);
    *state.transport_type.write().await = None;
    *state.port_name.write().await = None;
    state.log("info", "connection", "已断开连接").await;

    Ok(ConnectResponse {
        success: true,
        message: "已断开连接".to_string(),
    })
}

#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortInfoResponse>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| PortInfoResponse {
            name: p.port_name,
            description: p.description,
        })
        .collect())
}

#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
) -> Result<ConnectionStatusResponse, String> {
    let connected = state.is_connected();
    let transport_type = state.transport_type.read().await.clone().unwrap_or_default();
    let port_name = state.port_name.read().await.clone().unwrap_or_default();

    Ok(ConnectionStatusResponse {
        connected,
        status: if connected { "已连接".to_string() } else { "空闲".to_string() },
        transport_type,
        port_name,
    })
}
