//! TCP Server 传输

use crate::*;
use std::collections::HashMap;
use std::io::Write;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

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
    /// open() 后保存的绑定端口（listener 被移走后仍可查询）
    bound_port: Mutex<Option<u16>>,
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
            bound_port: Mutex::new(None),
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

    /// 获取实际绑定的端口（open() 后可用）
    pub fn bound_port(&self) -> Option<u16> {
        *self.bound_port.lock().unwrap()
    }

    /// 踢出指定客户端（先 Shutdown::Both 发 FIN，避免对端视作 RST/异常断开）
    pub fn kick_client(&self, addr: SocketAddr) -> bool {
        if let Some(stream) = self.clients.lock().unwrap().remove(&addr) {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            true
        } else {
            false
        }
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
        // 保存绑定端口（listener 即将被移走）
        let local_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        *self.bound_port.lock().unwrap() = Some(local_port);
        // 更新 descriptor 地址
        self.descriptor.address = format!("{}:{}", self.bind_addr, local_port);

        listener
            .set_nonblocking(true)
            .map_err(TransportError::Io)?;

        *self.running.lock().unwrap() = true;
        *self.listener.lock().unwrap() = Some(listener);

        let clients = self.clients.clone();
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

                        // 写侧克隆：供广播 / kick / send_to_client
                        match stream.try_clone() {
                            Ok(ws) => {
                                clients.lock().unwrap().insert(addr, ws);
                            }
                            Err(e) => {
                                eprintln!("[tcp_server] clone for write failed: {}", e);
                            }
                        }

                        // 读侧所有权交给外部监控线程，创建独占读通道（避免双读竞争）
                        new_clients.lock().unwrap().push((addr, stream));
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

    fn shutdown(&self) -> Result<(), TransportError> {
        *self.running.lock().unwrap() = false;
        *self.listener.lock().unwrap() = None;
        // 主动关闭：对每个客户端发 FIN，再丢弃句柄（与 sscom 正常断开一致）
        {
            let mut clients = self.clients.lock().unwrap();
            for (_, stream) in clients.drain() {
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        }
        self.new_clients.lock().unwrap().clear();
        self.pending.lock().unwrap().clear();
        if let Some(handle) = self.accept_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        self.shutdown()
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
        *self.running.lock().unwrap()
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }

    fn client_info(&self) -> Vec<String> {
        self.clients.lock().unwrap().keys().map(|a| a.to_string()).collect()
    }
}

// ══════════════════════════════════════════════════════════════
// 单元测试
// ══════════════════════════════════════════════════════════════

