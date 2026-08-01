//! 通道生命周期 — 注册 / 优雅关闭 / 对端断开清理 / 事件发射
//!
//! 本端 disconnect、读线程对端 EOF/RST、Server 踢人共用同一套清理顺序，
//! 避免散落的 remove/emit/kick 不一致。

use std::net::SocketAddr;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use transport::Transport;

use crate::disconnect_reason::DisconnectReason;
use crate::state::{AppState, ConnectionEventPayload, LogEntry};

/// 连接建立成功时推送（无 reason）
pub fn emit_connected(
    app: &AppHandle,
    channel_id: String,
    transport_type: String,
    port_name: String,
    parent_channel_id: Option<String>,
    server_clients: Option<Vec<String>>,
) {
    let _ = app.emit(
        "connection-changed",
        ConnectionEventPayload {
            channel_id,
            connected: true,
            transport_type,
            port_name,
            parent_channel_id,
            server_clients,
            reason: None,
        },
    );
}

/// 断开事件推送
pub fn emit_disconnected(
    app: &AppHandle,
    channel_id: String,
    transport_type: String,
    port_name: String,
    parent_channel_id: Option<String>,
    server_clients: Option<Vec<String>>,
    reason: DisconnectReason,
) {
    let _ = app.emit(
        "connection-changed",
        ConnectionEventPayload {
            channel_id,
            connected: false,
            transport_type,
            port_name,
            parent_channel_id,
            server_clients,
            reason: Some(reason.as_str().to_string()),
        },
    );
}

impl AppState {
    /// 注册已打开的传输并启动读线程（TCP Server 监听端不要调用）
    pub async fn register_channel(
        &self,
        channel_id: String,
        transport: Arc<dyn Transport>,
        app: AppHandle,
    ) {
        self.channels
            .put_transport(channel_id.clone(), transport.clone())
            .await;
        self.spawn_reader(channel_id, transport, app).await;
    }

    /// 注册 TCP Server 子客户端：先记 parent，再 register_channel
    pub async fn register_server_client(
        &self,
        client_id: String,
        parent_server_id: String,
        transport: Arc<dyn Transport>,
        app: AppHandle,
    ) {
        self.channels
            .set_parent(client_id.clone(), parent_server_id)
            .await;
        self.register_channel(client_id, transport, app).await;
    }

    /// 从 TCP Server 写侧 map 踢出客户端（优雅 FIN）
    pub async fn kick_server_client(&self, parent_server_id: &str, client_channel_id: &str) {
        let Some(addr_str) = client_channel_id.strip_prefix("tcp_client-") else {
            return;
        };
        let Ok(addr) = addr_str.parse::<SocketAddr>() else {
            return;
        };
        if let Some(server) = self.channels.get_server(parent_server_id).await {
            server.kick_client(addr);
        }
    }

    /// 本端主动关闭通道：必要时先踢写侧，再 remove_channel（不 emit）
    pub async fn close_channel_local(&self, channel_id: &str) {
        if channel_id.starts_with("tcp_client-") {
            if let Some(parent) = self.channels.parent_of(channel_id).await {
                self.kick_server_client(&parent, channel_id).await;
            }
        }
        self.remove_channel(channel_id).await;
    }

    /// 关闭 TCP Server 及其全部子客户端（本端），并对子客户端 emit Local
    pub async fn close_server_local(&self, server_channel_id: &str, app: &AppHandle) {
        let child_ids: Vec<String> = self.channels.children_of(server_channel_id).await;

        for child_id in &child_ids {
            self.kick_server_client(server_channel_id, child_id).await;
            self.remove_channel(child_id).await;
            let port = child_id
                .strip_prefix("tcp_client-")
                .unwrap_or(child_id)
                .to_string();
            emit_disconnected(
                app,
                child_id.clone(),
                "tcp_server_client".to_string(),
                port,
                Some(server_channel_id.to_string()),
                None,
                DisconnectReason::Local,
            );
        }

        self.remove_channel(server_channel_id).await;
    }

    /// 对端断开后的清理（读线程经 AppHandle 调用）
    pub async fn finalize_peer_disconnect(
        &self,
        channel_id: &str,
        transport_type: String,
        port_name: String,
        reason: DisconnectReason,
        app: &AppHandle,
    ) {
        let parent = self.channels.parent_of(channel_id).await;

        if let Some(ref parent_id) = parent {
            self.kick_server_client(parent_id, channel_id).await;
        }

        let (transport, _, _) = self.channels.remove(channel_id).await;
        if let Some(t) = transport {
            let _ = t.shutdown();
        }
        self.channels.remove_parent(channel_id).await;

        let remaining = if let Some(ref parent_id) = parent {
            self.channels
                .get_server(parent_id)
                .await
                .map(|s| s.client_info())
        } else {
            None
        };

        let msg = if parent.is_some() {
            match reason {
                DisconnectReason::Remote => format!("客户端已断开: {}", channel_id),
                DisconnectReason::Error => format!("客户端异常断开: {}", channel_id),
                DisconnectReason::Local => reason.user_message(channel_id),
            }
        } else {
            reason.user_message(channel_id)
        };
        self.log(
            reason.log_level(),
            crate::domain::log_source::LogSource::Connection,
            &msg,
        )
        .await;

        emit_disconnected(
            app,
            channel_id.to_string(),
            transport_type,
            port_name,
            parent.clone(),
            remaining.clone(),
            reason,
        );

        if let Some(parent_id) = parent {
            if let Some(clients) = remaining {
                emit_connected(
                    app,
                    parent_id.clone(),
                    "tcp_server".to_string(),
                    parent_id
                        .strip_prefix("tcp_server-")
                        .unwrap_or(&parent_id)
                        .to_string(),
                    None,
                    Some(clients),
                );
            }
        }
    }

    /// 本端已 cancel 时读线程退出记日志
    pub async fn note_reader_exit(&self, channel_id: &str) {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            level: "info".to_string(),
            source: crate::domain::log_source::LogSource::Reader
                .as_str()
                .to_string(),
            message: format!("读线程退出: {}", channel_id),
        };
        let _ = self.log_broadcast.send(entry.clone());
        self.logs.lock().await.push(entry);
    }
}

/// 读线程内通过 AppHandle 收口对端断开（须传入外层捕获的 runtime Handle）
pub fn finalize_from_app(
    app: &AppHandle,
    rt: &tokio::runtime::Handle,
    channel_id: &str,
    transport_type: String,
    port_name: String,
    reason: DisconnectReason,
) {
    let state = app.state::<AppState>();
    rt.block_on(async {
        state
            .finalize_peer_disconnect(channel_id, transport_type, port_name, reason, app)
            .await;
    });
}

pub fn note_reader_exit_from_app(app: &AppHandle, rt: &tokio::runtime::Handle, channel_id: &str) {
    let state = app.state::<AppState>();
    rt.block_on(async {
        state.note_reader_exit(channel_id).await;
    });
}
