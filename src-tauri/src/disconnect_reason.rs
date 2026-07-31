//! 断开原因 — 本端 / 对端优雅 / 异常
//!
//! 前后端约定字符串：`local` | `remote` | `error`

use std::fmt;

/// 通道断开原因（序列化为小写字符串推送前端）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisconnectReason {
    /// 本端主动断开（用户点击 / disconnect 命令）
    Local,
    /// 对端优雅关闭（TCP FIN → Ok(0)）
    Remote,
    /// 对端异常（RST / ConnectionReset 等）
    Error,
}

impl DisconnectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Remote => "remote",
            Self::Error => "error",
        }
    }

    pub fn log_level(self) -> &'static str {
        match self {
            Self::Error => "warn",
            _ => "info",
        }
    }

    pub fn user_message(self, channel_id: &str) -> String {
        match self {
            Self::Local => format!("{} 已断开", channel_id),
            Self::Remote => format!("{} 已断开", channel_id),
            Self::Error => format!("{} 服务异常", channel_id),
        }
    }
}

impl fmt::Display for DisconnectReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl serde::Serialize for DisconnectReason {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reason_strings_stable() {
        assert_eq!(DisconnectReason::Local.as_str(), "local");
        assert_eq!(DisconnectReason::Remote.as_str(), "remote");
        assert_eq!(DisconnectReason::Error.as_str(), "error");
    }

    #[test]
    fn serialize_as_plain_string() {
        let s = serde_json::to_string(&DisconnectReason::Remote).unwrap();
        assert_eq!(s, "\"remote\"");
    }
}
