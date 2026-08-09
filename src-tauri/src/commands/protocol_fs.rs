//! 协议扩展包文件操作 — 管理 serial-tools-data/protocols/<id>/
//!
//! 只做包的管理与文件读取；协议运行时（校验/加载/生命周期）在前端。
//! Dev：`protocols/<id>/.dev-link` 指向本地源目录，读写走源目录，供热重载。

use crate::commands::fs_util::data_root;
use crate::error::CommandError;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 目录内若存在该文件，则内容为绝对路径，表示 Dev 链接源目录
const DEV_LINK_NAME: &str = ".dev-link";

/// 协议 id 允许字符：小写字母 / 数字 / `-` / `_`
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn protocols_dir() -> PathBuf {
    data_root().join("protocols")
}

fn ensure_protocols_dir() -> Result<(), CommandError> {
    std::fs::create_dir_all(protocols_dir())
        .map_err(|e| CommandError::Internal(format!("创建协议目录失败: {}", e)))
}

/// 归一化 zip 内路径：拒绝穿越 / 绝对路径 / 盘符，返回 `/` 分隔的相对路径
fn sanitize_zip_path(name: &str) -> Result<Option<String>, CommandError> {
    let normalized = name.replace('\\', "/");
    let mut segments: Vec<&str> = Vec::new();
    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err(CommandError::InvalidRequest(format!(
                "扩展包包含非法路径: {}",
                name
            )));
        }
        if seg.contains(':') {
            return Err(CommandError::InvalidRequest(format!(
                "扩展包包含绝对路径: {}",
                name
            )));
        }
        segments.push(seg);
    }
    if segments.is_empty() {
        return Ok(None);
    }
    Ok(Some(segments.join("/")))
}

/// 解析 manifest 关键字段（仅用于校验 / 列出 / 版本比较）
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestMeta {
    id: String,
    name: Option<String>,
    version: Option<String>,
    api_version: Option<u32>,
    role: Option<String>,
    entry: Option<String>,
}

impl ManifestMeta {
    fn parse(bytes: &[u8]) -> Result<Self, CommandError> {
        let s = String::from_utf8_lossy(bytes);
        serde_yaml::from_str(&s)
            .map_err(|e| CommandError::InvalidRequest(format!("manifest.yaml 解析失败: {}", e)))
    }
}

/// 目录中已安装协议的信息（供前端列表展示）
#[derive(Debug, serde::Serialize)]
pub struct ProtocolDirInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    pub role: String,
    /// 是否具备完整 manifest（目录有效）
    pub valid: bool,
    /// 是否为 Dev 文件夹链接（非 zip 安装副本）
    pub is_dev: bool,
    /// Dev 源目录绝对路径；非 Dev 为空
    pub dev_path: Option<String>,
}

fn read_dev_link(install_dir: &Path) -> Option<PathBuf> {
    let link = install_dir.join(DEV_LINK_NAME);
    let s = std::fs::read_to_string(&link).ok()?;
    let p = PathBuf::from(s.trim());
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// 解析实际内容根：Dev 链到源目录，否则为安装目录本身
fn protocol_content_dir(install_dir: &Path) -> PathBuf {
    read_dev_link(install_dir).unwrap_or_else(|| install_dir.to_path_buf())
}

fn read_manifest(dir: &Path) -> Result<ManifestMeta, CommandError> {
    let p = dir.join("manifest.yaml");
    if !p.exists() {
        return Err(CommandError::InvalidRequest(
            "缺少 manifest.yaml".to_string(),
        ));
    }
    let bytes = std::fs::read(&p)
        .map_err(|e| CommandError::Internal(format!("读取 manifest 失败: {}", e)))?;
    ManifestMeta::parse(&bytes)
}

fn info_from_meta(meta: ManifestMeta, is_dev: bool, dev_path: Option<String>) -> ProtocolDirInfo {
    ProtocolDirInfo {
        id: meta.id.clone(),
        name: meta.name.unwrap_or_else(|| meta.id.clone()),
        version: meta.version.unwrap_or_else(|| "0.0.0".to_string()),
        api_version: meta.api_version.unwrap_or(0),
        role: meta.role.unwrap_or_else(|| "passive".to_string()),
        valid: true,
        is_dev,
        dev_path,
    }
}

/// 列出已安装协议（含 Dev 链接）
#[tauri::command]
pub async fn list_protocols() -> Result<Vec<ProtocolDirInfo>, CommandError> {
    let dir = protocols_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| CommandError::Internal(e.to_string()))? {
        let entry = entry.map_err(|e| CommandError::Internal(e.to_string()))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&id) {
            continue;
        }
        let install_dir = entry.path();
        let is_dev = read_dev_link(&install_dir).is_some();
        let content = protocol_content_dir(&install_dir);
        let dev_path = read_dev_link(&install_dir).map(|p| p.display().to_string());
        match read_manifest(&content) {
            Ok(m) => out.push(info_from_meta(m, is_dev, dev_path)),
            Err(_) => out.push(ProtocolDirInfo {
                id: id.clone(),
                name: id.clone(),
                version: String::from("0.0.0"),
                api_version: 0,
                role: String::from("passive"),
                valid: false,
                is_dev,
                dev_path,
            }),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// 读取协议包内文本文件（manifest / main.js 等；Dev 走源目录）
#[tauri::command]
pub async fn read_protocol_file(id: String, rel_path: String) -> Result<String, CommandError> {
    if !valid_id(&id) {
        return Err(CommandError::InvalidRequest("非法的协议 id".to_string()));
    }
    let rel = sanitize_zip_path(&rel_path)?
        .ok_or_else(|| CommandError::InvalidRequest("空路径".to_string()))?;
    let allowed = [
        ".js", ".mjs", ".yaml", ".yml", ".json", ".md", ".txt", ".d.ts",
    ];
    if !allowed.iter().any(|s| rel.ends_with(s)) {
        return Err(CommandError::InvalidRequest(format!(
            "不支持读取该文件类型: {}",
            rel
        )));
    }
    let install_dir = protocols_dir().join(&id);
    if !install_dir.exists() {
        return Err(CommandError::InvalidRequest(format!("协议 {} 未安装", id)));
    }
    let base = protocol_content_dir(&install_dir);
    let p = base.join(&rel);
    let s = std::fs::read_to_string(&p)
        .map_err(|e| CommandError::InvalidRequest(format!("读取 {} 失败: {}", rel, e)))?;
    Ok(s)
}

/// 协议内容树最大修改时间（毫秒，供 Dev 热重载轮询）
#[tauri::command]
pub async fn protocol_content_mtime(id: String) -> Result<u64, CommandError> {
    if !valid_id(&id) {
        return Err(CommandError::InvalidRequest("非法的协议 id".to_string()));
    }
    let install_dir = protocols_dir().join(&id);
    if !install_dir.exists() {
        return Err(CommandError::InvalidRequest(format!("协议 {} 未安装", id)));
    }
    let content = protocol_content_dir(&install_dir);
    Ok(max_content_mtime(&content))
}

fn max_content_mtime(root: &Path) -> u64 {
    let allowed = [
        ".js", ".mjs", ".yaml", ".yml", ".json", ".md", ".txt", ".d.ts",
    ];
    let mut max_ms = 0u64;
    fn walk(dir: &Path, allowed: &[&str], max_ms: &mut u64) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                walk(&path, allowed, max_ms);
                continue;
            }
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == DEV_LINK_NAME || name.starts_with('.') {
                continue;
            }
            if !allowed.iter().any(|s| name.ends_with(s)) {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    let ms = modified
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    if ms > *max_ms {
                        *max_ms = ms;
                    }
                }
            }
        }
    }
    walk(root, &allowed, &mut max_ms);
    max_ms
}

/// 将本地文件夹注册为 Dev 协议（不复制文件，写入 .dev-link）
#[tauri::command]
pub async fn link_protocol_dev(
    path: String,
    force: Option<bool>,
) -> Result<ProtocolDirInfo, CommandError> {
    ensure_protocols_dir()?;
    link_protocol_dev_to(Path::new(&path), &protocols_dir(), force.unwrap_or(false))
}

/// 可测：在 install_root 下创建 Dev 链接
fn link_protocol_dev_to(
    src: &Path,
    install_root: &Path,
    force: bool,
) -> Result<ProtocolDirInfo, CommandError> {
    if !src.is_dir() {
        return Err(CommandError::InvalidRequest(format!(
            "路径不是目录: {}",
            src.display()
        )));
    }
    let src = std::fs::canonicalize(src).map_err(|e| {
        CommandError::InvalidRequest(format!("无法解析目录 {}: {}", src.display(), e))
    })?;
    let meta = read_manifest(&src)?;
    if !valid_id(&meta.id) {
        return Err(CommandError::InvalidRequest(
            "manifest 中 id 非法".to_string(),
        ));
    }
    let entry = meta.entry.clone().unwrap_or_else(|| "main.js".to_string());
    if !src.join(&entry).is_file() {
        return Err(CommandError::InvalidRequest(format!(
            "源目录缺少入口文件: {}",
            entry
        )));
    }

    let target_dir = install_root.join(&meta.id);
    if target_dir.exists() {
        let existing_dev = read_dev_link(&target_dir).is_some();
        // zip 安装包需 force；已有 Dev 链接允许直接改指向
        if !force && !existing_dev {
            return Err(CommandError::InvalidRequest(format!(
                "协议 {} 已通过 zip 安装，Dev 链接需勾选强制覆盖",
                meta.id
            )));
        }
        std::fs::remove_dir_all(&target_dir).map_err(|e| CommandError::Internal(e.to_string()))?;
    }

    std::fs::create_dir_all(&target_dir).map_err(|e| CommandError::Internal(e.to_string()))?;
    let link_path = target_dir.join(DEV_LINK_NAME);
    std::fs::write(&link_path, src.display().to_string())
        .map_err(|e| CommandError::Internal(format!("写入 .dev-link 失败: {}", e)))?;

    Ok(info_from_meta(meta, true, Some(src.display().to_string())))
}

/// 解压 zip（base64 → Vec<u8> 由前端转 number[]），校验并落盘
/// 解压并校验 zip 到指定目录（可测）：安全校验 / 剥顶层目录 / manifest 与入口检查。
/// 返回解析出的 manifest 元数据。
fn extract_zip(zip_bytes: &[u8], tmp_dir: &Path) -> Result<ManifestMeta, CommandError> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| CommandError::InvalidRequest(format!("zip 解析失败: {}", e)))?;

    // 1) 收集全部条目路径并做安全校验
    let mut entries: Vec<(String, bool)> = Vec::new(); // (safe_rel_path, is_dir)
    let mut root_has_manifest = false;
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| CommandError::InvalidRequest(format!("zip 读取失败: {}", e)))?;
        let name = file.name().to_string();
        let is_dir = name.ends_with('/');
        let safe = sanitize_zip_path(&name)?
            .ok_or_else(|| CommandError::InvalidRequest(format!("扩展包包含非法条目: {}", name)))?;
        if safe == "manifest.yaml" {
            root_has_manifest = true;
        }
        entries.push((safe, is_dir));
    }

    // 2) 若根层无 manifest，允许包内含唯一顶层目录（剥掉该前缀）
    let strip_prefix: Option<String> = if !root_has_manifest {
        let firsts: Vec<&str> = entries
            .iter()
            .filter(|(_, d)| !*d)
            .filter_map(|(p, _)| p.split('/').next())
            .collect();
        if firsts.is_empty() {
            None
        } else if firsts.iter().all(|s| *s == firsts[0]) {
            Some(firsts[0].to_string())
        } else {
            return Err(CommandError::InvalidRequest(
                "扩展包结构非法：根层缺少 manifest.yaml".to_string(),
            ));
        }
    } else {
        None
    };

    let resolve = |p: &str| -> String {
        if let Some(prefix) = &strip_prefix {
            p.strip_prefix(&format!("{}/", prefix))
                .unwrap_or(p)
                .to_string()
        } else {
            p.to_string()
        }
    };

    // 3) 读取并校验 manifest
    let mut manifest_bytes: Option<Vec<u8>> = None;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| CommandError::InvalidRequest(e.to_string()))?;
        let name = file.name().to_string();
        if sanitize_zip_path(&name)?.map(|p| resolve(&p)) == Some("manifest.yaml".to_string()) {
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| CommandError::InvalidRequest(e.to_string()))?;
            manifest_bytes = Some(buf);
        }
    }
    let manifest = manifest_bytes
        .ok_or_else(|| CommandError::InvalidRequest("扩展包缺少 manifest.yaml".to_string()))?;
    let meta = ManifestMeta::parse(&manifest)?;
    if !valid_id(&meta.id) {
        return Err(CommandError::InvalidRequest(
            "manifest 中 id 非法".to_string(),
        ));
    }
    let entry = meta.entry.clone().unwrap_or_else(|| "main.js".to_string());

    // 4) 入口文件必须存在
    let entry_exists = entries.iter().any(|(p, d)| !*d && resolve(p) == entry);
    if !entry_exists {
        return Err(CommandError::InvalidRequest(format!(
            "扩展包缺少入口文件: {}",
            entry
        )));
    }

    // 5) 落盘到 tmp_dir
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| CommandError::InvalidRequest(e.to_string()))?;
        let name = file.name().to_string();
        let is_dir = name.ends_with('/');
        let rel = sanitize_zip_path(&name)
            .map_err(|_| CommandError::InvalidRequest(name.clone()))?
            .map(|p| resolve(&p))
            .unwrap_or_default();
        if rel.is_empty() {
            continue;
        }
        let out_path = tmp_dir.join(&rel);
        if is_dir {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| CommandError::Internal(e.to_string()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CommandError::Internal(e.to_string()))?;
        }
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .map_err(|e| CommandError::InvalidRequest(e.to_string()))?;
        std::fs::write(&out_path, &buf).map_err(|e| CommandError::Internal(e.to_string()))?;
    }

    Ok(meta)
}

/// 将扩展包 zip 安装到指定根目录（可测）：校验 / 版本冲突 / 原子替换。
/// install_root 下以协议 id 为子目录存放；staging 名固定为 ".staging"。
fn install_zip_to(
    zip_bytes: &[u8],
    install_root: &Path,
    force: bool,
) -> Result<ProtocolDirInfo, CommandError> {
    let staging = install_root.join(".staging");
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    std::fs::create_dir_all(&staging).map_err(|e| CommandError::Internal(e.to_string()))?;
    let meta = extract_zip(zip_bytes, &staging)?;

    let target_dir = install_root.join(&meta.id);
    let overwrite = force;
    if target_dir.exists() {
        let existing = read_manifest(&target_dir).ok();
        match existing {
            Some(old) => {
                let ok = overwrite
                    || compare_versions(&meta.version_or("0.0.0"), &old.version_or("0.0.0"));
                if !ok {
                    return Err(CommandError::InvalidRequest(format!(
                        "协议 {} 已存在更高或相同版本 ({}),如需覆盖请强制安装",
                        meta.id,
                        old.version_or("0.0.0")
                    )));
                }
            }
            None => {
                if !overwrite {
                    return Err(CommandError::InvalidRequest(format!(
                        "目标目录 {} 存在但缺 manifest,请强制安装",
                        meta.id
                    )));
                }
            }
        }
    }

    // 原子替换
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|e| CommandError::Internal(e.to_string()))?;
    }
    std::fs::rename(&staging, &target_dir).map_err(|e| CommandError::Internal(e.to_string()))?;

    Ok(info_from_meta(meta, false, None))
}

#[tauri::command]
pub async fn install_protocol_zip(
    data: Vec<u8>,
    force: Option<bool>,
) -> Result<ProtocolDirInfo, CommandError> {
    ensure_protocols_dir()?;
    install_zip_to(&data, &protocols_dir(), force.unwrap_or(false))
}

impl ManifestMeta {
    fn version_or(&self, fallback: &str) -> String {
        self.version.clone().unwrap_or_else(|| fallback.to_string())
    }
}

/// 简单的 semver 比较（x.y.z），非严格解析
fn compare_versions(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split(['.', '-'])
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let max = va.len().max(vb.len());
    for i in 0..max {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// 移除已安装协议
#[tauri::command]
pub async fn remove_protocol(id: String) -> Result<bool, CommandError> {
    if !valid_id(&id) {
        return Err(CommandError::InvalidRequest("非法的协议 id".to_string()));
    }
    let target = protocols_dir().join(&id);
    if !target.exists() {
        return Err(CommandError::InvalidRequest(format!("协议 {} 未安装", id)));
    }
    std::fs::remove_dir_all(&target).map_err(|e| CommandError::Internal(e.to_string()))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    const MANIFEST: &str =
        "id: demo\nname: 演示\nversion: 1.0.0\napiVersion: 1\nrole: master\nentry: main.js\n";

    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = SimpleFileOptions::default();
            for (name, content) in entries {
                w.start_file(*name, opts).unwrap();
                w.write_all(content).unwrap();
            }
            w.finish().unwrap();
        }
        buf
    }

    #[test]
    fn id_validation() {
        assert!(valid_id("modbus-rtu-master"));
        assert!(valid_id("a_b1"));
        assert!(!valid_id(""));
        assert!(!valid_id("a/b"));
        assert!(!valid_id("../x"));
        assert!(!valid_id("A B"));
        assert!(!valid_id("café"));
    }

    #[test]
    fn sanitize_rejects_traversal() {
        assert!(sanitize_zip_path("../x").is_err());
        assert!(sanitize_zip_path("a/../../b").is_err());
        assert!(sanitize_zip_path("C:/x").is_err());
        assert!(sanitize_zip_path(r"a\b").unwrap() == Some("a/b".to_string()));
        assert_eq!(
            sanitize_zip_path("manifest.yaml").unwrap(),
            Some("manifest.yaml".to_string())
        );
        assert_eq!(sanitize_zip_path("dir/").unwrap(), Some("dir".to_string()));
    }

    #[test]
    fn version_compare() {
        assert!(compare_versions("1.2.0", "1.1.9"));
        assert!(compare_versions("2.0.0", "1.9.9"));
        assert!(!compare_versions("1.1.0", "1.2.0"));
        assert!(!compare_versions("1.0.0", "1.0.0"));
    }

    #[test]
    fn manifest_meta_parse() {
        let yaml =
            "id: test\nname: 测试\nversion: 1.0.0\napiVersion: 1\nrole: master\nentry: main.js\n";
        let m = ManifestMeta::parse(yaml.as_bytes()).unwrap();
        assert_eq!(m.id, "test");
        assert_eq!(m.api_version, Some(1));
        assert_eq!(m.role.as_deref(), Some("master"));
    }

    #[test]
    fn extract_ok_root_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[
            ("manifest.yaml", MANIFEST.as_bytes()),
            ("main.js", b"export default { init() {} }"),
            ("assets/logo.png", b"png"),
        ]);
        let meta = extract_zip(&zip, tmp.path()).unwrap();
        assert_eq!(meta.id, "demo");
        assert!(tmp.path().join("main.js").exists());
        assert!(tmp.path().join("assets/logo.png").exists());
    }

    #[test]
    fn extract_strips_single_top_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[
            ("demo-v1/manifest.yaml", MANIFEST.as_bytes()),
            ("demo-v1/main.js", b"export default {}"),
        ]);
        extract_zip(&zip, tmp.path()).unwrap();
        assert!(tmp.path().join("manifest.yaml").exists());
        assert!(tmp.path().join("main.js").exists());
    }

    #[test]
    fn extract_rejects_missing_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[("main.js", b"export default {}")]);
        let err = extract_zip(&zip, tmp.path()).unwrap_err();
        assert!(err.message().contains("manifest"));
    }

    #[test]
    fn extract_rejects_missing_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[("manifest.yaml", MANIFEST.as_bytes())]);
        let err = extract_zip(&zip, tmp.path()).unwrap_err();
        assert!(err.message().contains("入口"));
    }

    #[test]
    fn extract_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[
            ("manifest.yaml", MANIFEST.as_bytes()),
            ("../evil.txt", b"x"),
        ]);
        assert!(extract_zip(&zip, tmp.path()).is_err());
        assert!(!tmp.path().parent().unwrap().join("evil.txt").exists());
    }

    #[test]
    fn extract_rejects_invalid_id() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = "id: 'a/b'\nentry: main.js\n";
        let zip = make_zip(&[("manifest.yaml", bad.as_bytes()), ("main.js", b"x")]);
        assert!(extract_zip(&zip, tmp.path()).is_err());
    }

    #[test]
    fn install_ok_and_remove() {
        let tmp = tempfile::tempdir().unwrap();
        let zip = make_zip(&[("manifest.yaml", MANIFEST.as_bytes()), ("main.js", b"x")]);
        let info = install_zip_to(&zip, tmp.path(), false).unwrap();
        assert_eq!(info.id, "demo");
        assert!(tmp.path().join("demo/main.js").exists());
        // 再次安装同版本：无 force 应被拒绝
        let err = install_zip_to(&zip, tmp.path(), false).unwrap_err();
        assert!(err.message().contains("已存在"));
        // force 覆盖成功
        install_zip_to(&zip, tmp.path(), true).unwrap();
    }

    #[test]
    fn install_upgrade_without_force() {
        let tmp = tempfile::tempdir().unwrap();
        let v1 = make_zip(&[("manifest.yaml", MANIFEST.as_bytes()), ("main.js", b"v1")]);
        let v2_manifest =
            "id: demo\nname: 演示\nversion: 1.1.0\napiVersion: 1\nrole: master\nentry: main.js\n";
        let v2 = make_zip(&[
            ("manifest.yaml", v2_manifest.as_bytes()),
            ("main.js", b"v2"),
        ]);
        install_zip_to(&v1, tmp.path(), false).unwrap();
        // 更高版本无需 force
        install_zip_to(&v2, tmp.path(), false).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("demo/main.js")).unwrap(),
            "v2"
        );
    }

    #[test]
    fn install_rejects_downgrade_without_force() {
        let tmp = tempfile::tempdir().unwrap();
        let v2_manifest =
            "id: demo\nname: 演示\nversion: 1.1.0\napiVersion: 1\nrole: master\nentry: main.js\n";
        let v2 = make_zip(&[
            ("manifest.yaml", v2_manifest.as_bytes()),
            ("main.js", b"v2"),
        ]);
        let v1 = make_zip(&[("manifest.yaml", MANIFEST.as_bytes()), ("main.js", b"v1")]);
        install_zip_to(&v2, tmp.path(), false).unwrap();
        assert!(install_zip_to(&v1, tmp.path(), false).is_err());
        // force 降级成功
        install_zip_to(&v1, tmp.path(), true).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("demo/main.js")).unwrap(),
            "v1"
        );
    }

    #[test]
    fn link_dev_reads_from_source() {
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("manifest.yaml"), MANIFEST).unwrap();
        std::fs::write(src.path().join("main.js"), b"export default { init() {} }").unwrap();
        let root = tempfile::tempdir().unwrap();
        let info = link_protocol_dev_to(src.path(), root.path(), false).unwrap();
        assert!(info.is_dev);
        assert_eq!(info.id, "demo");
        let install = root.path().join("demo");
        assert!(install.join(DEV_LINK_NAME).exists());
        assert!(!install.join("main.js").exists());
        let content = protocol_content_dir(&install);
        assert_eq!(
            std::fs::read_to_string(content.join("main.js")).unwrap(),
            "export default { init() {} }"
        );
        let mt = max_content_mtime(&content);
        assert!(mt > 0);
    }

    #[test]
    fn link_dev_rejects_zip_without_force() {
        let root = tempfile::tempdir().unwrap();
        let zip = make_zip(&[("manifest.yaml", MANIFEST.as_bytes()), ("main.js", b"x")]);
        install_zip_to(&zip, root.path(), false).unwrap();
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("manifest.yaml"), MANIFEST).unwrap();
        std::fs::write(src.path().join("main.js"), b"y").unwrap();
        assert!(link_protocol_dev_to(src.path(), root.path(), false).is_err());
        link_protocol_dev_to(src.path(), root.path(), true).unwrap();
        assert!(root.path().join("demo").join(DEV_LINK_NAME).exists());
    }

    /// 真实世界冒烟：加载仓库中的演示扩展包 zip 并安装（验证打包产物可被消费）
    #[test]
    fn install_real_demo_zip() {
        let crate_dir = env!("CARGO_MANIFEST_DIR"); // src-tauri
        let demo_zip = std::path::Path::new(crate_dir)
            .parent()
            .unwrap()
            .join("public/protocols/demo/demo-passive.zip");
        if !demo_zip.exists() {
            eprintln!("跳过: 未找到演示包 {}", demo_zip.display());
            return;
        }
        let bytes = std::fs::read(&demo_zip).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let info = install_zip_to(&bytes, tmp.path(), false).unwrap();
        assert_eq!(info.id, "demo-passive");
        assert_eq!(info.version, "1.0.0");
        assert!(tmp.path().join("demo-passive/manifest.yaml").exists());
        assert!(tmp.path().join("demo-passive/main.js").exists());
    }
}
