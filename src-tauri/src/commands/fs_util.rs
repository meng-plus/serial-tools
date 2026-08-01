//! 导出与通道实时日志落盘（固定到 serial-tools-data，返回绝对路径）

use std::path::{Path, PathBuf};

fn data_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("serial-tools-data")
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))
}

fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let s = s.trim_matches(|c| c == '-' || c == ' ').to_string();
    if s.is_empty() {
        "export.txt".to_string()
    } else {
        s
    }
}

#[derive(serde::Serialize)]
pub struct DataDirs {
    pub root: String,
    pub exports: String,
    pub channel_logs: String,
    pub sessions: String,
}

#[tauri::command]
pub async fn get_data_dirs() -> Result<DataDirs, String> {
    let root = data_root();
    Ok(DataDirs {
        root: root.display().to_string(),
        exports: root.join("exports").display().to_string(),
        channel_logs: root.join("channel-logs").display().to_string(),
        sessions: root.join("sessions").display().to_string(),
    })
}

/// 写入 exports/ 下文件，返回绝对路径
#[tauri::command]
pub async fn write_export_file(filename: String, content: String) -> Result<String, String> {
    let dir = data_root().join("exports");
    ensure_dir(&dir)?;
    let path = dir.join(sanitize_filename(&filename));
    std::fs::write(&path, content).map_err(|e| format!("写入失败: {}", e))?;
    Ok(path.display().to_string())
}

/// 创建 channel-logs/ 下日志文件（可带初始内容），返回绝对路径
#[tauri::command]
pub async fn create_channel_log_file(
    filename: String,
    header: Option<String>,
) -> Result<String, String> {
    let dir = data_root().join("channel-logs");
    ensure_dir(&dir)?;
    let path = dir.join(sanitize_filename(&filename));
    let body = header.unwrap_or_default();
    std::fs::write(&path, body).map_err(|e| format!("创建日志失败: {}", e))?;
    Ok(path.display().to_string())
}

/// 追加一行到已有日志（自动补换行）
#[tauri::command]
pub async fn append_channel_log(path: String, line: String) -> Result<(), String> {
    use std::io::Write;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("日志文件不存在: {}", path));
    }
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&p)
        .map_err(|e| format!("打开日志失败: {}", e))?;
    let mut out = line;
    if !out.ends_with('\n') {
        out.push('\n');
    }
    f.write_all(out.as_bytes())
        .map_err(|e| format!("追加失败: {}", e))?;
    Ok(())
}

/// 用系统方式打开文件或所在目录（依赖 shell plugin）
#[tauri::command]
pub async fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target = if p.is_file() {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p)
    } else {
        p
    };
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target.as_os_str())
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("当前平台不支持打开目录".to_string())
}
