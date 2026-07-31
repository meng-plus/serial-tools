//! 连接管理命令 — 真实的串口/TCP 连接

use crate::event_bridge::ConnectionEventPayload;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};
use std::sync::Arc;
use transport::Transport;
use transport::tcp::TcpServerTransport;

fn emit_connection(
    app: &AppHandle,
    channel_id: String,
    connected: bool,
    transport_type: String,
    port_name: String,
    parent_channel_id: Option<String>,
    server_clients: Option<Vec<String>>,
) {
    emit_connection_with_reason(
        app,
        channel_id,
        connected,
        transport_type,
        port_name,
        parent_channel_id,
        server_clients,
        None,
    );
}

fn emit_connection_with_reason(
    app: &AppHandle,
    channel_id: String,
    connected: bool,
    transport_type: String,
    port_name: String,
    parent_channel_id: Option<String>,
    server_clients: Option<Vec<String>>,
    reason: Option<String>,
) {
    let _ = app.emit(
        "connection-changed",
        ConnectionEventPayload {
            channel_id,
            connected,
            transport_type,
            port_name,
            parent_channel_id,
            server_clients,
            reason,
        },
    );
}

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
    pub clients: Vec<String>,
    pub parent_channel_id: Option<String>,
}

#[derive(serde::Serialize)]
pub struct ServerClientInfo {
    pub addr: String,
    pub channel_id: String,
    pub connected: bool,
}

/// 连接到设备 — 真实建立串口/TCP 连接并启动读线程
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
            let transport: Arc<dyn Transport> = Arc::new(transport);
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            state.spawn_reader(channel_id.clone(), transport, app.clone()).await;

            state
                .log("info", "connection", &format!("串口 {} 已打开 @ {} baud", port, baud_rate))
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
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            state.spawn_reader(channel_id.clone(), transport, app.clone()).await;

            state
                .log("info", "connection", &format!("TCP {}:{} 已连接", host, port))
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
            state.tcp_servers.write().await.insert(channel_id.clone(), server_arc.clone());

            let transport: Arc<dyn Transport> = server_arc.clone();
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport);

            // Server 自身不 spawn_reader：RX 由各客户端独占通道负责

            let channels = state.channels.clone();
            let cancels = state.channel_cancels.clone();
            let readers = state.channel_readers.clone();
            let packets = state.packets.clone();
            let rx_tx = state.rx_broadcast.clone();
            let packet_seq = state.packet_seq.clone();
            let log = state.logs.clone();
            let parents = state.client_parents.clone();
            let rt = tokio::runtime::Handle::current();
            let monitor_server = server_arc.clone();
            let app_handle = app.clone();
            let server_channel_id = channel_id.clone();

            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if !monitor_server.is_active() {
                        break;
                    }
                    let new_clients = monitor_server.take_new_clients();
                    for (addr, stream) in new_clients {
                        let client_id = format!("tcp_client-{}", addr);
                        stream.set_read_timeout(Some(std::time::Duration::from_millis(10))).ok();
                        let client_transport: Arc<dyn Transport> = Arc::new(
                            transport::tcp::TcpClientTransport::from_stream(stream, addr)
                        );

                        let rt2 = rt.clone();
                        let channels2 = channels.clone();
                        let parents2 = parents.clone();
                        let server_id = server_channel_id.clone();
                        rt.block_on(async {
                            channels2.write().await.insert(client_id.clone(), client_transport.clone());
                            parents2.write().await.insert(client_id.clone(), server_id);
                        });

                        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                        let cancels2 = cancels.clone();
                        rt.block_on(async {
                            cancels2.write().await.insert(client_id.clone(), cancel.clone());
                        });

                        let pkts = packets.clone();
                        let rx = rx_tx.clone();
                        let seq_counter = packet_seq.clone();
                        let lg = log.clone();
                        let cid = client_id.clone();
                        let transport_ref = client_transport.clone();

                        let server_clients_now = monitor_server.client_info();
                        emit_connection(
                            &app_handle,
                            client_id.clone(),
                            true,
                            "tcp_server_client".to_string(),
                            format!("{}", addr),
                            Some(server_channel_id.clone()),
                            Some(server_clients_now.clone()),
                        );
                        emit_connection(
                            &app_handle,
                            server_channel_id.clone(),
                            true,
                            "tcp_server".to_string(),
                            server_channel_id
                                .strip_prefix("tcp_server-")
                                .unwrap_or(&server_channel_id)
                                .to_string(),
                            None,
                            Some(server_clients_now),
                        );

                        let app_handle2 = app_handle.clone();
                        let channels3 = channels.clone();
                        let cancels3 = cancels.clone();
                        let readers3 = readers.clone();
                        let parents3 = parents.clone();
                        let server_ref = monitor_server.clone();
                        let server_channel_id = server_channel_id.clone();

                        let handle = std::thread::spawn(move || {
                            let mut buf = [0u8; 4096];
                            let mut peer_reason: Option<&'static str> = None;
                            loop {
                                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                                    break;
                                }
                                match transport_ref.read(&mut buf) {
                                    Ok(0) => {
                                        if !cancel.load(std::sync::atomic::Ordering::Relaxed) {
                                            peer_reason = Some("remote");
                                        }
                                        break;
                                    }
                                    Ok(n) => {
                                        let data = buf[..n].to_vec();
                                        let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                                        let hex_str = hex::encode(&data);
                                        let text = String::from_utf8_lossy(&data).to_string();
                                        let seq = seq_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                                        rt2.block_on(async {
                                            let mut pkts = pkts.lock().await;
                                            pkts.push(crate::state::PacketEntry {
                                                timestamp: ts.clone(),
                                                direction: "rx".to_string(),
                                                channel_id: cid.clone(),
                                                bytes: data.clone(),
                                                hex: hex_str,
                                                text,
                                                seq,
                                            });
                                            if pkts.len() > 10000 {
                                                let drain = pkts.len() - 8000;
                                                pkts.drain(..drain);
                                            }
                                        });
                                        let _ = rx.send(crate::state::RxBroadcastEvent {
                                            channel_id: cid.clone(),
                                            bytes: data,
                                            timestamp: ts,
                                            seq,
                                        });
                                    }
                                    Err(e) => {
                                        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                                            break;
                                        }
                                        if e.is_fatal_disconnect() {
                                            peer_reason = Some("error");
                                            break;
                                        }
                                        std::thread::sleep(std::time::Duration::from_millis(10));
                                    }
                                }
                            }

                            // 写侧优雅关闭（若仍在 map 中）
                            let _ = server_ref.kick_client(addr);

                            if let Some(reason) = peer_reason {
                                // 对端断开：清理并通知（区分优雅 / 异常）
                                let _ = transport_ref.shutdown();
                                rt2.block_on(async {
                                    channels3.write().await.remove(&cid);
                                    cancels3.write().await.remove(&cid);
                                    readers3.write().await.remove(&cid);
                                    parents3.write().await.remove(&cid);
                                });
                                let remaining = server_ref.client_info();
                                emit_connection_with_reason(
                                    &app_handle2,
                                    cid.clone(),
                                    false,
                                    "tcp_server_client".to_string(),
                                    format!("{}", addr),
                                    Some(server_channel_id.clone()),
                                    Some(remaining.clone()),
                                    Some(reason.to_string()),
                                );
                                emit_connection(
                                    &app_handle2,
                                    server_channel_id.clone(),
                                    true,
                                    "tcp_server".to_string(),
                                    server_channel_id.strip_prefix("tcp_server-").unwrap_or(&server_channel_id).to_string(),
                                    None,
                                    Some(remaining),
                                );
                                let msg = if reason == "remote" {
                                    format!("客户端已断开: {}", cid)
                                } else {
                                    format!("客户端异常断开: {}", cid)
                                };
                                let level = if reason == "remote" { "info" } else { "warn" };
                                let lg2 = lg.clone();
                                rt2.block_on(async {
                                    lg2.lock().await.push(crate::state::LogEntry {
                                        timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                                        level: level.to_string(),
                                        source: "connection".to_string(),
                                        message: msg,
                                    });
                                });
                            } else {
                                // 本端主动断开：remove_channel 已清理，仅记日志
                                let lg2 = lg.clone();
                                rt2.block_on(async {
                                    lg2.lock().await.push(crate::state::LogEntry {
                                        timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                                        level: "info".to_string(),
                                        source: "reader".to_string(),
                                        message: format!("客户端通道退出: {}", cid),
                                    });
                                });
                            }
                        });

                        let readers2 = readers.clone();
                        rt.block_on(async {
                            readers2.write().await.insert(client_id.clone(), handle);
                        });

                        let lg3 = log.clone();
                        rt.block_on(async {
                            lg3.lock().await.push(crate::state::LogEntry {
                                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                                level: "info".to_string(),
                                source: "tcp_server".to_string(),
                                message: format!("新客户端通道已创建: {}", addr),
                            });
                        });
                    }
                }
            });

            state
                .log("info", "connection", &format!("TCP Server 监听 {}:{} 已就绪", bind_addr, port))
                .await;

            (channel_id, "tcp_server".to_string(), addr)
        }
        other => return Err(format!("不支持的连接类型: {}", other)),
    };

    emit_connection(&app, channel_id.clone(), true, kind, addr, None, None);

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
    // TCP Server：只断开属于本 Server 的子客户端
    if channel_id.starts_with("tcp_server-") {
        let child_ids: Vec<String> = state
            .client_parents
            .read()
            .await
            .iter()
            .filter(|(_, parent)| *parent == &channel_id)
            .map(|(id, _)| id.clone())
            .collect();
        for child_id in &child_ids {
            // 先对写侧发 FIN，再关读侧，避免对端看到 RST/服务异常
            if let Some(addr_str) = child_id.strip_prefix("tcp_client-") {
                if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                    if let Some(server) = state.tcp_servers.read().await.get(&channel_id) {
                        server.kick_client(addr);
                    }
                }
            }
            state.remove_channel(child_id).await;
            emit_connection_with_reason(
                &app,
                child_id.clone(),
                false,
                "tcp_server_client".to_string(),
                child_id.strip_prefix("tcp_client-").unwrap_or(child_id).to_string(),
                Some(channel_id.clone()),
                None,
                Some("local".to_string()),
            );
        }
    }

    // TCP Server 子客户端：同时从 server 写侧 map 踢出（优雅 FIN）
    if channel_id.starts_with("tcp_client-") {
        if let Some(parent) = state.client_parents.read().await.get(&channel_id).cloned() {
            if let Some(addr_str) = channel_id.strip_prefix("tcp_client-") {
                if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                    if let Some(server) = state.tcp_servers.read().await.get(&parent) {
                        server.kick_client(addr);
                    }
                }
            }
        }
    }

    state.remove_channel(&channel_id).await;
    state
        .log("info", "connection", &format!("{} 已断开", channel_id))
        .await;

    emit_connection_with_reason(
        &app,
        channel_id.clone(),
        false,
        String::new(),
        String::new(),
        None,
        None,
        Some("local".to_string()),
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
            let child_ids: Vec<String> = state
                .client_parents
                .read()
                .await
                .iter()
                .filter(|(_, parent)| *parent == &channel_id)
                .map(|(id, _)| id.clone())
                .collect();
            for child_id in &child_ids {
                if let Some(addr_str) = child_id.strip_prefix("tcp_client-") {
                    if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                        if let Some(server) = state.tcp_servers.read().await.get(&channel_id) {
                            server.kick_client(addr);
                        }
                    }
                }
                state.remove_channel(child_id).await;
                emit_connection_with_reason(
                    &app,
                    child_id.clone(),
                    false,
                    "tcp_server_client".to_string(),
                    child_id.strip_prefix("tcp_client-").unwrap_or(child_id).to_string(),
                    Some(channel_id.clone()),
                    None,
                    Some("local".to_string()),
                );
            }
        }

        if channel_id.starts_with("tcp_client-") {
            if let Some(parent) = state.client_parents.read().await.get(&channel_id).cloned() {
                if let Some(addr_str) = channel_id.strip_prefix("tcp_client-") {
                    if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                        if let Some(server) = state.tcp_servers.read().await.get(&parent) {
                            server.kick_client(addr);
                        }
                    }
                }
            }
        }

        state.remove_channel(&channel_id).await;
        emit_connection_with_reason(
            &app,
            channel_id.clone(),
            false,
            String::new(),
            String::new(),
            None,
            None,
            Some("local".to_string()),
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
