//! MQTT 传输层占位实现
//!
//! TODO: 集成 rumqttc 实现完整 MQTT 传输

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
