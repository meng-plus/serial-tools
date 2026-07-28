//! 端口转发命令 — 串口↔TCP 桥接转发

use crate::state::{AppState, ForwarderInfo, ForwarderStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

#[derive(serde::Deserialize)]
pub struct StartForwardRequest {
    pub name: String,
    pub source_channel_id: String,
    pub target_channel_id: String,
    pub direction: Option<String>, // bidirectional / source_to_target / target_to_source
}

#[derive(serde::Serialize)]
pub struct ForwardResponse {
    pub success: bool,
    pub forwarder_id: String,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct ForwarderInfoResponse {
    pub id: String,
    pub name: String,
    pub source: String,
    pub target: String,
    pub direction: String,
    pub status: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// 启动转发 — 在两个已连接的 channel 之间建立数据桥接
///
/// 原理:
///   source 通道的 RX 数据 → 直接写入 target 通道
///   target 通道的 RX 数据 → 直接写入 source 通道（双向模式）
///
/// 使用 std::thread::spawn + Arc<dyn Transport> 进行同步读写，
/// 因为底层 Transport trait 是同步的。
#[tauri::command]
pub async fn start_forward(
    request: StartForwardRequest,
    state: State<'_, AppState>,
) -> Result<ForwardResponse, String> {
    // 验证两个通道都存在且活跃
    {
        let channels = state.channels.read().await;
        let src = channels
            .get(&request.source_channel_id)
            .ok_or_else(|| format!("源通道 {} 不存在", request.source_channel_id))?;
        if !src.is_active() {
            return Err(format!("源通道 {} 未连接", request.source_channel_id));
        }
        let tgt = channels
            .get(&request.target_channel_id)
            .ok_or_else(|| format!("目标通道 {} 不存在", request.target_channel_id))?;
        if !tgt.is_active() {
            return Err(format!("目标通道 {} 未连接", request.target_channel_id));
        }
    }

    let direction = request.direction.unwrap_or_else(|| "bidirectional".to_string());

    // 如果是双向，检查两个通道不是同一个
    if direction == "bidirectional" && request.source_channel_id == request.target_channel_id {
        return Err("双向转发不能使用同一个通道".to_string());
    }

    let forwarder_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();

    // ── source → target 线程 ──────────────────────────────────
    if direction == "bidirectional" || direction == "source_to_target" {
        let src_transport = {
            let channels = state.channels.read().await;
            channels.get(&request.source_channel_id).unwrap().clone()
        };
        let tgt_transport = {
            let channels = state.channels.read().await;
            channels.get(&request.target_channel_id).unwrap().clone()
        };
        let cancel_clone = cancel.clone();
        let fwd_id = forwarder_id.clone();
        let src_id = request.source_channel_id.clone();
        let tgt_id = request.target_channel_id.clone();
        let _packets = state.packets.clone();

        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match src_transport.read(&mut buf) {
                    Ok(0) => {
                        // TCP 返回 0 = 对端关闭
                        let desc = src_transport.descriptor();
                        if desc.kind.starts_with("tcp") {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(n) => {
                        let data = &buf[..n];
                        // 写入目标
                        if let Err(e) = tgt_transport.write(data) {
                            eprintln!("[fwd {}] 写入 {} 失败: {}", fwd_id, tgt_id, e);
                            // 写失败可能意味着目标断了
                            if tgt_transport.descriptor().kind.starts_with("tcp") {
                                break;
                            }
                        }
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }
            eprintln!("[fwd {}] {}→{} 读线程退出", fwd_id, src_id, tgt_id);
        });
        threads.push(handle);
    }

    // ── target → source 线程（双向） ──────────────────────────
    if direction == "bidirectional" || direction == "target_to_source" {
        let src_transport = {
            let channels = state.channels.read().await;
            channels.get(&request.source_channel_id).unwrap().clone()
        };
        let tgt_transport = {
            let channels = state.channels.read().await;
            channels.get(&request.target_channel_id).unwrap().clone()
        };
        let cancel_clone = cancel.clone();
        let fwd_id = forwarder_id.clone();
        let src_id = request.source_channel_id.clone();
        let tgt_id = request.target_channel_id.clone();

        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                match tgt_transport.read(&mut buf) {
                    Ok(0) => {
                        let desc = tgt_transport.descriptor();
                        if desc.kind.starts_with("tcp") {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(n) => {
                        let data = &buf[..n];
                        if let Err(e) = src_transport.write(data) {
                            eprintln!("[fwd {}] 写入 {} 失败: {}", fwd_id, src_id, e);
                            if src_transport.descriptor().kind.starts_with("tcp") {
                                break;
                            }
                        }
                    }
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }
            eprintln!("[fwd {}] {}→{} 读线程退出", fwd_id, tgt_id, src_id);
        });
        threads.push(handle);
    }

    let info = ForwarderInfo {
        id: forwarder_id.clone(),
        name: request.name.clone(),
        source_channel_id: request.source_channel_id.clone(),
        target_channel_id: request.target_channel_id.clone(),
        direction: direction.clone(),
        status: ForwarderStatus::Running,
        rx_bytes: 0,
        tx_bytes: 0,
    };

    let handle = crate::state::ForwarderHandle {
        info,
        cancel,
        threads,
    };

    state.forwarders.write().await.insert(forwarder_id.clone(), handle);
    state
        .log("info", "forward", &format!("转发 [{}] {} ↔ {} 已启动 ({})", request.name, request.source_channel_id, request.target_channel_id, direction))
        .await;

    Ok(ForwardResponse {
        success: true,
        forwarder_id,
        message: format!("转发已启动: {} ↔ {}", request.source_channel_id, request.target_channel_id),
    })
}

/// 停止转发
#[tauri::command]
pub async fn stop_forward(
    forwarder_id: String,
    state: State<'_, AppState>,
) -> Result<ForwardResponse, String> {
    let mut forwarders = state.forwarders.write().await;
    let handle = forwarders
        .get_mut(&forwarder_id)
        .ok_or_else(|| format!("转发器 {} 不存在", forwarder_id))?;

    // 发送取消信号
    handle.cancel.store(true, Ordering::Relaxed);

    // 等待所有线程退出
    for thread in handle.threads.drain(..) {
        let _ = thread.join();
    }

    handle.info.status = ForwarderStatus::Stopped;

    state
        .log("info", "forward", &format!("转发 [{}] 已停止", handle.info.name))
        .await;

    Ok(ForwardResponse {
        success: true,
        forwarder_id,
        message: "转发已停止".to_string(),
    })
}

/// 列出所有转发器
#[tauri::command]
pub async fn list_forwarders(
    state: State<'_, AppState>,
) -> Result<Vec<ForwarderInfoResponse>, String> {
    let forwarders = state.forwarders.read().await;
    Ok(forwarders
        .values()
        .map(|h| ForwarderInfoResponse {
            id: h.info.id.clone(),
            name: h.info.name.clone(),
            source: h.info.source_channel_id.clone(),
            target: h.info.target_channel_id.clone(),
            direction: h.info.direction.clone(),
            status: match h.info.status {
                ForwarderStatus::Running => "running".to_string(),
                ForwarderStatus::Stopped => "stopped".to_string(),
            },
            rx_bytes: h.info.rx_bytes,
            tx_bytes: h.info.tx_bytes,
        })
        .collect())
}

/// 删除转发器（必须先停止）
#[tauri::command]
pub async fn delete_forwarder(
    forwarder_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut forwarders = state.forwarders.write().await;
    let handle = forwarders
        .get(&forwarder_id)
        .ok_or_else(|| format!("转发器 {} 不存在", forwarder_id))?;

    if handle.info.status == ForwarderStatus::Running {
        return Err("请先停止转发再删除".to_string());
    }

    forwarders.remove(&forwarder_id);
    state
        .log("info", "forward", &format!("转发器 {} 已删除", forwarder_id))
        .await;
    Ok(true)
}
