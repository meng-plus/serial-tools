use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

/// 日志格式（前端经命令透传，需 serde）
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    /// 原始字节，rx/tx 独立文件
    Bin,
    /// CSV：timestamp,direction,channel_id,bytes_hex,bytes_text
    Csv,
    /// HEX：十六进制文本，每行 16 字节，带偏移地址
    Hex,
    /// Text：按 UTF-8（容错）解码为连续文本，每帧一行；rx/tx 独立文件
    Text,
}

/// 文件名字符消毒（与 fs_util::sanitize_filename 一致的保守子集）
fn sanitize_component(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    cleaned.trim_matches(|c| c == '-' || c == ' ').to_string()
}

/// 数据日志录制器（每通道一个实例，由 RecordingRegistry 管理）
pub struct DataLogger {
    format: LogFormat,
    output_dir: PathBuf,
    channel_id: String,
    rx_file: Option<File>,
    tx_file: Option<File>,
    running: bool,
}

impl DataLogger {
    /// 创建新的 DataLogger
    pub fn new(format: LogFormat, output_dir: PathBuf, channel_id: String) -> Self {
        Self {
            format,
            output_dir,
            channel_id,
            rx_file: None,
            tx_file: None,
            running: false,
        }
    }

    /// 打开文件，开始录制
    pub fn start(&mut self) -> std::io::Result<()> {
        if self.running {
            return Ok(());
        }

        fs::create_dir_all(&self.output_dir)?;

        let now = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        let label = sanitize_component(&self.channel_id);
        let prefix = if label.is_empty() {
            format!("{now}")
        } else {
            format!("{label}_{now}")
        };

        match self.format {
            LogFormat::Bin => {
                let rx_path = self.output_dir.join(format!("{prefix}_rx.bin"));
                let tx_path = self.output_dir.join(format!("{prefix}_tx.bin"));
                self.rx_file = Some(File::create(rx_path)?);
                self.tx_file = Some(File::create(tx_path)?);
            }
            LogFormat::Csv => {
                let rx_path = self.output_dir.join(format!("{prefix}_rx.csv"));
                let tx_path = self.output_dir.join(format!("{prefix}_tx.csv"));
                let mut rx_f = File::create(rx_path)?;
                let mut tx_f = File::create(tx_path)?;
                let header = "timestamp,direction,channel_id,bytes_hex,bytes_text\n";
                rx_f.write_all(header.as_bytes())?;
                tx_f.write_all(header.as_bytes())?;
                self.rx_file = Some(rx_f);
                self.tx_file = Some(tx_f);
            }
            LogFormat::Hex => {
                let rx_path = self.output_dir.join(format!("{prefix}_rx.hex"));
                let tx_path = self.output_dir.join(format!("{prefix}_tx.hex"));
                self.rx_file = Some(File::create(rx_path)?);
                self.tx_file = Some(File::create(tx_path)?);
            }
            LogFormat::Text => {
                let rx_path = self.output_dir.join(format!("{prefix}_rx.txt"));
                let tx_path = self.output_dir.join(format!("{prefix}_tx.txt"));
                self.rx_file = Some(File::create(rx_path)?);
                self.tx_file = Some(File::create(tx_path)?);
            }
        }

        self.running = true;
        Ok(())
    }

    /// 是否正在录制
    pub fn is_running(&self) -> bool {
        self.running
    }

    /// 录制输出目录（start 后即存在）
    pub fn output_dir(&self) -> &PathBuf {
        &self.output_dir
    }

    /// 录制格式
    pub fn format(&self) -> LogFormat {
        self.format
    }

    /// 所属通道
    pub fn channel_id(&self) -> &str {
        &self.channel_id
    }

    /// 记录接收数据
    pub fn log_rx(&mut self, data: &[u8], timestamp: &str) {
        if !self.running {
            return;
        }
        if let Some(ref mut file) = self.rx_file {
            Self::write_data(&self.format, &self.channel_id, file, data, timestamp, "rx");
        }
    }

    /// 记录发送数据
    pub fn log_tx(&mut self, data: &[u8], timestamp: &str) {
        if !self.running {
            return;
        }
        if let Some(ref mut file) = self.tx_file {
            Self::write_data(&self.format, &self.channel_id, file, data, timestamp, "tx");
        }
    }

    /// 停止录制，关闭文件
    pub fn stop(&mut self) {
        self.rx_file = None;
        self.tx_file = None;
        self.running = false;
    }

    fn write_data(
        format: &LogFormat,
        channel_id: &str,
        file: &mut File,
        data: &[u8],
        timestamp: &str,
        direction: &str,
    ) {
        match format {
            LogFormat::Bin => {
                let _ = file.write_all(data);
            }
            LogFormat::Csv => {
                let hex_str: String = data.iter().map(|b| format!("{b:02x}")).collect();
                let text_str: String = data
                    .iter()
                    .map(|&b| {
                        if b.is_ascii_graphic() || b == b' ' {
                            b as char
                        } else {
                            '.'
                        }
                    })
                    .collect();
                let line = format!("{timestamp},{direction},{channel_id},{hex_str},{text_str}\n");
                let _ = file.write_all(line.as_bytes());
            }
            LogFormat::Hex => {
                // 每行 16 字节，带偏移地址
                for (chunk_idx, chunk) in data.chunks(16).enumerate() {
                    let offset = chunk_idx * 16;
                    let hex_part: String = chunk
                        .iter()
                        .enumerate()
                        .map(|(i, b)| {
                            if i == 8 {
                                format!("  {b:02X}")
                            } else {
                                format!("{b:02X}")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    let ascii_part: String = chunk
                        .iter()
                        .map(|&b| {
                            if b.is_ascii_graphic() || b == b' ' {
                                b as char
                            } else {
                                '.'
                            }
                        })
                        .collect();
                    let line = format!(
                        "{:08X}  {:<pad_width$}  |{ascii_part}|\n",
                        offset,
                        hex_part,
                        pad_width = 48
                    );
                    let _ = file.write_all(line.as_bytes());
                }
            }
            LogFormat::Text => {
                // 每帧按 UTF-8（容错）解码为一行；无效字节以 U+FFFD 占位
                let text = String::from_utf8_lossy(data);
                let _ = file.write_all(text.as_bytes());
                let _ = file.write_all(b"\n");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_logger_new() {
        let logger = DataLogger::new(LogFormat::Bin, PathBuf::from("/tmp/test"), "com3".into());
        assert_eq!(logger.format, LogFormat::Bin);
        assert!(!logger.running);
    }

    #[test]
    fn test_logger_start_stop_bin() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Bin, dir.path().to_path_buf(), "com3".into());
        logger.start().unwrap();
        assert!(logger.running);
        logger.stop();
        assert!(!logger.running);

        // 应该生成了 rx 和 tx 文件
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_logger_start_stop_csv() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Csv, dir.path().to_path_buf(), "com3".into());
        logger.start().unwrap();
        logger.log_rx(b"hello", "2026-07-31 12:00:00");
        logger.log_tx(b"world", "2026-07-31 12:00:01");
        logger.stop();

        // 读取 rx csv 内容
        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        let mut rx_content = String::new();
        let mut tx_content = String::new();
        for entry in entries {
            let path = entry.unwrap().path();
            let content = fs::read_to_string(&path).unwrap();
            if path.to_string_lossy().contains("_rx.csv") {
                rx_content = content;
            } else if path.to_string_lossy().contains("_tx.csv") {
                tx_content = content;
            }
        }
        assert!(rx_content.contains("timestamp,direction,channel_id,bytes_hex,bytes_text"));
        assert!(rx_content.contains("2026-07-31 12:00:00,rx,com3,68656c6c6f,hello"));
        assert!(tx_content.contains("2026-07-31 12:00:01,tx,com3,776f726c64,world"));
    }

    #[test]
    fn test_logger_hex_format() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Hex, dir.path().to_path_buf(), "com3".into());
        logger.start().unwrap();
        let data: Vec<u8> = (0..=255).collect();
        logger.log_rx(&data, "2026-07-31 12:00:00");
        logger.stop();

        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        for entry in entries {
            let path = entry.unwrap().path();
            if path.to_string_lossy().contains("_rx.hex") {
                let content = fs::read_to_string(&path).unwrap();
                let lines: Vec<&str> = content.lines().collect();
                // 256 bytes / 16 = 16 lines
                assert_eq!(lines.len(), 16);
                assert!(lines[0].contains("00000000"));
                assert!(lines[0].contains("01 02 03"));
            }
        }
    }

    #[test]
    fn test_logger_text_format() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Text, dir.path().to_path_buf(), "com3".into());
        logger.start().unwrap();
        logger.log_rx("hello 你好".as_bytes(), "ts");
        logger.log_rx(&[0xff, b'A'], "ts"); // 无效 UTF-8 → U+FFFD 占位
        logger.log_tx("world".as_bytes(), "ts");
        logger.stop();

        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        let mut rx_content = String::new();
        let mut tx_content = String::new();
        for entry in entries {
            let path = entry.unwrap().path();
            let content = fs::read_to_string(&path).unwrap();
            let name = path.to_string_lossy();
            if name.ends_with("_rx.txt") {
                rx_content = content;
            } else if name.ends_with("_tx.txt") {
                tx_content = content;
            }
        }
        assert_eq!(rx_content, "hello 你好\n\u{FFFD}A\n");
        assert_eq!(tx_content, "world\n");
    }

    #[test]
    fn test_logger_log_before_start_is_noop() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Bin, dir.path().to_path_buf(), "com3".into());
        // 不 start 直接 log，不会 panic
        logger.log_rx(b"test", "ts");
        logger.log_tx(b"test", "ts");
        logger.stop();
    }

    #[test]
    fn test_logger_start_idempotent() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(LogFormat::Bin, dir.path().to_path_buf(), "com3".into());
        logger.start().unwrap();
        logger.start().unwrap(); // 第二次应该安全返回 Ok
        logger.stop();
    }

    #[test]
    fn test_logger_channel_name_sanitized() {
        let dir = tempdir().unwrap();
        let mut logger = DataLogger::new(
            LogFormat::Bin,
            dir.path().to_path_buf(),
            "tcp:1.2.3.4:5000".into(),
        );
        logger.start().unwrap();
        logger.stop();

        let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        for entry in entries {
            let name = entry.unwrap().file_name().to_string_lossy().to_string();
            assert!(!name.contains(':'), "文件名不应含冒号: {name}");
            assert!(name.starts_with("tcp-1.2.3.4-5000_"));
        }
    }
}
