//! 连接管理命令 — 真实的串口/TCP 连接

use crate::state::AppState;
use tauri::State;
use std::sync::Arc;
use transport::Transport;

#[derive(serde::Deserialize)]
pub struct ConnectRequest {
    pub conn_type: String, // serial / tcp_client / tcp_server
    pub port: Option<String>,
    pub baud_rate: Option<u32>,
    pub host: Option<String>,
    pub tcp_port: Option<u16>,
    pub half_duplex: Option<bool>,
}

#[derive(serde::Serialize)]
pub struct ConnectResponse {
    pub success: bool,
    pub message: String,
    pub channel_id: String,
}

#[derive(serde::Serialize)]
pub struct PortInfoResponse {
    pub name: String,
    pub description: String,
}

#[derive(serde::Serialize)]
pub struct ConnectionStatusResponse {
    pub connected: bool,
    pub channel_id: String,
    pub transport_type: String,
    pub port_name: String,
}

/// 连接到设备 — 真实建立串口/TCP 连接并启动读线程
#[tauri::command]
pub async fn connect(
    request: ConnectRequest,
    state: State<'_, AppState>,
) -> Result<ConnectResponse, String> {
    let channel_id = match request.conn_type.as_str() {
        "serial" => {
            let port = request.port.ok_or("请选择串口")?;
            let baud_rate = request.baud_rate.unwrap_or(115200);
            let half_duplex = request.half_duplex.unwrap_or(false);

            let config = transport::serial::SerialConfig {
                port: port.clone(),
                baud_rate,
                data_bits: 8,
                stop_bits: 1,
                parity: "None".to_string(),
                half_duplex,
            };
            let mut transport = transport::serial::SerialTransport::new(config);
            transport
                .open()
                .map_err(|e| format!("串口打开失败: {}", e))?;

            let channel_id = format!("serial-{}", port);
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            // 启动读线程
            state.spawn_reader(channel_id.clone(), transport).await;

            state
                .log("info", "connection", &format!("串口 {} 已打开 @ {} baud", port, baud_rate))
                .await;

            channel_id
        }
        "tcp_client" => {
            let host = request.host.ok_or("请输入主机地址")?;
            let port = request.tcp_port.unwrap_or(5000);

            let mut transport = transport::tcp::TcpClientTransport::new(host.clone(), port);
            transport
                .open()
                .map_err(|e| format!("TCP 连接失败: {}", e))?;

            let channel_id = format!("tcp-{}:{}", host, port);
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            // 启动读线程
            state.spawn_reader(channel_id.clone(), transport).await;

            state
                .log("info", "connection", &format!("TCP {}:{} 已连接", host, port))
                .await;

            channel_id
        }
        "tcp_server" => {
            let bind_addr = request.host.unwrap_or_else(|| "0.0.0.0".to_string());
            let port = request.tcp_port.ok_or("请输入监听端口")?;

            let mut transport = transport::tcp::TcpServerTransport::new(bind_addr.clone(), port);
            transport
                .open()
                .map_err(|e| format!("TCP Server 启动失败: {}", e))?;

            let channel_id = format!("tcp_server-{}:{}", bind_addr, port);
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            // 启动读线程
            state.spawn_reader(channel_id.clone(), transport).await;

            state
                .log("info", "connection", &format!("TCP Server 监听 {}:{} 已就绪", bind_addr, port))
                .await;

            channel_id
        }
        other => return Err(format!("不支持的连接类型: {}", other)),
    };

    Ok(ConnectResponse {
        success: true,
        message: format!("已连接: {}", channel_id),
        channel_id,
    })
}

/// 断开指定通道
#[tauri::command]
pub async fn disconnect(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ConnectResponse, String> {
    state.remove_channel(&channel_id).await;
    state
        .log("info", "connection", &format!("{} 已断开", channel_id))
        .await;

    Ok(ConnectResponse {
        success: true,
        message: format!("{} 已断开", channel_id),
        channel_id,
    })
}

/// 断开所有通道
#[tauri::command]
pub async fn disconnect_all(
    state: State<'_, AppState>,
) -> Result<ConnectResponse, String> {
    let ids: Vec<String> = state.channels.read().await.keys().cloned().collect();
    for id in &ids {
        state.remove_channel(id).await;
    }
    state
        .log("info", "connection", "所有通道已断开")
        .await;

    Ok(ConnectResponse {
        success: true,
        message: "所有通道已断开".to_string(),
        channel_id: String::new(),
    })
}

/// 列出可用串口
#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortInfoResponse>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| PortInfoResponse {
            name: p.port_name,
            description: format!("{:?}", p.port_type),
        })
        .collect())
}

/// 获取所有连接状态
#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionStatusResponse>, String> {
    let channels = state.channels.read().await;
    let mut result = Vec::new();
    for (id, transport) in channels.iter() {
        let desc = transport.descriptor();
        result.push(ConnectionStatusResponse {
            connected: transport.is_active(),
            channel_id: id.clone(),
            transport_type: desc.kind.clone(),
            port_name: desc.address.clone(),
        });
    }
    Ok(result)
}
