//! Modbus RTU/TCP 协议解析

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModbusResult {
    pub function_code: u8,
    pub slave_id: u8,
    pub data: Vec<u8>,
    pub error: Option<String>,
}

pub fn parse_modbus_rtu(frame: &[u8]) -> Option<ModbusResult> {
    if frame.len() < 4 {
        return None;
    }
    let slave_id = frame[0];
    let function_code = frame[1];

    // 错误响应: function_code >= 0x80
    if function_code >= 0x80 {
        let error_code = frame.get(2).copied().unwrap_or(0);
        return Some(ModbusResult {
            function_code,
            slave_id,
            data: vec![],
            error: Some(format!("错误码: 0x{:02X}", error_code)),
        });
    }

    let byte_count = frame[2] as usize;
    let data = frame[3..3 + byte_count].to_vec();

    Some(ModbusResult {
        function_code,
        slave_id,
        data,
        error: None,
    })
}
