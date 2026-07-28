//! 数据收发命令

use crate::state::{AppState, PacketEntry};
use tauri::State;

#[derive(serde::Deserialize)]
pub struct SendDataRequest {
    pub channel_id: String,
    pub data: String,
    pub format: String, // text / hex
    pub suffix: Option<String>, // none / cr / lf / crlf
}

#[derive(serde::Serialize)]
pub struct SendDataResponse {
    pub success: bool,
    pub bytes_sent: usize,
}

#[derive(serde::Serialize)]
pub struct PacketResponse {
    pub packets: Vec<PacketEntry>,
    pub total: usize,
}

/// 发送数据到指定通道
#[tauri::command]
pub async fn send_data(
    request: SendDataRequest,
    state: State<'_, AppState>,
) -> Result<SendDataResponse, String> {
    // 检查通道是否存在
    {
        let channels = state.channels.read().await;
        if !channels.contains_key(&request.channel_id) {
            return Err(format!("通道 {} 不存在", request.channel_id));
        }
    }

    let bytes = match request.format.as_str() {
        "hex" => hex::decode(&request.data).map_err(|e| format!("HEX 解析失败: {}", e))?,
        "text" => {
            let mut data = request.data.into_bytes();
            match request.suffix.as_deref() {
                Some("cr") => data.push(0x0D),
                Some("lf") => data.push(0x0A),
                Some("crlf") => { data.push(0x0D); data.push(0x0A); }
                _ => {}
            }
            data
        }
        _ => return Err(format!("不支持的格式: {}", request.format)),
    };

    let len = bytes.len();
    state.send_to_channel(&request.channel_id, &bytes).await?;

    // 记录 TX 包
    let entry = PacketEntry {
        timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        direction: "tx".to_string(),
        channel_id: request.channel_id,
        bytes: bytes.clone(),
        hex: hex::encode(&bytes),
        text: String::from_utf8_lossy(&bytes).to_string(),
    };
    state.push_packet(entry).await;

    Ok(SendDataResponse {
        success: true,
        bytes_sent: len,
    })
}

/// 获取数据包（最近 N 条）
#[tauri::command]
pub async fn get_packets(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<PacketResponse, String> {
    let packets = state.packets.lock().await;
    let limit = limit.unwrap_or(500);
    let total = packets.len();
    let result: Vec<PacketEntry> = packets.iter().rev().take(limit).cloned().collect();
    Ok(PacketResponse { packets: result, total })
}

/// 清空数据包
#[tauri::command]
pub async fn clear_packets(
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.packets.lock().await.clear();
    Ok(true)
}
