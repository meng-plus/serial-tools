//! 连接管理命令 — 串口 / TCP Client / TCP Server

use crate::channel_lifecycle::{emit_connected, emit_disconnected};
use crate::disconnect_reason::DisconnectReason;
use crate::state::AppState;
use crate::tcp_server_monitor::spawn_tcp_server_monitor;
use std::sync::Arc;
use tauri::{AppHandle, State};
use transport::tcp::TcpServerTransport;
use transport::Transport;

#[derive(serde::Deserialize)]
pub struct ConnectRequest {
    pub conn_type: String, // serial / tcp_client / tcp_server
    pub port: Option<String>,
    pub baud_rate: Option<u32>,
    pub host: Option<String>,
    pub tcp_port: Option<u16>,
    pub half_duplex: Option<bool>,
    /// 串口字节间超时断包（ms）
    pub byte_timeout_ms: Option<u64>,
    /// 串口帧超时强制断包（ms）
    pub frame_timeout_ms: Option<u64>,
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
    pub clients: Vec<String>,
    pub parent_channel_id: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ServerClientInfo {
    pub addr: String,
    pub channel_id: String,
    pub connected: bool,
}

/// 连接到设备 — 建立串口/TCP 连接并启动读线程
#[tauri::command]
pub async fn connect(
    request: ConnectRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ConnectResponse, String> {
    let (channel_id, kind, addr) = match request.conn_type.as_str() {
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
            let addr = port.clone();
            let byte_ms = request.byte_timeout_ms.unwrap_or(50);
            let frame_ms = request.frame_timeout_ms.unwrap_or(200);
            let _ = state
                .set_serial_timeouts(&channel_id, byte_ms, frame_ms)
                .await;
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .register_channel(channel_id.clone(), transport, app.clone())
                .await;

            state
                .log(
                    "info",
                    "connection",
                    &format!("串口 {} 已打开 @ {} baud", port, baud_rate),
                )
                .await;

            (channel_id, "serial".to_string(), addr)
        }
        "tcp_client" => {
            let host = request.host.ok_or("请输入主机地址")?;
            let port = request.tcp_port.unwrap_or(5000);

            let mut transport = transport::tcp::TcpClientTransport::new(host.clone(), port);
            transport
                .open()
                .map_err(|e| format!("TCP 连接失败: {}", e))?;

            let channel_id = format!("tcp-{}:{}", host, port);
            let addr = format!("{}:{}", host, port);
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .register_channel(channel_id.clone(), transport, app.clone())
                .await;

            state
                .log(
                    "info",
                    "connection",
                    &format!("TCP {}:{} 已连接", host, port),
                )
                .await;

            (channel_id, "tcp_client".to_string(), addr)
        }
        "tcp_server" => {
            let bind_addr = request.host.unwrap_or_else(|| "0.0.0.0".to_string());
            let port = request.tcp_port.ok_or("请输入监听端口")?;

            let mut server = TcpServerTransport::new(bind_addr.clone(), port);
            server
                .open()
                .map_err(|e| format!("TCP Server 启动失败: {}", e))?;

            let channel_id = format!("tcp_server-{}:{}", bind_addr, port);
            let addr = format!("{}:{}", bind_addr, port);

            let server_arc = Arc::new(server);
            state
                .tcp_servers
                .write()
                .await
                .insert(channel_id.clone(), server_arc.clone());

            let transport: Arc<dyn Transport> = server_arc.clone();
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport);

            // Server 自身不 spawn_reader：RX 由各客户端独占通道负责
            spawn_tcp_server_monitor(server_arc, channel_id.clone(), app.clone());

            state
                .log(
                    "info",
                    "connection",
                    &format!("TCP Server 监听 {}:{} 已就绪", bind_addr, port),
                )
                .await;

            (channel_id, "tcp_server".to_string(), addr)
        }
        other => return Err(format!("不支持的连接类型: {}", other)),
    };

    emit_connected(&app, channel_id.clone(), kind, addr, None, None);

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
    app: AppHandle,
) -> Result<ConnectResponse, String> {
    if channel_id.starts_with("tcp_server-") {
        state.close_server_local(&channel_id, &app).await;
    } else {
        state.close_channel_local(&channel_id).await;
    }

    state
        .log("info", "connection", &format!("{} 已断开", channel_id))
        .await;

    emit_disconnected(
        &app,
        channel_id.clone(),
        String::new(),
        String::new(),
        None,
        None,
        DisconnectReason::Local,
    );

    Ok(ConnectResponse {
        success: true,
        message: format!("{} 已断开", channel_id),
        channel_id,
    })
}

/// 踢出 / 断开单个 TCP Server 客户端（语义同 disconnect(tcp_client-*)）
#[tauri::command]
pub async fn disconnect_client(
    channel_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ConnectResponse, String> {
    if !channel_id.starts_with("tcp_client-") {
        return Err("仅支持 tcp_server 子客户端通道".to_string());
    }
    disconnect(channel_id, state, app).await
}

/// 列出指定 TCP Server 的在线客户端
#[tauri::command]
pub async fn list_server_clients(
    server_channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ServerClientInfo>, String> {
    let parents = state.client_parents.read().await;
    let channels = state.channels.read().await;
    let mut result = Vec::new();
    for (client_id, parent) in parents.iter() {
        if parent == &server_channel_id {
            let connected = channels
                .get(client_id)
                .map(|t| t.is_active())
                .unwrap_or(false);
            let addr = client_id
                .strip_prefix("tcp_client-")
                .unwrap_or(client_id)
                .to_string();
            result.push(ServerClientInfo {
                addr,
                channel_id: client_id.clone(),
                connected,
            });
        }
    }
    Ok(result)
}

/// 断开所有通道
#[tauri::command]
pub async fn disconnect_all(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ConnectResponse, String> {
    let ids: Vec<String> = state.channels.read().await.keys().cloned().collect();
    let mut ordered = ids;
    ordered.sort_by_key(|id| if id.starts_with("tcp_server-") { 0 } else { 1 });

    for channel_id in ordered {
        if !state.channels.read().await.contains_key(&channel_id) {
            continue;
        }

        if channel_id.starts_with("tcp_server-") {
            state.close_server_local(&channel_id, &app).await;
        } else {
            state.close_channel_local(&channel_id).await;
        }

        emit_disconnected(
            &app,
            channel_id.clone(),
            String::new(),
            String::new(),
            None,
            None,
            DisconnectReason::Local,
        );
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

/// 运行中更新串口超时分包参数（仅 serial 通道）
#[tauri::command]
pub async fn set_serial_rx_timeout(
    channel_id: String,
    byte_timeout_ms: u64,
    frame_timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !channel_id.starts_with("serial-") {
        return Err("仅串口通道支持超时分包".into());
    }
    let frame_ms = frame_timeout_ms.unwrap_or_else(|| byte_timeout_ms.saturating_mul(4).max(200));
    state
        .set_serial_timeouts(&channel_id, byte_timeout_ms, frame_ms)
        .await?;
    state
        .log(
            "info",
            "connection",
            &format!(
                "串口 {} 断包超时: byte={}ms frame={}ms",
                channel_id, byte_timeout_ms, frame_ms
            ),
        )
        .await;
    Ok(())
}

/// 获取所有连接状态
#[tauri::command]
pub async fn get_connection_status(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionStatusResponse>, String> {
    let channels = state.channels.read().await;
    let parents = state.client_parents.read().await;
    let mut result = Vec::new();
    for (id, transport) in channels.iter() {
        let desc = transport.descriptor();
        result.push(ConnectionStatusResponse {
            connected: transport.is_active(),
            channel_id: id.clone(),
            transport_type: desc.kind.clone(),
            port_name: desc.address.clone(),
            clients: transport.client_info(),
            parent_channel_id: parents.get(id).cloned(),
        });
    }
    Ok(result)
}
