//! MQTT 传输层占位（STUB）— 未接入 UI / connect 命令
//!
//! 所有 open/read/write 返回「尚未实现」。正式实现前勿在产品文案中宣称已支持。

use super::*;

pub struct MqttTransport {
    descriptor: TransportDescriptor,
    active: bool,
}

impl MqttTransport {
    pub fn new(broker: &str, port: u16) -> Self {
        let descriptor = TransportDescriptor {
            kind: "mqtt".to_string(),
            address: format!("{}:{}", broker, port),
            ..Default::default()
        };
        Self { descriptor, active: false }
    }
}

impl Transport for MqttTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        // TODO: 实现 MQTT 连接
        Err(TransportError::Connect("MQTT 传输层尚未实现".to_string()))
    }

    fn close(&mut self) -> Result<(), TransportError> {
        self.active = false;
        Ok(())
    }

    fn write(&self, _bytes: &[u8]) -> Result<usize, TransportError> {
        Err(TransportError::Send("MQTT 传输层尚未实现".to_string()))
    }

    fn read(&self, _buf: &mut [u8]) -> Result<usize, TransportError> {
        Err(TransportError::Receive("MQTT 传输层尚未实现".to_string()))
    }

    fn is_active(&self) -> bool {
        self.active
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
