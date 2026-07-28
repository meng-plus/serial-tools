//! 端口转发命令

use crate::state::AppState;
use tauri::State;

#[derive(serde::Serialize)]
pub struct ForwarderInfo {
    pub id: String,
    pub name: String,
    pub source: String,
    pub target: String,
    pub status: String,
    pub rx_count: u64,
    pub tx_count: u64,
}

#[tauri::command]
pub async fn start_forward(
    name: String,
    source_type: String,
    source_addr: String,
    target_type: String,
    target_addr: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let _ = (&state, &name, &source_type, &source_addr, &target_type, &target_addr);
    // TODO: 使用 channel crate 实现转发
    let id = uuid::Uuid::new_v4().to_string();
    state.log("info", "forward", &format!("启动转发 {} -> {}", source_addr, target_addr)).await;
    Ok(id)
}

#[tauri::command]
pub async fn stop_forward(
    id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let _ = (&state, &id);
    // TODO: 停止转发
    Ok(true)
}

#[tauri::command]
pub async fn list_forwarders(
    state: State<'_, AppState>,
) -> Result<Vec<ForwarderInfo>, String> {
    let _ = &state;
    // TODO: 返回转发列表
    Ok(vec![])
}
