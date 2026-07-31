//! TCP 传输层实现

use super::*;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

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
            kind: "tcp_client".to_string(),
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

// ══════════════════════════════════════════════════════════════
// TCP Server Transport
// ══════════════════════════════════════════════════════════════

/// TCP Server — 监听端口，接受多客户端连接，广播写入，缓冲区读取。
pub struct TcpServerTransport {
    clients: Arc<Mutex<HashMap<SocketAddr, TcpStream>>>,
    pending: Arc<Mutex<Vec<(SocketAddr, Vec<u8>)>>>,
    /// 新接受的客户端队列（供外部提取，创建独立通道）
    new_clients: Arc<Mutex<Vec<(SocketAddr, TcpStream)>>>,
    descriptor: TransportDescriptor,
    listener: Mutex<Option<TcpListener>>,
    running: Arc<Mutex<bool>>,
    accept_handle: Mutex<Option<thread::JoinHandle<()>>>,
    bind_addr: String,
    port: u16,
}

impl TcpServerTransport {
    pub fn new(bind_addr: String, port: u16) -> Self {
        let descriptor = TransportDescriptor {
            kind: "tcp_server".to_string(),
            address: format!("{}:{}", bind_addr, port),
            ..Default::default()
        };
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(Vec::new())),
            new_clients: Arc::new(Mutex::new(Vec::new())),
            descriptor,
            listener: Mutex::new(None),
            running: Arc::new(Mutex::new(false)),
            accept_handle: Mutex::new(None),
            bind_addr,
            port,
        }
    }

    /// 获取当前已连接的客户端地址列表
    pub fn get_clients(&self) -> Vec<SocketAddr> {
        self.clients.lock().unwrap().keys().cloned().collect()
    }

    /// 提取新接受的客户端（调用后队列清空）
    pub fn take_new_clients(&self) -> Vec<(SocketAddr, TcpStream)> {
        self.new_clients.lock().unwrap().drain(..).collect()
    }

    /// 踢出指定客户端
    pub fn kick_client(&self, addr: SocketAddr) -> bool {
        self.clients.lock().unwrap().remove(&addr).is_some()
    }

    /// 向指定客户端发送数据
    pub fn send_to_client(&self, addr: SocketAddr, bytes: &[u8]) -> Result<usize, TransportError> {
        let mut guard = self.clients.lock().unwrap();
        let stream = guard.get_mut(&addr).ok_or(TransportError::NotConnected)?;
        stream.write(bytes).map_err(|e| TransportError::Send(e.to_string()))
    }
}

impl Transport for TcpServerTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        let addr = format!("{}:{}", self.bind_addr, self.port);
        let listener = TcpListener::bind(&addr)
            .map_err(|e| TransportError::Connect(e.to_string()))?;
        listener
            .set_nonblocking(true)
            .map_err(TransportError::Io)?;

        *self.running.lock().unwrap() = true;
        *self.listener.lock().unwrap() = Some(listener);

        let clients = self.clients.clone();
        let pending = self.pending.clone();
        let new_clients = self.new_clients.clone();
        let running = self.running.clone();
        let listener_ref = Mutex::new(self.listener.lock().unwrap().take().unwrap());

        let handle = thread::spawn(move || {
            loop {
                if !*running.lock().unwrap() {
                    break;
                }

                match listener_ref.lock().unwrap().accept() {
                    Ok((stream, addr)) => {
                        stream
                            .set_read_timeout(Some(std::time::Duration::from_millis(10)))
                            .ok();

                        // 将流克隆：一份给 clients map，一份给读线程
                        let cloned_stream = stream.try_clone().unwrap();
                        clients.lock().unwrap().insert(addr, cloned_stream);

                        // 将新客户端推入 new_clients 队列，供外部创建独立通道
                        new_clients.lock().unwrap().push((addr, stream.try_clone().unwrap()));

                        // 为每个客户端启动读线程
                        let clients_clone = clients.clone();
                        let pending_clone = pending.clone();
                        let running_clone = running.clone();
                        let mut read_stream = stream;

                        thread::spawn(move || {
                            let mut buf = [0u8; 4096];
                            loop {
                                match read_stream.read(&mut buf) {
                                    Ok(0) => {
                                        clients_clone.lock().unwrap().remove(&addr);
                                        break;
                                    }
                                    Ok(n) => {
                                        let data = buf[..n].to_vec();
                                        pending_clone
                                            .lock()
                                            .unwrap()
                                            .push((addr, data));
                                    }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                                        || e.kind() == std::io::ErrorKind::TimedOut =>
                                    {
                                        if !*running_clone.lock().unwrap() {
                                            clients_clone.lock().unwrap().remove(&addr);
                                            break;
                                        }
                                    }
                                    Err(_) => {
                                        clients_clone.lock().unwrap().remove(&addr);
                                        break;
                                    }
                                }
                            }
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(_) => {
                        thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
            }
        });

        *self.accept_handle.lock().unwrap() = Some(handle);
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        *self.running.lock().unwrap() = false;
        *self.listener.lock().unwrap() = None;
        self.clients.lock().unwrap().clear();
        if let Some(handle) = self.accept_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        let mut guard = self.clients.lock().unwrap();
        if guard.is_empty() {
            return Err(TransportError::NotConnected);
        }
        let mut errors: Vec<String> = Vec::new();
        for (addr, stream) in guard.iter_mut() {
            match stream.write(bytes) {
                Ok(_n) => {}
                Err(e) => errors.push(format!("{}: {}", addr, e)),
            }
        }
        if errors.is_empty() {
            Ok(bytes.len())
        } else {
            // 部分成功也算成功，返回第一个写的大小
            Ok(bytes.len())
        }
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let mut pending = self.pending.lock().unwrap();
        match pending.first_mut() {
            Some((_, data)) => {
                let n = std::cmp::min(buf.len(), data.len());
                buf[..n].copy_from_slice(&data[..n]);
                if n < data.len() {
                    *data = data[n..].to_vec();
                } else {
                    pending.remove(0);
                }
                Ok(n)
            }
            None => Ok(0),
        }
    }

    fn is_active(&self) -> bool {
        self.listener.lock().unwrap().is_some()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }

    fn client_info(&self) -> Vec<String> {
        self.clients.lock().unwrap().keys().map(|a| a.to_string()).collect()
    }
}
