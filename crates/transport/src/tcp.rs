//! TCP 传输层实现

use super::*;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::io::{Read, Write};

pub struct TcpClientTransport {
    stream: Option<TcpStream>,
    descriptor: TransportDescriptor,
    host: String,
    port: u16,
    active: Arc<AtomicBool>,
}

impl TcpClientTransport {
    pub fn new(host: String, port: u16) -> Self {
        let descriptor = TransportDescriptor {
            kind: "tcp_client".to_string(),
            address: format!("{}:{}", host, port),
        };
        Self {
            stream: None,
            descriptor,
            host,
            port,
            active: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Transport for TcpClientTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        let addr = format!("{}:{}", self.host, self.port);
        let stream = TcpStream::connect(&addr)
            .map_err(|e| TransportError::Connect(e.to_string()))?;
        stream.set_read_timeout(Some(std::time::Duration::from_millis(10)))
            .map_err(|e| TransportError::Io(e))?;
        self.stream = Some(stream);
        self.active.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        self.stream = None;
        self.active.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        let stream = self.stream.as_ref().ok_or(TransportError::NotConnected)?;
        stream.write(bytes).map_err(|e| TransportError::Send(e.to_string()))
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let stream = self.stream.as_ref().ok_or(TransportError::NotConnected)?;
        stream.read(buf).map_err(|e| TransportError::Receive(e.to_string()))
    }

    fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
