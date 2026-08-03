//! 超时断包分帧器，已接入 `src-tauri` 的 serial 读路径（`state.rs` spawn_reader）。
//!
//! 业务中仅使用 `byte_timeout` / `frame_timeout`，`delimiter` 恒为 `None`。
//! 前端二进制规则解析另有分帧（`src/protocol/binaryFramer.ts`），二者相互独立。

use std::time::{Duration, Instant};

/// 分帧器配置
#[derive(Debug, Clone)]
pub struct FramerConfig {
    /// 两个字节之间超过此时间视为一包结束（毫秒）
    pub byte_timeout_ms: u64,
    /// 从收到首字节开始计时，超过此时间强制断包（毫秒）
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

/// 提取出的一帧：字节 + 线上收包跨度（不含尾部空闲超时）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedFrame {
    pub bytes: Vec<u8>,
    /// 首字节 → 末字节的耗时（毫秒）；不含断包等待
    pub duration_ms: u64,
    /// 末字节 → 断包判定时刻（毫秒）；通常接近 byte_timeout
    pub since_last_byte_ms: u64,
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

    /// 按首/末字节时刻计算跨度；末字节缺省则退化为判定时刻
    fn timing_of(&self, decided: Instant) -> (u64, u64) {
        let last = self.last_byte_time.unwrap_or(decided);
        let start = self.frame_start_time.unwrap_or(last);
        let duration_ms = last.duration_since(start).as_millis() as u64;
        let since_last_byte_ms = decided.duration_since(last).as_millis() as u64;
        (duration_ms, since_last_byte_ms)
    }

    /// 取出当前缓冲为一帧，并计算耗时
    fn take_frame(&mut self) -> ExtractedFrame {
        let decided = Instant::now();
        let (duration_ms, since_last_byte_ms) = self.timing_of(decided);
        let bytes = std::mem::take(&mut self.buffer);
        self.last_byte_time = None;
        self.frame_start_time = None;
        ExtractedFrame {
            bytes,
            duration_ms,
            since_last_byte_ms,
        }
    }

    /// 定界符切分：取出前缀帧；若缓冲还有剩余，为其重新起算首字节时间
    fn take_prefix(&mut self, end: usize) -> ExtractedFrame {
        let decided = Instant::now();
        let (duration_ms, since_last_byte_ms) = self.timing_of(decided);
        let frame = self.buffer.drain(..end).collect::<Vec<u8>>();
        if self.buffer.is_empty() {
            self.last_byte_time = None;
            self.frame_start_time = None;
        } else {
            // 剩余字节视为下一帧起点
            self.frame_start_time = Some(decided);
            self.last_byte_time = Some(decided);
        }
        ExtractedFrame {
            bytes: frame,
            duration_ms,
            since_last_byte_ms,
        }
    }

    /// 尝试提取一个完整帧
    pub fn try_extract(&mut self) -> Option<ExtractedFrame> {
        if self.buffer.is_empty() {
            return None;
        }

        // 1. delimiter 模式：按分隔符切分
        if let Some(ref delimiter) = self.config.delimiter.clone() {
            if let Some(pos) = find_delimiter(&self.buffer, delimiter) {
                let end = pos + delimiter.len();
                return Some(self.take_prefix(end));
            }
            return None;
        }

        // 2. 超时模式：byte_timeout 或 frame_timeout
        let now = Instant::now();

        // frame_timeout：从首字节开始超时
        if let Some(start) = self.frame_start_time {
            if now.duration_since(start) >= Duration::from_millis(self.config.frame_timeout_ms) {
                return Some(self.take_frame());
            }
        }

        // byte_timeout：两字节之间超时
        if let Some(last) = self.last_byte_time {
            if now.duration_since(last) >= Duration::from_millis(self.config.byte_timeout_ms) {
                return Some(self.take_frame());
            }
        }

        None
    }

    /// 强制取出缓冲中剩余字节（连接断开 / 读线程退出时用）
    pub fn take_remaining(&mut self) -> Option<ExtractedFrame> {
        if self.buffer.is_empty() {
            return None;
        }
        Some(self.take_frame())
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
        assert_eq!(framer.try_extract().unwrap().bytes, b"hello\n");
        assert_eq!(framer.try_extract().unwrap().bytes, b"world\n");
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
        assert_eq!(framer.try_extract().unwrap().bytes, b"line1\r\n");
        assert_eq!(framer.try_extract().unwrap().bytes, b"line2\r\n");
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
        assert_eq!(framer.try_extract().unwrap().bytes, b"hello\n");
    }

    #[test]
    fn test_framer_timeout_mode_no_delimiter() {
        let config = FramerConfig {
            byte_timeout_ms: 10,
            frame_timeout_ms: 1000,
            delimiter: None,
        };
        let mut framer = Framer::new(config);

        framer.feed(b"hello");
        assert!(framer.try_extract().is_none());

        std::thread::sleep(Duration::from_millis(20));
        let frame = framer.try_extract().unwrap();
        assert_eq!(frame.bytes, b"hello");
        // 耗时为首→末字节，不含尾部 byte_timeout 空闲
        assert!(
            frame.duration_ms < 10,
            "duration should exclude idle timeout, got {}",
            frame.duration_ms
        );
        assert!(
            frame.since_last_byte_ms >= 10,
            "idle after last byte should cover timeout wait, got {}",
            frame.since_last_byte_ms
        );
    }

    #[test]
    fn test_framer_frame_timeout() {
        let config = FramerConfig {
            byte_timeout_ms: 10,
            frame_timeout_ms: 30,
            delimiter: None,
        };
        let mut framer = Framer::new(config);

        framer.feed(b"a");
        std::thread::sleep(Duration::from_millis(15));
        framer.feed(b"b");
        std::thread::sleep(Duration::from_millis(15));
        framer.feed(b"c");
        std::thread::sleep(Duration::from_millis(10));
        let frame = framer.try_extract().unwrap();
        assert_eq!(frame.bytes, b"abc");
        // 多段喂入跨度应明显，但仍不含最后一段空闲等待
        assert!(
            frame.duration_ms >= 20,
            "span across feeds, got {}",
            frame.duration_ms
        );
        assert!(
            frame.since_last_byte_ms >= 5,
            "idle after last byte, got {}",
            frame.since_last_byte_ms
        );
    }

    #[test]
    fn test_framer_take_remaining() {
        let mut framer = Framer::new(FramerConfig {
            byte_timeout_ms: 50,
            frame_timeout_ms: 200,
            delimiter: None,
        });
        framer.feed(b"partial");
        let frame = framer.take_remaining().unwrap();
        assert_eq!(frame.bytes, b"partial");
        assert!(framer.is_empty());
        assert!(framer.take_remaining().is_none());
    }
}
