//! 串口传输层实现

use super::*;
use std::sync::Mutex;

pub struct SerialTransport {
    port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    descriptor: TransportDescriptor,
    config: SerialConfig,
}

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
}

impl SerialTransport {
    pub fn new(config: SerialConfig) -> Self {
        let descriptor = TransportDescriptor {
            kind: "serial".to_string(),
            address: config.port.clone(),
        };
        Self {
            port: Mutex::new(None),
            descriptor,
            config,
        }
    }

    pub fn list_ports() -> Vec<PortInfo> {
        serialport::available_ports()
            .map(|ports| {
                ports.into_iter().map(|p| PortInfo {
                    name: p.port_name,
                    description: format!("{:?}", p.port_type),
                }).collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone)]
pub struct PortInfo {
    pub name: String,
    pub description: String,
}

impl Transport for SerialTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        let parity = match self.config.parity.to_lowercase().as_str() {
            "even" => serialport::Parity::Even,
            "odd" => serialport::Parity::Odd,
            _ => serialport::Parity::None,
        };
        let data_bits = match self.config.data_bits {
            5 => serialport::DataBits::Five,
            6 => serialport::DataBits::Six,
            7 => serialport::DataBits::Seven,
            _ => serialport::DataBits::Eight,
        };
        let stop_bits = match self.config.stop_bits {
            2 => serialport::StopBits::Two,
            _ => serialport::StopBits::One,
        };

        let port = serialport::new(&self.config.port, self.config.baud_rate)
            .parity(parity)
            .data_bits(data_bits)
            .stop_bits(stop_bits)
            .timeout(std::time::Duration::from_millis(10))
            .open()
            .map_err(|e| TransportError::Connect(e.to_string()))?;

        *self.port.lock().unwrap() = Some(port);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        *self.port.lock().unwrap() = None;
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        let mut guard = self.port.lock().unwrap();
        let port = guard.as_mut().ok_or(TransportError::NotConnected)?;
        port.write(bytes).map_err(|e| TransportError::Send(e.to_string()))
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let mut guard = self.port.lock().unwrap();
        let port = guard.as_mut().ok_or(TransportError::NotConnected)?;
        port.read(buf).map_err(|e| TransportError::Receive(e.to_string()))
    }

    fn is_active(&self) -> bool {
        self.port.lock().unwrap().is_some()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
