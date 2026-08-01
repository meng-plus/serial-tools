//! 功能测试 — TCP Loopback 收发 + Mock Transport 状态管理
//!
//! 测试策略：
//!   1. 用 MockTransport 测试状态管理层（AppState）
//!   2. 用真实 TCP loopback 测试 TCP 收发路径
//!   3. 不依赖 Tauri 框架，直接测试底层逻辑

use std::sync::Arc;
use transport::mock::MockTransport;
use transport::Transport;

// ── 辅助函数 ──────────────────────────────────────────────────

/// 创建一个已打开的 MockTransport
fn make_open_mock(kind: &str, addr: &str) -> MockTransport {
    let mut m = MockTransport::new(kind, addr);
    m.open().unwrap();
    m
}

// ══════════════════════════════════════════════════════════════
// L1: Transport 单元测试
// ══════════════════════════════════════════════════════════════

#[test]
fn test_mock_transport_lifecycle() {
    let mut m = MockTransport::new("serial", "COM1");
    assert!(!m.is_active());
    m.open().unwrap();
    assert!(m.is_active());
    m.close().unwrap();
    assert!(!m.is_active());
}

#[test]
fn test_mock_transport_write_and_read() {
    let mut m = make_open_mock("serial", "COM1");

    // 写入
    let n = m.write(b"AT+RST\r\n").unwrap();
    assert_eq!(n, 8);
    assert_eq!(m.tx_bytes(), 8);
    assert_eq!(m.get_tx_log(), vec![b"AT+RST\r\n".to_vec()]);

    // 预设 RX 并读取
    m.enqueue_rx(b"OK\r\n".to_vec());
    let mut buf = [0u8; 64];
    let n = m.read(&mut buf).unwrap();
    assert_eq!(n, 4);
    assert_eq!(&buf[..4], b"OK\r\n");
}

#[test]
fn test_mock_transport_multi_read_ordering() {
    let mut m = make_open_mock("serial", "COM1");

    m.enqueue_rx(b"first".to_vec());
    m.enqueue_rx(b"second".to_vec());
    m.enqueue_rx(b"third".to_vec());

    let mut buf = [0u8; 64];

    let n = m.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"first");

    let n = m.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"second");

    let n = m.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"third");

    // 空队列
    let n = m.read(&mut buf).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn test_mock_transport_batch_write() {
    let mut m = make_open_mock("serial", "COM1");

    m.write(b"aaa").unwrap();
    m.write(b"bbb").unwrap();
    m.write(b"ccc").unwrap();

    let log = m.get_tx_log();
    assert_eq!(log.len(), 3);
    assert_eq!(log[0], b"aaa");
    assert_eq!(log[1], b"bbb");
    assert_eq!(log[2], b"ccc");
    assert_eq!(m.tx_bytes(), 9);
}

#[test]
fn test_mock_transport_large_data() {
    let mut m = make_open_mock("serial", "COM1");

    let data = vec![0xAB; 4096];
    m.enqueue_rx(data.clone());

    let mut buf = [0u8; 4096];
    let n = m.read(&mut buf).unwrap();
    assert_eq!(n, 4096);
    assert_eq!(&buf[..n], data.as_slice());
}

#[test]
fn test_mock_transport_write_after_close_fails() {
    let mut m = make_open_mock("serial", "COM1");
    m.close().unwrap();
    let result = m.write(b"test");
    assert!(result.is_err());
}

#[test]
fn test_mock_transport_read_after_close_fails() {
    let mut m = make_open_mock("serial", "COM1");
    m.close().unwrap();
    let mut buf = [0u8; 64];
    let result = m.read(&mut buf);
    assert!(result.is_err());
}

// ══════════════════════════════════════════════════════════════
// L2: AppState 数据管理测试
// ══════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_appstate_default() {
    let state = serial_tools_lib::state::AppState::default();
    assert_eq!(state.channels.count().await, 0);

    let packets = state.packets.lock().await;
    assert!(packets.is_empty());
    drop(packets);

    let logs = state.logs.lock().await;
    assert!(logs.is_empty());
}

#[tokio::test]
async fn test_appstate_push_packet() {
    let state = serial_tools_lib::state::AppState::default();

    let entry = serial_tools_lib::state::PacketEntry {
        timestamp: "12:00:00.000".to_string(),
        direction: "rx".to_string(),
        channel_id: "test".to_string(),
        bytes: b"hello".to_vec(),
        hex: "68656c6c6f".to_string(),
        text: "hello".to_string(),
        seq: 1,
    };

    state.push_packet(entry).await;

    let packets = state.packets.lock().await;
    assert_eq!(packets.len(), 1);
    assert_eq!(packets[0].direction, "rx");
    assert_eq!(packets[0].hex, "68656c6c6f");
}

#[tokio::test]
async fn test_appstate_packet_overflow_trim() {
    let state = serial_tools_lib::state::AppState::default();

    // 推入 11000 条，触发裁剪
    for i in 0..11000 {
        let entry = serial_tools_lib::state::PacketEntry {
            timestamp: format!("{:06}", i),
            direction: "rx".to_string(),
            channel_id: "test".to_string(),
            bytes: vec![i as u8],
            hex: format!("{:02x}", i as u8),
            text: String::new(),
            seq: i as u64 + 1,
        };
        state.push_packet(entry).await;
    }

    let packets = state.packets.lock().await;
    // 10001st push 触发裁剪: 10001 - 8000 = 2001 条被裁掉
    // 后续 999 条追加，最终 ~8999 条
    assert!(packets.len() <= 9000);
    assert!(packets.len() >= 8000);
    // 最早的应该是 i=2001
    assert_eq!(packets[0].timestamp, "002001");
}

#[tokio::test]
async fn test_appstate_log() {
    let state = serial_tools_lib::state::AppState::default();

    state.log("info", "test", "message1").await;
    state.log("error", "test", "message2").await;

    let logs = state.logs.lock().await;
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].level, "info");
    assert_eq!(logs[0].message, "message1");
    assert_eq!(logs[1].level, "error");
    assert_eq!(logs[1].message, "message2");
}

#[tokio::test]
async fn test_appstate_channel_insert_and_remove() {
    let state = serial_tools_lib::state::AppState::default();

    let mock = Arc::new(make_open_mock("serial", "COM1"));
    state
        .channels
        .put_transport("test-ch".to_string(), mock)
        .await;

    assert!(state.channels.contains("test-ch").await);
    assert!(state.channels.is_active("test-ch").await);

    // 移除（不需要读线程的情况）
    let (transport, _, _) = state.channels.remove("test-ch").await;
    assert!(transport.is_some());
    assert!(!state.channels.contains("test-ch").await);
}

#[tokio::test]
async fn test_appstate_send_to_channel() {
    let state = serial_tools_lib::state::AppState::default();

    let mock = Arc::new(make_open_mock("serial", "COM1"));
    state
        .channels
        .put_transport("ch1".to_string(), mock.clone())
        .await;

    let sent = state.send_to_channel("ch1", b"test data").await.unwrap();
    assert_eq!(sent, 9);

    let log = mock.get_tx_log();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0], b"test data");
}

#[tokio::test]
async fn test_appstate_send_to_nonexistent_channel() {
    let state = serial_tools_lib::state::AppState::default();
    let result = state.send_to_channel("no-such", b"test").await;
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().code(),
        serial_tools_lib::error::ErrorCode::ChannelNotFound
    );
}

#[tokio::test]
async fn test_appstate_rx_broadcast() {
    let state = serial_tools_lib::state::AppState::default();
    let mut rx = state.rx_broadcast.subscribe();

    let event = serial_tools_lib::state::RxBroadcastEvent {
        channel_id: "ch1".to_string(),
        bytes: b"data".to_vec(),
        timestamp: "12:00:00.000".to_string(),
        seq: 1,
    };

    state.rx_broadcast.send(event.clone()).unwrap();

    let received = rx.recv().await.unwrap();
    assert_eq!(received.channel_id, "ch1");
    assert_eq!(received.bytes, b"data");
}

// ══════════════════════════════════════════════════════════════
// L3: TCP Loopback 功能测试
// ══════════════════════════════════════════════════════════════

/// TCP 回环测试：启动 TCP server，用 TcpClientTransport 连接，发送并接收数据
#[tokio::test]
async fn test_tcp_loopback_send_receive() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use transport::tcp::TcpClientTransport;

    // 选一个随机端口
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let port = addr.port();

    // 在线程中运行 server
    let server_handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();

        // 读取 client 发来的数据
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap();
        assert!(n > 0);
        let received = String::from_utf8_lossy(&buf[..n]).to_string();
        assert_eq!(received, "Hello TCP");

        // 原样回传
        stream.write_all(&buf[..n]).unwrap();
        stream.flush().unwrap();
    });

    // Client
    let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), port);
    tcp.open().unwrap();
    assert!(tcp.is_active());
    assert_eq!(tcp.descriptor().kind, "tcp_client");
    assert_eq!(tcp.descriptor().address, format!("127.0.0.1:{}", port));

    // 发送
    let sent = tcp.write(b"Hello TCP").unwrap();
    assert_eq!(sent, 9);

    // 接收回传
    let mut buf = [0u8; 1024];
    // 短暂等待 server 处理
    std::thread::sleep(std::time::Duration::from_millis(50));
    let n = tcp.read(&mut buf).unwrap();
    assert_eq!(n, 9);
    assert_eq!(&buf[..n], b"Hello TCP");

    tcp.close().unwrap();
    assert!(!tcp.is_active());

    server_handle.join().unwrap();
}

/// TCP 多次收发测试
#[tokio::test]
async fn test_tcp_loopback_multi_send() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use transport::tcp::TcpClientTransport;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let server_handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();

        let mut received_all = Vec::new();
        let mut buf = [0u8; 1024];
        // 收到至少 3 次就退出
        while received_all.len() < 3 {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    received_all.push(buf[..n].to_vec());
                    // 回传
                    stream.write_all(&buf[..n]).unwrap();
                }
                Err(_) => break,
            }
        }
        received_all
    });

    let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), port);
    tcp.open().unwrap();

    let mut echo_buf = [0u8; 1024];
    for msg in [b"msg1".as_slice(), b"msg2", b"msg3"] {
        tcp.write(msg).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        let n = tcp.read(&mut echo_buf).unwrap();
        assert_eq!(&echo_buf[..n], msg);
    }

    tcp.close().unwrap();
    let server_received = server_handle.join().unwrap();
    assert_eq!(server_received.len(), 3);
    assert_eq!(server_received[0], b"msg1");
    assert_eq!(server_received[1], b"msg2");
    assert_eq!(server_received[2], b"msg3");
}

/// TCP 对端关闭后 read 返回 0
#[tokio::test]
async fn test_tcp_peer_close() {
    use std::io::Write;
    use std::net::TcpListener;
    use transport::tcp::TcpClientTransport;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let server_handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.write_all(b"bye").unwrap();
        drop(stream); // 关闭连接
    });

    let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), port);
    tcp.open().unwrap();

    let mut buf = [0u8; 1024];
    let n = tcp.read(&mut buf).unwrap();
    assert_eq!(n, 3);
    assert_eq!(&buf[..3], b"bye");

    // 对端已关闭，read 应返回 0
    let n = tcp.read(&mut buf).unwrap();
    assert_eq!(n, 0);

    tcp.close().unwrap();
    server_handle.join().unwrap();
}

// ══════════════════════════════════════════════════════════════
// L4: 转发场景测试
// ══════════════════════════════════════════════════════════════

/// 场景测试：Mock A → 转发 → Mock B（单向）
#[tokio::test]
async fn test_forward_mock_single_direction() {
    use std::sync::atomic::{AtomicBool, Ordering};

    let mock_a = Arc::new(make_open_mock("serial", "COM_A"));
    let mock_b = Arc::new(make_open_mock("serial", "COM_B"));

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();
    let a_clone = mock_a.clone();
    let b_clone = mock_b.clone();

    // A → B 转发线程
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if cancel_clone.load(Ordering::Relaxed) {
                break;
            }
            match a_clone.read(&mut buf) {
                Ok(0) => std::thread::sleep(std::time::Duration::from_millis(5)),
                Ok(n) => {
                    let _ = b_clone.write(&buf[..n]);
                }
                Err(_) => break,
            }
        }
    });

    // A 写入数据（模拟 A 端收到的 RX 数据通过转发到 B）
    mock_a.enqueue_rx(b"hello from A".to_vec());
    std::thread::sleep(std::time::Duration::from_millis(100));

    // 触发转发读取
    let mut buf = [0u8; 4096];
    let n = a_clone_read_helper(&mock_a, &mut buf);
    if n > 0 {
        mock_b.write(&buf[..n]).unwrap();
    }

    // 验证 B 收到了数据
    let tx_log = mock_b.get_tx_log();
    assert!(!tx_log.is_empty());
    assert_eq!(tx_log[0], b"hello from A");

    cancel.store(true, Ordering::Relaxed);
    handle.join().unwrap();
}

fn a_clone_read_helper(m: &MockTransport, buf: &mut [u8]) -> usize {
    m.read(buf).unwrap_or(0)
}

/// 场景测试：双向转发 — A ↔ B
#[tokio::test]
async fn test_forward_bidirectional_mock() {
    let mock_a = Arc::new(make_open_mock("serial", "COM_A"));
    let mock_b = Arc::new(make_open_mock("serial", "COM_B"));

    // A → B
    mock_a.enqueue_rx(b"A sends".to_vec());
    let mut buf = [0u8; 4096];
    let n = mock_a.read(&mut buf).unwrap();
    mock_b.write(&buf[..n]).unwrap();

    // B → A
    mock_b.enqueue_rx(b"B replies".to_vec());
    let n = mock_b.read(&mut buf).unwrap();
    mock_a.write(&buf[..n]).unwrap();

    // 验证
    assert_eq!(mock_a.get_tx_log(), vec![b"B replies".to_vec()]);
    assert_eq!(mock_b.get_tx_log(), vec![b"A sends".to_vec()]);
}

/// 场景测试：TCP → Mock 串口 转发
#[tokio::test]
async fn test_forward_tcp_to_mock_serial() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use transport::tcp::TcpClientTransport;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    // TCP server 线程：接收数据后回传
    let server_handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap();
        stream.write_all(&buf[..n]).unwrap();
    });

    // TCP client 连接
    let mut tcp = TcpClientTransport::new("127.0.0.1".to_string(), port);
    tcp.open().unwrap();

    // Mock 串口
    let serial = Arc::new(make_open_mock("serial", "COM1"));

    // 模拟 TCP → 串口 转发：从 TCP 读数据写入串口
    tcp.write(b"from tcp").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));

    let mut buf = [0u8; 1024];
    let n = tcp.read(&mut buf).unwrap();
    // TCP 收到 echo 后转发到串口
    let _ = serial.write(&buf[..n]);

    let tx_log = serial.get_tx_log();
    assert!(!tx_log.is_empty());
    assert_eq!(tx_log[0], b"from tcp");

    drop(tcp);
    server_handle.join().unwrap();
}

/// 场景测试：TCP ↔ TCP 转发
#[tokio::test]
async fn test_forward_tcp_to_tcp() {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use transport::tcp::TcpClientTransport;

    // 两个 TCP server
    let listener1 = TcpListener::bind("127.0.0.1:0").unwrap();
    let port1 = listener1.local_addr().unwrap().port();
    let listener2 = TcpListener::bind("127.0.0.1:0").unwrap();
    let port2 = listener2.local_addr().unwrap().port();

    // Server1 线程：接收并回传
    let s1 = std::thread::spawn(move || {
        let (mut stream, _) = listener1.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap();
        stream.write_all(&buf[..n]).unwrap();
    });

    // Server2 线程：接收并回传
    let s2 = std::thread::spawn(move || {
        let (mut stream, _) = listener2.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut buf = [0u8; 1024];
        let n = stream.read(&mut buf).unwrap();
        stream.write_all(&buf[..n]).unwrap();
    });

    // TCP client 1
    let mut tcp1 = TcpClientTransport::new("127.0.0.1".to_string(), port1);
    tcp1.open().unwrap();

    // TCP client 2
    let mut tcp2 = TcpClientTransport::new("127.0.0.1".to_string(), port2);
    tcp2.open().unwrap();

    // 模拟双向转发
    // tcp1 发 → server1 echo → tcp1 收 → 转发到 tcp2 发 → server2 echo → tcp2 收
    tcp1.write(b"hello world").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let mut buf = [0u8; 1024];
    let n = tcp1.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"hello world");

    // 转发到 tcp2
    tcp2.write(&buf[..n]).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let n = tcp2.read(&mut buf).unwrap();
    assert_eq!(&buf[..n], b"hello world");

    tcp1.close().unwrap();
    tcp2.close().unwrap();
    s1.join().unwrap();
    s2.join().unwrap();
}

/// 场景测试：串口 ↔ TCP 转发（两个 Mock 模拟）
#[tokio::test]
async fn test_forward_serial_to_tcp_mock() {
    use std::sync::atomic::{AtomicBool, Ordering};

    let serial = Arc::new(make_open_mock("serial", "COM3"));
    let tcp = Arc::new(make_open_mock("tcp_client", "192.168.1.100:5000"));

    let cancel = Arc::new(AtomicBool::new(false));

    // 模拟串口 → TCP 单向转发
    serial.enqueue_rx(b"sensor:25.5".to_vec());

    let mut buf = [0u8; 4096];
    let n = serial.read(&mut buf).unwrap();
    tcp.write(&buf[..n]).unwrap();

    let tx_log = tcp.get_tx_log();
    assert_eq!(tx_log.len(), 1);
    assert_eq!(tx_log[0], b"sensor:25.5");

    // 模拟 TCP → 串口 单向转发
    tcp.enqueue_rx(b"cmd:set".to_vec());
    let n = tcp.read(&mut buf).unwrap();
    serial.write(&buf[..n]).unwrap();

    let tx_log = serial.get_tx_log();
    assert_eq!(tx_log.len(), 1);
    assert_eq!(tx_log[0], b"cmd:set");
}

// ══════════════════════════════════════════════════════════════
// L5: 事件桥接测试
// ══════════════════════════════════════════════════════════════

/// 测试 log_broadcast 广播机制
#[tokio::test]
async fn test_log_broadcast() {
    let state = serial_tools_lib::state::AppState::default();
    let mut rx = state.log_broadcast.subscribe();

    state.log("info", "test", "log message 1").await;
    state.log("error", "test", "log message 2").await;

    let entry1 = rx.recv().await.unwrap();
    assert_eq!(entry1.level, "info");
    assert_eq!(entry1.message, "log message 1");

    let entry2 = rx.recv().await.unwrap();
    assert_eq!(entry2.level, "error");
    assert_eq!(entry2.message, "log message 2");
}

/// 测试 rx_broadcast 多订阅者
#[tokio::test]
async fn test_rx_broadcast_multi_subscriber() {
    let state = serial_tools_lib::state::AppState::default();
    let mut rx1 = state.rx_broadcast.subscribe();
    let mut rx2 = state.rx_broadcast.subscribe();

    let event = serial_tools_lib::state::RxBroadcastEvent {
        channel_id: "ch1".to_string(),
        bytes: b"multi".to_vec(),
        timestamp: "12:00:00.000".to_string(),
        seq: 2,
    };
    state.rx_broadcast.send(event).unwrap();

    // 两个订阅者都应该收到
    let r1 = rx1.recv().await.unwrap();
    let r2 = rx2.recv().await.unwrap();
    assert_eq!(r1.bytes, b"multi");
    assert_eq!(r2.bytes, b"multi");
}

/// 测试 AppState log 同时写入 logs 和 log_broadcast
#[tokio::test]
async fn test_log_writes_to_both_logs_and_broadcast() {
    let state = serial_tools_lib::state::AppState::default();
    let mut rx = state.log_broadcast.subscribe();

    state.log("warn", "system", "warning msg").await;

    // 验证写入 logs
    let logs = state.logs.lock().await;
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].level, "warn");
    drop(logs);

    // 验证广播
    let entry = rx.recv().await.unwrap();
    assert_eq!(entry.level, "warn");
    assert_eq!(entry.source, "system");
}

// ══════════════════════════════════════════════════════════════
// L6: TcpServerTransport 集成测试
// ══════════════════════════════════════════════════════════════

/// TCP Server 多客户端并发：广播 TX + 独占读通道 RX
#[tokio::test]
async fn test_tcp_server_multi_client_concurrent() {
    use std::io::{Read, Write};
    use transport::tcp::{TcpClientTransport, TcpServerTransport};
    use transport::Transport;

    let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
    server.open().unwrap();
    let port = server.bound_port().unwrap();

    // 连接两个客户端
    let mut c1 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
    let mut c2 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
    c1.set_read_timeout(Some(std::time::Duration::from_millis(500)))
        .unwrap();
    c2.set_read_timeout(Some(std::time::Duration::from_millis(500)))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let mut new_clients = server.take_new_clients();
    assert_eq!(new_clients.len(), 2);
    let (addr1, stream1) = new_clients.remove(0);
    let (addr2, stream2) = new_clients.remove(0);
    let peer1 = TcpClientTransport::from_stream(stream1, addr1);
    let peer2 = TcpClientTransport::from_stream(stream2, addr2);

    // 客户端1发送数据 → 由独占读通道读取
    c1.write_all(b"from c1").unwrap();
    c1.flush().unwrap();
    let mut buf = [0u8; 64];
    let mut n = 0;
    for _ in 0..30 {
        match peer1.read(&mut buf) {
            Ok(sz) if sz > 0 => {
                n = sz;
                break;
            }
            _ => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    assert_eq!(&buf[..n], b"from c1");

    // 客户端2发送数据
    c2.write_all(b"from c2").unwrap();
    c2.flush().unwrap();
    n = 0;
    for _ in 0..30 {
        match peer2.read(&mut buf) {
            Ok(sz) if sz > 0 => {
                n = sz;
                break;
            }
            _ => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    assert_eq!(&buf[..n], b"from c2");

    // 服务端广播回复
    server.write(b"reply all").unwrap();

    let n1 = c1.read(&mut buf).unwrap();
    assert_eq!(&buf[..n1], b"reply all");
    let n2 = c2.read(&mut buf).unwrap();
    assert_eq!(&buf[..n2], b"reply all");

    server.close().unwrap();
}

/// TCP Server take_new_clients 提取后不影响已有客户端
#[tokio::test]
async fn test_tcp_server_take_new_clients_preserves_existing() {
    use transport::tcp::TcpServerTransport;
    use transport::Transport;

    let mut server = TcpServerTransport::new("127.0.0.1".to_string(), 0);
    server.open().unwrap();
    let port = server.bound_port().unwrap();

    // 连接客户端
    let _c1 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 提取新客户端
    let new = server.take_new_clients();
    assert_eq!(new.len(), 1);

    // 已有客户端仍然存在
    assert_eq!(server.get_clients().len(), 1);
    assert_eq!(server.client_info().len(), 1);

    // 再连接一个
    let _c2 = TcpStream::connect(format!("127.0.0.1:{}", port)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 再次提取应该只有新客户端
    let new = server.take_new_clients();
    assert_eq!(new.len(), 1);

    // 总共两个客户端
    assert_eq!(server.get_clients().len(), 2);

    server.close().unwrap();
}

use std::net::TcpStream;

// ══════════════════════════════════════════════════════════════
// L7: 数据总线测试
// ══════════════════════════════════════════════════════════════

use serial_tools_lib::state::{BusDirection, DataBus};

#[tokio::test]
async fn test_bus_create_and_list() {
    use transport::mock::MockTransport;
    use transport::Transport;

    let state = serial_tools_lib::state::AppState::default();
    let (bus_tx, _) = tokio::sync::broadcast::channel(1024);

    let bus = DataBus {
        id: "bus-1".to_string(),
        name: "test-bus".to_string(),
        subscriptions: Vec::new(),
        bus_tx,
        cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        sub_cancels: std::collections::HashMap::new(),
        threads: Vec::new(),
        rx_bytes: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        tx_bytes: Arc::new(std::sync::atomic::AtomicU64::new(0)),
    };

    state.buses.write().await.insert("bus-1".to_string(), bus);
    let buses = state.buses.read().await;
    assert_eq!(buses.len(), 1);
    assert_eq!(buses.get("bus-1").unwrap().name, "test-bus");
}

#[tokio::test]
async fn test_bus_mock_forward() {
    use transport::mock::MockTransport;
    use transport::Transport;

    // 创建两个 mock transport
    let mut mock_a = MockTransport::new("serial", "COM_A");
    mock_a.open().unwrap();
    let mut mock_b = MockTransport::new("serial", "COM_B");
    mock_b.open().unwrap();

    // 模拟总线转发：A.RX → bus → B.TX
    mock_a.enqueue_rx(b"hello from A".to_vec());

    // 模拟总线内部转发
    let (bus_tx, mut bus_rx) = tokio::sync::broadcast::channel::<Vec<u8>>(1024);

    // A 读线程：读 A.RX → 推入 bus
    let a_transport = Arc::new(mock_a);
    let b_transport = Arc::new(mock_b);
    let a_ref = a_transport.clone();
    let b_ref = b_transport.clone();
    let bus_tx2 = bus_tx.clone();

    // 读 A
    let mut buf = [0u8; 4096];
    let n = a_ref.read(&mut buf).unwrap();
    assert!(n > 0);
    bus_tx2.send(buf[..n].to_vec()).unwrap();

    // 从 bus 读 → 写 B
    let data = bus_rx.try_recv().unwrap();
    b_ref.write(&data).unwrap();

    // 验证 B 收到
    let tx_log = b_ref.get_tx_log();
    assert_eq!(tx_log.len(), 1);
    assert_eq!(tx_log[0], b"hello from A");
}

#[tokio::test]
async fn test_bus_direction_enum() {
    // 验证方向枚举的正确性
    assert_ne!(BusDirection::RxToBus, BusDirection::TxFromBus);
    assert_ne!(BusDirection::Both, BusDirection::RxToBus);
    assert_eq!(BusDirection::Both, BusDirection::Both);
}
