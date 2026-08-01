//! 日志管理命令

use crate::error::CommandError;
use crate::state::AppState;
use tauri::State;

#[derive(serde::Serialize)]
pub struct LogEntryResponse {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[tauri::command]
pub async fn get_logs(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<LogEntryResponse>, CommandError> {
    let logs = state.logs.lock().await;
    let limit = limit.unwrap_or(200);
    Ok(logs
        .iter()
        .rev()
        .take(limit)
        .map(|l| LogEntryResponse {
            timestamp: l.timestamp.clone(),
            level: l.level.clone(),
            source: l.source.clone(),
            message: l.message.clone(),
        })
        .collect())
}

#[tauri::command]
pub async fn clear_logs(state: State<'_, AppState>) -> Result<bool, CommandError> {
    state.logs.lock().await.clear();
    Ok(true)
}
