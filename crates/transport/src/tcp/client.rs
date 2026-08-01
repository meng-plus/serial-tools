//! TCP Client 传输

use crate::*;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
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
            ..Default::default()
        };
        Self {
            stream: Mutex::new(None),
            descriptor,
            host,
            port,
        }
    }

    /// 从已接受的 TcpStream 创建传输（用于 TCP Server 客户端通道）
    pub fn from_stream(stream: TcpStream, addr: SocketAddr) -> Self {
        let addr_str = addr.to_string();
        let descriptor = TransportDescriptor {
            kind: "tcp_server_client".to_string(),
            address: addr_str,
            ..Default::default()
        };
        Self {
            stream: Mutex::new(Some(stream)),
            descriptor,
            host: addr.ip().to_string(),
            port: addr.port(),
        }
    }
}

impl Transport for TcpClientTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        use std::net::ToSocketAddrs;
        let addr = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| TransportError::Message(format!("地址解析失败: {}", e)))?
            .next()
            .ok_or_else(|| TransportError::Message("无法解析主机地址".to_string()))?;

        // 3 秒连接超时，避免长时间阻塞 UI
        let stream = TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3))
            .map_err(TransportError::Connect)?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_millis(10)))
            .map_err(|e| TransportError::Message(e.to_string()))?;
        stream
            .set_write_timeout(Some(std::time::Duration::from_secs(3)))
            .map_err(|e| TransportError::Message(e.to_string()))?;
        *self.stream.lock().unwrap() = Some(stream);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        self.shutdown()
    }

    fn shutdown(&self) -> Result<(), TransportError> {
        if let Some(stream) = self.stream.lock().unwrap().take() {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        let mut guard = self.stream.lock().unwrap();
        let stream = guard.as_mut().ok_or(TransportError::NotConnected)?;
        stream.write(bytes).map_err(TransportError::Send)
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let mut guard = self.stream.lock().unwrap();
        let stream = guard.as_mut().ok_or(TransportError::NotConnected)?;
        match stream.read(buf) {
            Ok(n) => Ok(n),
            Err(e) => {
                // 读超时(WouldBlock/TimedOut)与 RST 都保留 io::Error，
                // 由上层按 ErrorKind 区分临时错误与对端断开
                Err(TransportError::Receive(e))
            }
        }
    }

    fn is_active(&self) -> bool {
        self.stream.lock().unwrap().is_some()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
