//! Framer — 接收分帧模块
//!
//! Framer 仅负责 RX 方向的分帧，不参与 TX 编码。

pub mod byte_timeout;
pub mod delimiter;
pub mod length_prefix;
pub mod ndjson;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum FrameError {
    #[error("分帧错误: {0}")]
    Frame(String),
}

/// 原始数据块
#[derive(Debug, Clone)]
pub struct RawChunk {
    pub bytes: Vec<u8>,
    pub timestamp: String,
}

/// 分帧后的帧
#[derive(Debug, Clone)]
pub struct Frame {
    pub data: Vec<u8>,
    pub timestamp: String,
}

/// Framer trait — 纯 RX 分帧
pub trait Framer: Send {
    /// 推入原始数据，返回分帧结果
    fn push(&mut self, chunk: RawChunk) -> Vec<Frame>;
    /// 刷新缓冲区（如超时后强制输出）
    fn flush(&mut self) -> Vec<Frame>;
}
