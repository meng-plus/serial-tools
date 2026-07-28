//! TCP 传输层实现

use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;

pub struct TcpClientTransport {
    stream: Mutex<Option<TcpStream>>,
    descriptor: TransportDescriptor,
    host: String,
    port: u16,
}

impl TcpClientTransport {
    pub fn new(host: String, port: u16) -> Self {
        let descriptor = TransportDescriptor {
            kind: "tcp_client".to_string(),
            address: format!("{}:{}", host, port),
        };
        Self {
            stream: Mutex::new(None),
            descriptor,
            host,
            port,
        }
    }
}

impl Transport for TcpClientTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        let addr = format!("{}:{}", self.host, self.port);
        let stream = TcpStream::connect(&addr)
            .map_err(|e| TransportError::Connect(e.to_string()))?;
        stream.set_read_timeout(Some(std::time::Duration::from_millis(10)))
            .map_err(TransportError::Io)?;
        *self.stream.lock().unwrap() = Some(stream);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        *self.stream.lock().unwrap() = None;
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        let mut guard = self.stream.lock().unwrap();
        let stream = guard.as_mut().ok_or(TransportError::NotConnected)?;
        stream.write(bytes).map_err(|e| TransportError::Send(e.to_string()))
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let mut guard = self.stream.lock().unwrap();
        let stream = guard.as_mut().ok_or(TransportError::NotConnected)?;
        stream.read(buf).map_err(|e| TransportError::Receive(e.to_string()))
    }

    fn is_active(&self) -> bool {
        self.stream.lock().unwrap().is_some()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
