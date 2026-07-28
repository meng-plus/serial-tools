//! 字节超时分帧 — 超过指定时间无新字节则认为一帧结束

use super::*;

pub struct ByteTimeoutFramer {
    buffer: Vec<u8>,
    timeout_ms: u64,
    last_byte_time: Option<std::time::Instant>,
    min_length: usize,
}

impl ByteTimeoutFramer {
    pub fn new(timeout_ms: u64, min_length: usize) -> Self {
        Self {
            buffer: Vec::new(),
            timeout_ms,
            last_byte_time: None,
            min_length,
        }
    }
}

impl Framer for ByteTimeoutFramer {
    fn push(&mut self, chunk: RawChunk) -> Vec<Frame> {
        let mut frames = Vec::new();
        self.buffer.extend_from_slice(&chunk.bytes);
        self.last_byte_time = Some(std::time::Instant::now());
        frames
    }

    fn flush(&mut self) -> Vec<Frame> {
        let mut frames = Vec::new();
        if !self.buffer.is_empty() && self.buffer.len() >= self.min_length {
            frames.push(Frame {
                data: std::mem::take(&mut self.buffer),
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            });
        } else {
            self.buffer.clear();
        }
        self.last_byte_time = None;
        frames
    }
}
