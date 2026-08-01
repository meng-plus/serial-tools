//! 分帧器（库内实现，**尚未接入** spawn_reader 读路径）
//!
//! 业务仍按「每次 read 一块」推送；正式接线见 ROADMAP / REFINEMENT。

use std::time::{Duration, Instant};

/// 分帧器配置
#[derive(Debug, Clone)]
pub struct FramerConfig {
    /// 两个字节之间超过此阈值视为一包结束（毫秒）
    pub byte_timeout_ms: u64,
    /// 从收到首字节开始计时，超过此阈值强制断包（毫秒）
    pub frame_timeout_ms: u64,
    /// 可选定界符，按指定分隔符切分
    pub delimiter: Option<Vec<u8>>,
}

impl Default for FramerConfig {
    fn default() -> Self {
        Self {
            byte_timeout_ms: 50,
            frame_timeout_ms: 200,
            delimiter: None,
        }
    }
}

/// 超时断包分帧器
pub struct Framer {
    config: FramerConfig,
    buffer: Vec<u8>,
    last_byte_time: Option<Instant>,
    frame_start_time: Option<Instant>,
}

impl Framer {
    pub fn new(config: FramerConfig) -> Self {
        Self {
            config,
            buffer: Vec::new(),
            last_byte_time: None,
            frame_start_time: None,
        }
    }

    /// 运行中更新超时等配置（保留缓冲）
    pub fn set_config(&mut self, config: FramerConfig) {
        self.config = config;
    }

    pub fn config(&self) -> &FramerConfig {
        &self.config
    }

    /// 喂入新数据
    pub fn feed(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        if self.buffer.is_empty() {
            self.frame_start_time = Some(Instant::now());
        }
        self.buffer.extend_from_slice(data);
        self.last_byte_time = Some(Instant::now());
    }

    /// 尝试提取一个完整帧
    pub fn try_extract(&mut self) -> Option<Vec<u8>> {
        if self.buffer.is_empty() {
            return None;
        }

        // 1. delimiter 模式：按分隔符切分
        if let Some(ref delimiter) = self.config.delimiter.clone() {
            if let Some(pos) = find_delimiter(&self.buffer, delimiter) {
                let end = pos + delimiter.len();
                let frame = self.buffer.drain(..end).collect::<Vec<u8>>();
                if self.buffer.is_empty() {
                    self.last_byte_time = None;
                    self.frame_start_time = None;
                }
                return Some(frame);
            }
            return None;
        }

        // 2. 超时模式：byte_timeout 或 frame_timeout
        let now = Instant::now();

        // frame_timeout：从首字节开始超时
        if let Some(start) = self.frame_start_time {
            if now.duration_since(start) >= Duration::from_millis(self.config.frame_timeout_ms) {
                let frame = std::mem::take(&mut self.buffer);
                self.last_byte_time = None;
                self.frame_start_time = None;
                return Some(frame);
            }
        }

        // byte_timeout：两字节之间超时
        if let Some(last) = self.last_byte_time {
            if now.duration_since(last) >= Duration::from_millis(self.config.byte_timeout_ms) {
                let frame = std::mem::take(&mut self.buffer);
                self.last_byte_time = None;
                self.frame_start_time = None;
                return Some(frame);
            }
        }

        None
    }

    /// 缓冲区是否为空
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

/// 在 haystack 中查找 delimiter 的位置
fn find_delimiter(haystack: &[u8], delimiter: &[u8]) -> Option<usize> {
    if delimiter.is_empty() || haystack.len() < delimiter.len() {
        return None;
    }
    haystack
        .windows(delimiter.len())
        .position(|window| window == delimiter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_framer_default_config() {
        let config = FramerConfig::default();
        assert_eq!(config.byte_timeout_ms, 50);
        assert_eq!(config.frame_timeout_ms, 200);
        assert!(config.delimiter.is_none());
    }

    #[test]
    fn test_framer_empty_feed() {
        let mut framer = Framer::new(FramerConfig::default());
        framer.feed(&[]);
        assert!(framer.is_empty());
        assert!(framer.try_extract().is_none());
    }

    #[test]
    fn test_framer_delimiter_mode() {
        let config = FramerConfig {
            delimiter: Some(b"\n".to_vec()),
            ..Default::default()
        };
        let mut framer = Framer::new(config);

        framer.feed(b"hello\nworld\n");
        assert_eq!(framer.try_extract(), Some(b"hello\n".to_vec()));
        assert_eq!(framer.try_extract(), Some(b"world\n".to_vec()));
        assert!(framer.try_extract().is_none());
    }

    #[test]
    fn test_framer_delimiter_multi_byte() {
        let config = FramerConfig {
            delimiter: Some(b"\r\n".to_vec()),
            ..Default::default()
        };
        let mut framer = Framer::new(config);

        framer.feed(b"line1\r\nline2\r\n");
        assert_eq!(framer.try_extract(), Some(b"line1\r\n".to_vec()));
        assert_eq!(framer.try_extract(), Some(b"line2\r\n".to_vec()));
    }

    #[test]
    fn test_framer_delimiter_partial() {
        let config = FramerConfig {
            delimiter: Some(b"\n".to_vec()),
            ..Default::default()
        };
        let mut framer = Framer::new(config);

        framer.feed(b"hel");
        assert!(framer.try_extract().is_none());
        framer.feed(b"lo\n");
        assert_eq!(framer.try_extract(), Some(b"hello\n".to_vec()));
    }

    #[test]
    fn test_framer_timeout_mode_no_delimiter() {
        let config = FramerConfig {
            byte_timeout_ms: 10,
            frame_timeout_ms: 1000,
            delimiter: None,
        };
        let mut framer = Framer::new(config);

        // 喂入数据后立即尝试提取，应该没有（因为没超时）
        framer.feed(b"hello");
        assert!(framer.try_extract().is_none());

        // 等待 byte_timeout
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(framer.try_extract(), Some(b"hello".to_vec()));
    }

    #[test]
    fn test_framer_frame_timeout() {
        let config = FramerConfig {
            byte_timeout_ms: 10,
            frame_timeout_ms: 30,
            delimiter: None,
        };
        let mut framer = Framer::new(config);

        // 持续喂数据以保持 byte_timeout 不触发
        framer.feed(b"a");
        std::thread::sleep(Duration::from_millis(15));
        framer.feed(b"b");
        std::thread::sleep(Duration::from_millis(15));
        framer.feed(b"c");
        // 此时 frame_timeout (30ms) 应该已经过
        std::thread::sleep(Duration::from_millis(10));
        assert_eq!(framer.try_extract(), Some(b"abc".to_vec()));
    }

    #[test]
    fn test_framer_is_empty_after_extract() {
        let config = FramerConfig {
            delimiter: Some(b"\n".to_vec()),
            ..Default::default()
        };
        let mut framer = Framer::new(config);
        framer.feed(b"test\n");
        assert!(!framer.is_empty());
        framer.try_extract();
        assert!(framer.is_empty());
    }
}
