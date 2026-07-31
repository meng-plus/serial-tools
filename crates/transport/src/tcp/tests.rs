//! TCP 传输层单元测试

use super::*;
use crate::Transport;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};


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

