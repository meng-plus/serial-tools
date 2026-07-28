//! NDJSON (Newline Delimited JSON) 分帧

use super::*;

pub struct NdjsonFramer {
    buffer: Vec<u8>,
}

impl NdjsonFramer {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }
}

impl Framer for NdjsonFramer {
    fn push(&mut self, chunk: RawChunk) -> Vec<Frame> {
        self.buffer.extend_from_slice(&chunk.bytes);
        let mut frames = Vec::new();

        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buffer.drain(..=pos).collect();
            let trimmed = line.into_iter().rev().skip_while(|&b| b == b'\n' || b == b'\r').collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>();
            if !trimmed.is_empty() {
                frames.push(Frame {
                    data: trimmed,
                    timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                });
            }
        }
        frames
    }

    fn flush(&mut self) -> Vec<Frame> {
        vec![]
    }
}
