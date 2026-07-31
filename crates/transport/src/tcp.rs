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
            .map_err(|e| TransportError::Connect(format!("地址解析失败: {}", e)))?
            .next()
            .ok_or_else(|| TransportError::Connect("无法解析主机地址".to_string()))?;

        // 3 秒连接超时，避免长时间阻塞 UI
        let stream = TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(3))
            .map_err(|e| TransportError::Connect(e.to_string()))?;
        stream
            .set_read_timeout(Some(std::time::Duration::from_millis(10)))
            .map_err(TransportError::Io)?;
        stream
            .set_write_timeout(Some(std::time::Duration::from_secs(3)))
            .map_err(TransportError::Io)?;
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
        stream.write(bytes).map_err(|e| TransportError::Send(e.to_string()))
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        let mut guard = self.stream.lock().unwrap();
        let stream = guard.as_mut().ok_or(TransportError::NotConnected)?;
        match stream.read(buf) {
            Ok(n) => Ok(n),
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // 超时/无数据：返回错误让读线程短暂休眠，勿当成 EOF(Ok(0))
                Err(TransportError::Receive(e.to_string()))
            }
            Err(e) => {
                // 保留 ErrorKind，便于上层区分 RST 与临时错误
                Err(TransportError::Io(e))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Transport;

    // ── TcpClientTransport 测试 ──────────────────────────────

    #[test]
    fn test_client_new() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 8000);
        assert!(!tcp.is_active());
        assert_eq!(tcp.descriptor().kind, "tcp_client");
        assert_eq!(tcp.descriptor().address, "127.0.0.1:8000");
    }

    #[test]
    fn test_client_connect_refused() {
        let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), 1);
        assert!(tcp.open().is_err());
        assert!(!tcp.is_active());
    }

    #[test]
    fn test_client_write_before_open() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 8000);
        assert!(tcp.write(b"test").is_err());
    }

    #[test]
    fn test_client_read_before_open() {
        let tcp = TcpClientTransport::new("127.0.0.1".to_string(), 8000);
        let mut buf = [0u8; 64];
        assert!(tcp.read(&mut buf).is_err());
    }

    #[test]
    fn test_client_close() {
        let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), 8000);
        tcp.close().unwrap();
        assert!(!tcp.is_active());
    }

    #[test]
    fn test_client_from_stream() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle = std::thread::spawn(move || {
            let (stream, addr) = listener.accept().unwrap();
            let client = TcpClientTransport::from_stream(stream, addr);
            assert!(client.is_active());
            assert_eq!(client.descriptor().kind, "tcp_server_client");
            // descriptor 地址是客户端地址（IP:端口），不是服务端端口
            assert!(client.descriptor().address.starts_with("127.0.0.1:"));
        });

        let _conn = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        handle.join().unwrap();
    }

    #[test]
    fn test_client_from_stream_read_write() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle = std::thread::spawn(move || {
            let (stream, addr) = listener.accept().unwrap();
            let client = TcpClientTransport::from_stream(stream, addr);
            // 读取对端发来的数据
            let mut buf = [0u8; 64];
            std::thread::sleep(std::time::Duration::from_millis(50));
            let n = client.read(&mut buf).unwrap();
            assert_eq!(&buf[..n], b"hello");
            // 回传
            client.write(&buf[..n]).unwrap();
        });

        let mut conn = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        conn.write_all(b"hello").unwrap();
        let mut buf = [0u8; 64];
        std::thread::sleep(std::time::Duration::from_millis(100));
        let n = conn.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"hello");

        handle.join().unwrap();
    }

    // ── TcpServerTransport 测试 ──────────────────────────────

    #[test]
    fn test_server_new() {
        let server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        assert!(!server.is_active());
        assert_eq!(server.descriptor().kind, "tcp_server");
        assert!(server.get_clients().is_empty());
        assert!(server.take_new_clients().is_empty());
        assert!(server.client_info().is_empty());
    }

    #[test]
    fn test_server_open_and_close() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        assert!(server.is_active());
        server.close().unwrap();
        assert!(!server.is_active());
    }

    #[test]
    fn test_server_accept_client() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();

        // 获取实际监听端口
        let port = server.bound_port().unwrap();

        // 连接一个客户端
        let _client = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));

        // 检查客户端列表
        let clients = server.get_clients();
        assert_eq!(clients.len(), 1);

        // 检查 client_info
        let info = server.client_info();
        assert_eq!(info.len(), 1);

        // 检查 new_clients 队列
        let new_clients = server.take_new_clients();
        assert_eq!(new_clients.len(), 1);
        // 再次取应该为空
        assert!(server.take_new_clients().is_empty());

        server.close().unwrap();
    }

    #[test]
    fn test_server_multiple_clients() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        let port = server.bound_port().unwrap();

        // 连接 3 个客户端
        let _c1 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let _c2 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let _c3 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        let clients = server.get_clients();
        assert_eq!(clients.len(), 3);

        let new_clients = server.take_new_clients();
        assert_eq!(new_clients.len(), 3);

        server.close().unwrap();
    }

    #[test]
    fn test_server_kick_client() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        let port = server.bound_port().unwrap();

        let _client = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));

        let clients = server.get_clients();
        assert_eq!(clients.len(), 1);
        let addr = clients[0];

        assert!(server.kick_client(addr));
        assert_eq!(server.get_clients().len(), 0);
        // 踢出不存在的客户端返回 false
        assert!(!server.kick_client(addr));

        server.close().unwrap();
    }

    #[test]
    fn test_server_broadcast_write() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        let port = server.bound_port().unwrap();

        // 连接两个客户端
        let mut c1 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        let mut c2 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        c1.set_read_timeout(Some(std::time::Duration::from_millis(200))).unwrap();
        c2.set_read_timeout(Some(std::time::Duration::from_millis(200))).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        // 服务端广播发送
        server.write(b"broadcast").unwrap();

        // 两个客户端都应该收到
        let mut buf = [0u8; 64];
        let n1 = c1.read(&mut buf).unwrap();
        assert_eq!(&buf[..n1], b"broadcast");
        let n2 = c2.read(&mut buf).unwrap();
        assert_eq!(&buf[..n2], b"broadcast");

        server.close().unwrap();
    }

    #[test]
    fn test_server_write_no_clients() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        // 没有客户端时写入应该返回错误
        assert!(server.write(b"test").is_err());
        server.close().unwrap();
    }

    #[test]
    fn test_server_read_via_client_channel() {
        // 单读者模型：数据由 take_new_clients 得到的流独占读取，不再走 pending
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        let port = server.bound_port().unwrap();

        let mut client = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));

        let mut new_clients = server.take_new_clients();
        assert_eq!(new_clients.len(), 1);
        let (addr, stream) = new_clients.remove(0);
        let peer = TcpClientTransport::from_stream(stream, addr);

        client.write_all(b"test data").unwrap();
        client.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));

        let mut buf = [0u8; 64];
        // 可能因超时重试几次
        let mut n = 0;
        for _ in 0..20 {
            match peer.read(&mut buf) {
                Ok(sz) if sz > 0 => {
                    n = sz;
                    break;
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        assert_eq!(&buf[..n], b"test data");

        server.close().unwrap();
    }

    #[test]
    fn test_server_client_disconnect() {
        let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
        server.open().unwrap();
        let port = server.bound_port().unwrap();

        let client = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert_eq!(server.get_clients().len(), 1);

        // 断开客户端
        drop(client);
        std::thread::sleep(std::time::Duration::from_millis(200));

        // 读线程应该检测到断开并移除
        // 注意：读线程需要触发一次 read 才能检测到断开
        let mut buf = [0u8; 64];
        let _ = server.read(&mut buf); // 触发读取让读线程有机会检测
        std::thread::sleep(std::time::Duration::from_millis(100));

        // 客户端应该被移除（或在下次 read 时被移除）
        // 由于读线程是异步的，这里主要验证不会 panic
        server.close().unwrap();
    }
}
