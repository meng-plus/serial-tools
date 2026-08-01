//! 串口传输层实现

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct SerialTransport {
    port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    descriptor: TransportDescriptor,
    config: SerialConfig,
    receiving: AtomicBool,
}

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub stop_bits: u8,
    pub parity: String,
    pub half_duplex: bool,
}

impl SerialTransport {
    pub fn new(config: SerialConfig) -> Self {
        let descriptor = TransportDescriptor {
            kind: "serial".to_string(),
            address: config.port.clone(),
            half_duplex: config.half_duplex,
        };
        Self {
            port: Mutex::new(None),
            descriptor,
            config,
            receiving: AtomicBool::new(false),
        }
    }

    pub fn list_ports() -> Vec<PortInfo> {
        serialport::available_ports()
            .map(|ports| {
                ports
                    .into_iter()
                    .map(|p| PortInfo {
                        name: p.port_name,
                        description: format!("{:?}", p.port_type),
                    })
                    .collect()
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
            .map_err(|e| TransportError::Connect(std::io::Error::other(e)))?;

        *self.port.lock().unwrap() = Some(port);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        *self.port.lock().unwrap() = None;
        Ok(())
    }

    fn shutdown(&self) -> Result<(), TransportError> {
        *self.port.lock().unwrap() = None;
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        if self.config.half_duplex && self.receiving.load(Ordering::Acquire) {
            let deadline = Instant::now() + Duration::from_millis(100);
            while self.receiving.load(Ordering::Acquire) {
                if Instant::now() >= deadline {
                    return Err(TransportError::Message(
                        "RS485 半双工: 读取中无法发送，超时".to_string(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        let mut guard = self.port.lock().unwrap();
        let port = guard.as_mut().ok_or(TransportError::NotConnected)?;
        port.write(bytes).map_err(TransportError::Send)
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        if self.config.half_duplex {
            self.receiving.store(true, Ordering::Release);
        }
        let result = {
            let mut guard = self.port.lock().unwrap();
            let port = guard.as_mut().ok_or(TransportError::NotConnected)?;
            port.read(buf).map_err(TransportError::Receive)
        };
        if self.config.half_duplex {
            self.receiving.store(false, Ordering::Release);
        }
        result
    }

    fn is_active(&self) -> bool {
        self.port.lock().unwrap().is_some()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }

    fn duplex_mode(&self) -> DuplexMode {
        if self.config.half_duplex {
            DuplexMode::Half
        } else {
            DuplexMode::Full
        }
    }
}
