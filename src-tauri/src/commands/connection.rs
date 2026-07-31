//! 连接管理命令 — 真实的串口/TCP 连接

use crate::event_bridge::ConnectionEventPayload;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};
use std::sync::Arc;
use transport::Transport;
use transport::tcp::TcpServerTransport;

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

            state.spawn_reader(channel_id.clone(), transport).await;

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

            state.spawn_reader(channel_id.clone(), transport).await;

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

            // 保存具体类型用于客户端监控
            let server_arc = Arc::new(server);
            state.tcp_servers.write().await.insert(channel_id.clone(), server_arc.clone());

            // 同时作为 dyn Transport 存入 channels
            let transport: Arc<dyn Transport> = server_arc.clone();
            state
                .channels
                .write()
                .await
                .insert(channel_id.clone(), transport.clone());

            state.spawn_reader(channel_id.clone(), transport).await;

            // 启动客户端监控线程：检测新连接的客户端，创建独立通道
            let channels = state.channels.clone();
            let cancels = state.channel_cancels.clone();
            let readers = state.channel_readers.clone();
            let packets = state.packets.clone();
            let rx_tx = state.rx_broadcast.clone();
            let log = state.logs.clone();
            let rt = tokio::runtime::Handle::current();
            let monitor_server = server_arc.clone();

            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let new_clients = monitor_server.take_new_clients();
                    for (addr, stream) in new_clients {
                        let client_id = format!("tcp_client-{}", addr);
                        stream.set_read_timeout(Some(std::time::Duration::from_millis(10))).ok();
                        let client_transport: Arc<dyn Transport> = Arc::new(
                            transport::tcp::TcpClientTransport::from_stream(stream, addr)
                        );

                        let rt2 = rt.clone();
                        let channels2 = channels.clone();
                        rt.block_on(async {
                            channels2.write().await.insert(client_id.clone(), client_transport.clone());
                        });

                        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                        let cancels2 = cancels.clone();
                        rt.block_on(async {
                            cancels2.write().await.insert(client_id.clone(), cancel.clone());
                        });

                        let pkts = packets.clone();
                        let rx = rx_tx.clone();
                        let lg = log.clone();
                        let cid = client_id.clone();
                        let transport_ref = client_transport.clone();

                        let handle = std::thread::spawn(move || {
                            let mut buf = [0u8; 4096];
                            loop {
                                if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                                    break;
                                }
                                match transport_ref.read(&mut buf) {
                                    Ok(0) => {
                                        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
                                        break;
                                    }
                                    Ok(n) => {
                                        let data = buf[..n].to_vec();
                                        let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
                                        let hex_str = hex::encode(&data);
                                        let text = String::from_utf8_lossy(&data).to_string();
                                        rt2.block_on(async {
                                            let mut pkts = pkts.lock().await;
                                            pkts.push(crate::state::PacketEntry {
                                                timestamp: ts.clone(),
                                                direction: "rx".to_string(),
                                                channel_id: cid.clone(),
                                                bytes: data.clone(),
                                                hex: hex_str,
                                                text,
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
                                        });
                                    }
                                    Err(_) => {
                                        std::thread::sleep(std::time::Duration::from_millis(10));
                                    }
                                }
                            }
                            let lg2 = lg.clone();
                            rt2.block_on(async {
                                lg2.lock().await.push(crate::state::LogEntry {
                                    timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                                    level: "info".to_string(),
                                    source: "reader".to_string(),
                                    message: format!("客户端通道退出: {}", cid),
                                });
                            });
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

    // 推送连接事件给前端
    let _ = app.emit("connection-changed", ConnectionEventPayload {
        channel_id: channel_id.clone(),
        connected: true,
        transport_type: kind,
        port_name: addr,
    });

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
    state.remove_channel(&channel_id).await;
    state
        .log("info", "connection", &format!("{} 已断开", channel_id))
        .await;

    // 推送断开事件给前端
    let _ = app.emit("connection-changed", ConnectionEventPayload {
        channel_id: channel_id.clone(),
        connected: false,
        transport_type: String::new(),
        port_name: String::new(),
    });

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
    app: AppHandle,
) -> Result<ConnectResponse, String> {
    let ids: Vec<String> = state.channels.read().await.keys().cloned().collect();
    for id in &ids {
        state.remove_channel(id).await;
        // 逐个推送断开事件
        let _ = app.emit("connection-changed", ConnectionEventPayload {
            channel_id: id.clone(),
            connected: false,
            transport_type: String::new(),
            port_name: String::new(),
        });
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
            clients: transport.client_info(),
        });
    }
    Ok(result)
}
