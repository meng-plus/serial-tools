//! 长度前缀分帧

use super::*;

pub struct LengthPrefixFramer {
    header_size: usize,
    length_offset: usize,
    big_endian: bool,
    buffer: Vec<u8>,
}

impl LengthPrefixFramer {
    pub fn new(header_size: usize, length_offset: usize, big_endian: bool) -> Self {
        Self { header_size, length_offset, big_endian, buffer: Vec::new() }
    }
}

impl Framer for LengthPrefixFramer {
    fn push(&mut self, chunk: RawChunk) -> Vec<Frame> {
        self.buffer.extend_from_slice(&chunk.bytes);
        let mut frames = Vec::new();

        loop {
            if self.buffer.len() < self.header_size {
                break;
            }

            let len_bytes = &self.buffer[self.length_offset..self.length_offset + self.header_size.min(4)];
            let payload_len = if self.big_endian {
                u32::from_be_bytes([
                    len_bytes.get(0).copied().unwrap_or(0),
                    len_bytes.get(1).copied().unwrap_or(0),
                    len_bytes.get(2).copied().unwrap_or(0),
                    len_bytes.get(3).copied().unwrap_or(0),
                ]) as usize
            } else {
                u32::from_le_bytes([
                    len_bytes.get(0).copied().unwrap_or(0),
                    len_bytes.get(1).copied().unwrap_or(0),
                    len_bytes.get(2).copied().unwrap_or(0),
                    len_bytes.get(3).copied().unwrap_or(0),
                ]) as usize
            };

            let total = self.header_size + payload_len;
            if self.buffer.len() < total {
                break;
            }

            let frame_data = self.buffer.drain(..total).collect();
            frames.push(Frame {
                data: frame_data,
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            });
        }
        frames
    }

    fn flush(&mut self) -> Vec<Frame> {
        vec![]
    }
}
