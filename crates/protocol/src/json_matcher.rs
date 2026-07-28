//! JSON 协议匹配与字段提取

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonField {
    pub name: String,
    pub value: String,
    pub path: String,
}

pub fn parse_json_fields(text: &str) -> Option<Vec<JsonField>> {
    let json: serde_json::Value = serde_json::from_str(text).ok()?;
    let mut fields = Vec::new();

    if let Some(obj) = json.as_object() {
        for (key, val) in obj {
            fields.push(JsonField {
                name: key.clone(),
                value: val.to_string(),
                path: format!("$.{}", key),
            });
        }
    }

    Some(fields)
}
