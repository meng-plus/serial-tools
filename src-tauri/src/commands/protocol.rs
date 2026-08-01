//! 协议解析命令（STUB）— 前端 Protocol 页有壳，后端仍返回空列表
//!
//! 接入解析管线前勿宣称「协议解析已可用」。见 ROADMAP P0。

use crate::state::AppState;
use tauri::State;

#[derive(serde::Serialize)]
pub struct ParsedResult {
    pub timestamp: String,
    pub source: String,
    pub rule_id: String,
    pub content: String,
    pub hex: String,
    pub fields: Vec<FieldValue>,
}

#[derive(serde::Serialize)]
pub struct FieldValue {
    pub name: String,
    pub value: String,
    pub unit: String,
}

#[tauri::command]
pub async fn get_parsed_results(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<ParsedResult>, String> {
    // TODO: 从 pipeline 获取解析结果
    let _ = limit;
    let _ = &state;
    Ok(vec![])
}

#[tauri::command]
pub async fn clear_parsed(state: State<'_, AppState>) -> Result<bool, String> {
    let _ = &state;
    Ok(true)
}
