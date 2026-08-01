//! 配置管理命令

use crate::error::CommandError;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn config_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("serial-tools-data")
}

#[derive(serde::Serialize)]
pub struct SessionInfo {
    pub name: String,
    pub path: String,
    pub modified: String,
}

#[tauri::command]
pub async fn load_session(
    name: String,
    _state: State<'_, AppState>,
) -> Result<String, CommandError> {
    let path = config_dir().join("sessions").join(format!("{}.yaml", name));
    std::fs::read_to_string(&path)
        .map_err(|e| CommandError::Internal(format!("读取会话配置失败: {}", e)))
}

#[tauri::command]
pub async fn save_session(
    name: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let dir = config_dir().join("sessions");
    std::fs::create_dir_all(&dir).map_err(|e| CommandError::Internal(e.to_string()))?;
    let path = dir.join(format!("{}.yaml", name));
    std::fs::write(&path, content).map_err(|e| CommandError::Internal(e.to_string()))?;
    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Config,
            &format!("保存会话配置: {}", name),
        )
        .await;
    Ok(true)
}

#[tauri::command]
pub async fn list_sessions(_state: State<'_, AppState>) -> Result<Vec<SessionInfo>, CommandError> {
    let dir = config_dir().join("sessions");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| CommandError::Internal(e.to_string()))? {
        let entry = entry.map_err(|e| CommandError::Internal(e.to_string()))?;
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "yaml" || e == "yml") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let metadata =
                std::fs::metadata(&path).map_err(|e| CommandError::Internal(e.to_string()))?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                    Some(
                        chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)?
                            .format("%Y-%m-%d %H:%M:%S")
                            .to_string(),
                    )
                })
                .unwrap_or_default();
            sessions.push(SessionInfo {
                name,
                path: path.to_string_lossy().to_string(),
                modified,
            });
        }
    }
    Ok(sessions)
}

#[tauri::command]
pub async fn delete_session(
    name: String,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let path = config_dir().join("sessions").join(format!("{}.yaml", name));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    state
        .log(
            "info",
            crate::domain::log_source::LogSource::Config,
            &format!("删除会话配置: {}", name),
        )
        .await;
    Ok(true)
}
