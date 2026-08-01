//! 命令层统一错误 — 前端按 `code` 分支处理，替代散落的 `Result<_, String>`

use serde::ser::SerializeMap;
use serde::Serialize;
use transport::TransportError;

/// 前端约定的错误码字符串
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    ChannelNotFound,
    InvalidRequest,
    SendFailed,
    Transport,
    Recording,
    Internal,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChannelNotFound => "channel_not_found",
            Self::InvalidRequest => "invalid_request",
            Self::SendFailed => "send_failed",
            Self::Transport => "transport",
            Self::Recording => "recording",
            Self::Internal => "internal",
        }
    }
}

/// 命令层错误：携带类别 + 中文消息，序列化为 `{ code, message }`
#[derive(Debug)]
pub enum CommandError {
    ChannelNotFound(String),
    InvalidRequest(String),
    SendFailed(String),
    Transport(TransportError),
    Recording(String),
    Internal(String),
}

impl CommandError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::ChannelNotFound(_) => ErrorCode::ChannelNotFound,
            Self::InvalidRequest(_) => ErrorCode::InvalidRequest,
            Self::SendFailed(_) => ErrorCode::SendFailed,
            Self::Transport(_) => ErrorCode::Transport,
            Self::Recording(_) => ErrorCode::Recording,
            Self::Internal(_) => ErrorCode::Internal,
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::ChannelNotFound(id) => format!("通道 {} 不存在", id),
            Self::InvalidRequest(msg)
            | Self::SendFailed(msg)
            | Self::Recording(msg)
            | Self::Internal(msg) => msg.clone(),
            Self::Transport(e) => e.to_string(),
        }
    }
}

impl From<TransportError> for CommandError {
    fn from(e: TransportError) -> Self {
        Self::Transport(e)
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("code", self.code().as_str())?;
        map.serialize_entry("message", &self.message())?;
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_strings_stable() {
        assert_eq!(ErrorCode::ChannelNotFound.as_str(), "channel_not_found");
        assert_eq!(ErrorCode::SendFailed.as_str(), "send_failed");
    }

    #[test]
    fn serialize_contract() {
        let err = CommandError::ChannelNotFound("serial-COM1".to_string());
        let json = serde_json::to_string(&err).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["code"], "channel_not_found");
        assert_eq!(v["message"], "通道 serial-COM1 不存在");
    }

    #[test]
    fn transport_error_message() {
        let err = CommandError::Transport(TransportError::Message("自定义".to_string()));
        assert_eq!(err.code(), ErrorCode::Transport);
        assert_eq!(err.message(), "自定义");
    }
}
