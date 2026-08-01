//! 日志来源枚举 — 消除散落魔法字符串，序列化仍保持原有 snake_case 契约

use std::fmt;

/// 日志来源分类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogSource {
    /// 连接生命周期（串口 / TCP）
    Connection,
    /// 数据总线
    Bus,
    /// TCP Server 新客户端
    TcpServer,
    /// 读线程退出
    Reader,
    /// 会话配置
    Config,
    /// 系统级
    System,
    /// 录制
    Recording,
    /// 测试
    Test,
}

impl LogSource {
    /// 序列化标识（与历史前端匹配，勿随意改名）
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connection => "connection",
            Self::Bus => "bus",
            Self::TcpServer => "tcp_server",
            Self::Reader => "reader",
            Self::Config => "config",
            Self::System => "system",
            Self::Recording => "recording",
            Self::Test => "test",
        }
    }
}

impl fmt::Display for LogSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_str_stable() {
        assert_eq!(LogSource::Connection.as_str(), "connection");
        assert_eq!(LogSource::Bus.as_str(), "bus");
        assert_eq!(LogSource::TcpServer.as_str(), "tcp_server");
        assert_eq!(LogSource::Reader.as_str(), "reader");
        assert_eq!(LogSource::Config.as_str(), "config");
        assert_eq!(LogSource::System.as_str(), "system");
        assert_eq!(LogSource::Recording.as_str(), "recording");
    }
}
