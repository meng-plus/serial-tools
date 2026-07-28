//! 定界符分帧

use super::*;

pub struct DelimiterFramer {
    delimiter: Vec<u8>,
    buffer: Vec<u8>,
    strip: bool,
}

impl DelimiterFramer {
    pub fn new(delimiter: Vec<u8>, strip: bool) -> Self {
        Self { delimiter, buffer: Vec::new(), strip }
    }
}

impl Framer for DelimiterFramer {
    fn push(&mut self, chunk: RawChunk) -> Vec<Frame> {
        self.buffer.extend_from_slice(&chunk.bytes);
        let mut frames = Vec::new();

        while let Some(pos) = find_subsequence(&self.buffer, &self.delimiter) {
            let end = if self.strip { pos } else { pos + self.delimiter.len() };
            let frame_data = self.buffer.drain(..end).collect();
            if !self.buffer.is_empty() {
                // 消耗掉 delimiter
                if self.strip {
                    self.buffer.drain(..self.delimiter.len());
                }
            }
            frames.push(Frame {
                data: frame_data,
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            });
        }
        frames
    }

    fn flush(&mut self) -> Vec<Frame> {
        if !self.buffer.is_empty() {
            let data = std::mem::take(&mut self.buffer);
            vec![Frame {
                data,
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            }]
        } else {
            vec![]
        }
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
