//! 日志管理命令

use crate::state::{AppState, LogEntry};
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
    level: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<LogEntryResponse>, String> {
    let logs = state.logs.lock().await;
    let limit = limit.unwrap_or(200);
    let entries: Vec<LogEntryResponse> = logs
        .iter()
        .rev()
        .filter(|l| {
            if let Some(ref filter) = level {
                l.level == *filter
            } else {
                true
            }
        })
        .take(limit)
        .map(|l| LogEntryResponse {
            timestamp: l.timestamp.clone(),
            level: l.level.clone(),
            source: l.source.clone(),
            message: l.message.clone(),
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn export_logs(
    path: String,
    format: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let logs = state.logs.lock().await;
    let format = format.unwrap_or_else(|| "csv".to_string());

    let content = match format.as_str() {
        "csv" => {
            let mut w = String::from("时间,级别,来源,消息\n");
            for log in logs.iter() {
                w.push_str(&format!(
                    "{},{},{},{}\n",
                    log.timestamp, log.level, log.source, log.message
                ));
            }
            w
        }
        "json" => serde_json::to_string_pretty(
            &logs.iter().map(|l| {
                serde_json::json!({
                    "timestamp": l.timestamp,
                    "level": l.level,
                    "source": l.source,
                    "message": l.message,
                })
            }).collect::<Vec<_>>()
        ).map_err(|e| e.to_string())?,
        _ => return Err(format!("不支持的格式: {}", format)),
    };

    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(true)
}

#[tauri::command]
pub async fn clear_logs(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.logs.lock().await.clear();
    Ok(true)
}
