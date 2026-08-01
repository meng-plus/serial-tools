//! 录制命令 — 数据录制生命周期由 RecordingRegistry 统一管理

use std::path::PathBuf;

use crate::error::CommandError;
use crate::logger::LogFormat;
use crate::recording::RecordingInfo;
use crate::state::AppState;
use tauri::State;

/// 解析录制格式字符串；非法值返回 invalid_request
pub fn parse_format(format: &str) -> Result<LogFormat, CommandError> {
    match format {
        "csv" => Ok(LogFormat::Csv),
        "hex" => Ok(LogFormat::Hex),
        "bin" => Ok(LogFormat::Bin),
        "text" => Ok(LogFormat::Text),
        other => Err(CommandError::InvalidRequest(format!(
            "不支持的录制格式：{other}（可选 csv/hex/bin/text）"
        ))),
    }
}

/// 默认录制输出目录（统一落在 serial-tools-data/recordings/<channel>）
fn default_output_dir(channel_id: &str) -> PathBuf {
    let data_dir = crate::commands::fs_util::data_root();
    let safe: String = channel_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    data_dir.join("recordings").join(safe)
}

/// 启动某通道录制
#[tauri::command]
pub async fn start_channel_recording(
    state: State<'_, AppState>,
    channel_id: String,
    format: String,
) -> Result<RecordingInfo, CommandError> {
    if !state.channels.contains(&channel_id).await {
        return Err(CommandError::ChannelNotFound(channel_id));
    }
    let log_format = parse_format(&format)?;
    state
        .recordings
        .start(&channel_id, log_format, default_output_dir(&channel_id))
}

/// 停止某通道录制
#[tauri::command]
pub fn stop_channel_recording(
    state: State<AppState>,
    channel_id: String,
) -> Result<RecordingInfo, CommandError> {
    state.recordings.stop(&channel_id)
}

/// 列出所有录制中的通道
#[tauri::command]
pub fn list_recordings(state: State<AppState>) -> Vec<RecordingInfo> {
    state.recordings.list()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_parsing() {
        assert_eq!(parse_format("csv").unwrap(), LogFormat::Csv);
        assert_eq!(parse_format("hex").unwrap(), LogFormat::Hex);
        assert_eq!(parse_format("bin").unwrap(), LogFormat::Bin);
        assert_eq!(parse_format("text").unwrap(), LogFormat::Text);
        let err = parse_format("yaml").unwrap_err();
        assert_eq!(err.code(), crate::error::ErrorCode::InvalidRequest);
    }

    #[test]
    fn output_dir_under_recordings() {
        let dir = default_output_dir("serial-COM1");
        assert!(dir.to_string_lossy().contains("recordings"));
        assert!(dir.to_string_lossy().ends_with("serial-COM1"));
    }
}
