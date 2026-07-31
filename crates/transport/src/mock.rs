//! Mock Transport — 用于单元测试，无需真实硬件

use super::*;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Mock Transport：内存中的可编程传输层
/// - 预设 RX 数据队列（read 时依次返回）
/// - 记录所有 TX 数据（write 被调用的内容）
pub struct MockTransport {
    descriptor: TransportDescriptor,
    rx_queue: Arc<Mutex<VecDeque<Vec<u8>>>>,
    tx_log: Arc<Mutex<Vec<Vec<u8>>>>,
    active: bool,
}

impl MockTransport {
    pub fn new(kind: &str, address: &str) -> Self {
        Self {
            descriptor: TransportDescriptor {
                kind: kind.to_string(),
                address: address.to_string(),
                ..Default::default()
            },
            rx_queue: Arc::new(Mutex::new(VecDeque::new())),
            tx_log: Arc::new(Mutex::new(Vec::new())),
            active: false,
        }
    }

    /// 预设一批 RX 数据（read 时依次返回）
    pub fn enqueue_rx(&self, data: Vec<u8>) {
        self.rx_queue.lock().unwrap().push_back(data);
    }

    /// 批量预设 RX 数据
    pub fn enqueue_rx_batch(&self, items: Vec<Vec<u8>>) {
        let mut q = self.rx_queue.lock().unwrap();
        for item in items {
            q.push_back(item);
        }
    }

    /// 获取所有已发送的数据
    pub fn get_tx_log(&self) -> Vec<Vec<u8>> {
        self.tx_log.lock().unwrap().clone()
    }

    /// 清空 TX 日志
    pub fn clear_tx_log(&self) {
        self.tx_log.lock().unwrap().clear();
    }

    /// 获取 TX 总字节数
    pub fn tx_bytes(&self) -> usize {
        self.tx_log.lock().unwrap().iter().map(|d| d.len()).sum()
    }
}

impl Transport for MockTransport {
    fn open(&mut self) -> Result<(), TransportError> {
        self.active = true;
        Ok(())
    }

    fn close(&mut self) -> Result<(), TransportError> {
        self.active = false;
        Ok(())
    }

    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError> {
        if !self.active {
            return Err(TransportError::NotConnected);
        }
        self.tx_log.lock().unwrap().push(bytes.to_vec());
        Ok(bytes.len())
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError> {
        if !self.active {
            return Err(TransportError::NotConnected);
        }
        let mut q = self.rx_queue.lock().unwrap();
        match q.pop_front() {
            Some(data) => {
                let n = data.len().min(buf.len());
                buf[..n].copy_from_slice(&data[..n]);
                Ok(n)
            }
            None => Ok(0), // 无数据，模拟超时
        }
    }

    fn is_active(&self) -> bool {
        self.active
    }

    fn descriptor(&self) -> &TransportDescriptor {
        &self.descriptor
    }
}
