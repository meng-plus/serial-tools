//! TCP Server 新客户端监控线程
//!
//! 从 `TcpServerTransport::take_new_clients` 取流，经 `register_server_client` 统一入账。

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use transport::tcp::{TcpClientTransport, TcpServerTransport};
use transport::Transport;

use crate::channel_lifecycle::emit_connected;
use crate::state::AppState;

/// 启动监控线程：Server 关闭（`!is_active`）后自动退出
pub fn spawn_tcp_server_monitor(
    server: Arc<TcpServerTransport>,
    server_channel_id: String,
    app: AppHandle,
) {
    let rt = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if !server.is_active() {
                break;
            }
            for (addr, stream) in server.take_new_clients() {
                let client_id = format!("tcp_client-{}", addr);
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(10)));
                let client_transport: Arc<dyn Transport> =
                    Arc::new(TcpClientTransport::from_stream(stream, addr));

                let app_handle = app.clone();
                let server_id = server_channel_id.clone();
                let server_ref = server.clone();
                let clients_now = server_ref.client_info();

                rt.block_on(async {
                    let state = app_handle.state::<AppState>();
                    state
                        .register_server_client(
                            client_id.clone(),
                            server_id.clone(),
                            client_transport,
                            app_handle.clone(),
                        )
                        .await;

                    emit_connected(
                        &app_handle,
                        client_id.clone(),
                        "tcp_server_client".to_string(),
                        format!("{}", addr),
                        Some(server_id.clone()),
                        Some(clients_now.clone()),
                    );
                    emit_connected(
                        &app_handle,
                        server_id.clone(),
                        "tcp_server".to_string(),
                        server_id
                            .strip_prefix("tcp_server-")
                            .unwrap_or(&server_id)
                            .to_string(),
                        None,
                        Some(clients_now),
                    );

                    state
                        .log(
                            "info",
                            "tcp_server",
                            &format!("新客户端通道已创建: {}", addr),
                        )
                        .await;
                });
            }
        }
    });
}
