//! 数据收发命令

use crate::state::{AppState, PacketEntry};
use tauri::State;

#[derive(serde::Deserialize)]
pub struct SendDataRequest {
    pub channel_id: String,
    pub data: String,
    /// text / hex / gbk
    pub format: String,
    pub suffix: Option<String>, // none / cr / lf / crlf
}

#[derive(serde::Serialize)]
pub struct SendDataResponse {
    pub success: bool,
    pub bytes_sent: usize,
    pub timestamp: String,
    pub hex: String,
    pub text: String,
    pub channel_id: String,
    pub seq: u64,
}

#[derive(serde::Serialize)]
pub struct PacketResponse {
    pub packets: Vec<PacketEntry>,
    pub total: usize,
}

fn append_suffix(mut data: Vec<u8>, suffix: Option<&str>) -> Vec<u8> {
    match suffix {
        Some("cr") => data.push(0x0D),
        Some("lf") => data.push(0x0A),
        Some("crlf") => {
            data.push(0x0D);
            data.push(0x0A);
        }
        _ => {}
    }
    data
}

fn encode_chinese(text: &str, encoding: &'static encoding_rs::Encoding) -> Result<Vec<u8>, String> {
    let (cow, _enc, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(format!("存在无法用 {} 编码的字符", encoding.name()));
    }
    Ok(cow.into_owned())
}

/// 发送数据到指定通道
#[tauri::command]
pub async fn send_data(
    request: SendDataRequest,
    state: State<'_, AppState>,
) -> Result<SendDataResponse, String> {
    {
        let channels = state.channels.read().await;
        if !channels.contains_key(&request.channel_id) {
            return Err(format!("通道 {} 不存在", request.channel_id));
        }
    }

    let bytes = match request.format.as_str() {
        "hex" => {
            let clean = request.data.replace([' ', '\t', '\n', '\r'], "");
            hex::decode(&clean).map_err(|e| format!("HEX 解析失败: {}", e))?
        }
        "text" | "utf-8" => {
            append_suffix(request.data.into_bytes(), request.suffix.as_deref())
        }
        "gbk" => {
            let mut raw = encode_chinese(&request.data, encoding_rs::GBK)?;
            raw = append_suffix(raw, request.suffix.as_deref());
            raw
        }
        // 兼容旧客户端：GB2312 是 GBK 子集，统一按 GBK 发送
        "gb2312" => {
            let mut raw = encode_chinese(&request.data, encoding_rs::GBK)?;
            raw = append_suffix(raw, request.suffix.as_deref());
            raw
        }
        other => return Err(format!("不支持的格式: {}", other)),
    };

    let len = bytes.len();
    let channel_id = request.channel_id.clone();
    state.send_to_channel(&channel_id, &bytes).await?;

    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    let hex_str = hex::encode(&bytes);
    let text = String::from_utf8_lossy(&bytes).to_string();
    let seq = state.next_seq();

    let entry = PacketEntry {
        timestamp: timestamp.clone(),
        direction: "tx".to_string(),
        channel_id: channel_id.clone(),
        bytes: bytes.clone(),
        hex: hex_str.clone(),
        text: text.clone(),
        seq,
    };
    state.push_packet(entry).await;

    Ok(SendDataResponse {
        success: true,
        bytes_sent: len,
        timestamp,
        hex: hex_str,
        text,
        channel_id,
        seq,
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
