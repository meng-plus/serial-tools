use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::error::CommandError;
use crate::logger::{DataLogger, LogFormat};

/// 一次录制会话的摘要（返回给前端）
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingInfo {
    pub channel_id: String,
    pub format: &'static str,
    pub output_dir: String,
}

/// 录制状态与多通道编排
#[derive(Default)]
pub struct RecordingRegistry {
    loggers: RwLock<HashMap<String, Arc<Mutex<DataLogger>>>>,
}

impl RecordingRegistry {
    /// 启动某通道录制；重复启动返回已有目录（幂等）
    pub fn start(
        &self,
        channel_id: &str,
        format: LogFormat,
        output_dir: PathBuf,
    ) -> Result<RecordingInfo, CommandError> {
        let mut loggers = self
            .loggers
            .write()
            .map_err(|_| CommandError::Internal("录制注册表锁已污染".into()))?;
        if let Some(existing) = loggers.get(channel_id) {
            if let Ok(l) = existing.lock() {
                if l.is_running() {
                    return Ok(RecordingInfo {
                        channel_id: channel_id.to_string(),
                        format: match format {
                            LogFormat::Bin => "bin",
                            LogFormat::Csv => "csv",
                            LogFormat::Hex => "hex",
                            LogFormat::Text => "text",
                        },
                        output_dir: l.output_dir().to_string_lossy().to_string(),
                    });
                }
            }
        }

        let mut logger = DataLogger::new(format, output_dir, channel_id.to_string());
        logger
            .start()
            .map_err(|e| CommandError::Internal(format!("创建录制文件失败：{e}")))?;
        let info = RecordingInfo {
            channel_id: channel_id.to_string(),
            format: match format {
                LogFormat::Bin => "bin",
                LogFormat::Csv => "csv",
                LogFormat::Hex => "hex",
                LogFormat::Text => "text",
            },
            output_dir: logger.output_dir().to_string_lossy().to_string(),
        };
        loggers.insert(channel_id.to_string(), Arc::new(Mutex::new(logger)));
        Ok(info)
    }

    /// 停止录制并返回摘要；未录制时返回错误
    pub fn stop(&self, channel_id: &str) -> Result<RecordingInfo, CommandError> {
        let logger = {
            let mut loggers = self
                .loggers
                .write()
                .map_err(|_| CommandError::Internal("录制注册表锁已污染".into()))?;
            loggers.remove(channel_id)
        };
        match logger {
            Some(handle) => {
                let mut logger = handle
                    .lock()
                    .map_err(|_| CommandError::Internal("录制器锁已污染".into()))?;
                let info = RecordingInfo {
                    channel_id: channel_id.to_string(),
                    format: match logger.format() {
                        LogFormat::Bin => "bin",
                        LogFormat::Csv => "csv",
                        LogFormat::Hex => "hex",
                        LogFormat::Text => "text",
                    },
                    output_dir: logger.output_dir().to_string_lossy().to_string(),
                };
                logger.stop();
                Ok(info)
            }
            None => Err(CommandError::Recording("该通道未在录制".into())),
        }
    }

    /// 记录接收数据（读取线程调用，失败静默）
    pub fn log_rx(&self, channel_id: &str, data: &[u8], timestamp: &str) {
        if let Ok(loggers) = self.loggers.read() {
            if let Some(handle) = loggers.get(channel_id) {
                if let Ok(mut logger) = handle.lock() {
                    logger.log_rx(data, timestamp);
                }
            }
        }
    }

    /// 记录发送数据（命令线程调用，失败静默）
    pub fn log_tx(&self, channel_id: &str, data: &[u8], timestamp: &str) {
        if let Ok(loggers) = self.loggers.read() {
            if let Some(handle) = loggers.get(channel_id) {
                if let Ok(mut logger) = handle.lock() {
                    logger.log_tx(data, timestamp);
                }
            }
        }
    }

    /// 是否正在录制某通道
    pub fn is_recording(&self, channel_id: &str) -> bool {
        if let Ok(loggers) = self.loggers.read() {
            if let Some(handle) = loggers.get(channel_id) {
                if let Ok(l) = handle.lock() {
                    return l.is_running();
                }
            }
        }
        false
    }

    /// 录制中的通道列表
    pub fn list(&self) -> Vec<RecordingInfo> {
        let mut infos = Vec::new();
        if let Ok(loggers) = self.loggers.read() {
            for (id, handle) in loggers.iter() {
                if let Ok(l) = handle.lock() {
                    if l.is_running() {
                        infos.push(RecordingInfo {
                            channel_id: id.clone(),
                            format: match l.format() {
                                LogFormat::Bin => "bin",
                                LogFormat::Csv => "csv",
                                LogFormat::Hex => "hex",
                                LogFormat::Text => "text",
                            },
                            output_dir: l.output_dir().to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
        infos
    }

    /// 通道断开时释放录制器（不丢已写数据）
    pub fn remove(&self, channel_id: &str) {
        if let Ok(mut loggers) = self.loggers.write() {
            if let Some(handle) = loggers.remove(channel_id) {
                if let Ok(mut l) = handle.lock() {
                    l.stop();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_start_stop_roundtrip() {
        let reg = RecordingRegistry::default();
        let dir = PathBuf::from("_test_rec_dir");
        let _ = fs::remove_dir_all(&dir);

        let info = reg
            .start("com3", LogFormat::Csv, dir.clone())
            .expect("start 应成功");
        assert!(info.output_dir.ends_with("_test_rec_dir"));
        assert!(reg.is_recording("com3"));

        // 幂等：重复 start 返回同一目录
        let again = reg
            .start("com3", LogFormat::Csv, dir.clone())
            .expect("重复 start 应成功");
        assert_eq!(again.output_dir, info.output_dir);

        let stopped = reg.stop("com3").expect("stop 应成功");
        assert_eq!(stopped.channel_id, "com3");
        assert!(!reg.is_recording("com3"));

        let err = reg.stop("com3").expect_err("未录制时 stop 应报错");
        assert_eq!(err.code(), crate::error::ErrorCode::Recording);

        // 录制期间写入可落盘
        let info2 = reg.start("com3", LogFormat::Csv, dir.clone()).unwrap();
        reg.log_rx("com3", b"abc", "t1");
        reg.log_tx("com3", b"xyz", "t2");
        let _ = info2;
        reg.stop("com3").unwrap();
        let _ = fs::read_dir(&dir).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_remove_stops_recording() {
        let reg = RecordingRegistry::default();
        let dir = tempfile::tempdir().unwrap();
        reg.start("tcp-1", LogFormat::Bin, dir.path().to_path_buf())
            .unwrap();
        reg.remove("tcp-1");
        assert!(!reg.is_recording("tcp-1"));
    }
}
