//! GitHub 最新版本检查 — 网络请求在 Rust 后端完成，规避 WebView fetch 的
//! CORS / UA 环境差异，并对 403 限流做分类提示。

use crate::error::CommandError;
use std::time::Duration;

/// GitHub Release 信息（/releases/latest 响应子集，序列化键与前端契约一致）
#[derive(Debug, serde::Serialize)]
pub struct UpdateInfo {
    pub tag_name: String,
    pub name: String,
    pub html_url: String,
    pub published_at: String,
    pub body: Option<String>,
}

const GITHUB_RELEASES_API: &str =
    "https://api.github.com/repos/meng-plus/serial-tools/releases/latest";

/// 将 HTTP 错误分类为可操作的中文提示（纯函数，便于单测）。
///
/// - 403 且限流剩余为 0：明确为频率超限
/// - 其余 403：多为网络代理 / IP 信誉拦截
/// - 404：仓库尚无 release
fn classify_http_error(status: u16, ratelimit_remaining: Option<&str>) -> String {
    match status {
        403 if ratelimit_remaining == Some("0") => {
            "GitHub API 请求频率超限（60 次/小时），请稍后重试或前往 GitHub 查看".to_string()
        }
        403 => "GitHub API 拒绝请求（可能被网络代理或限流拦截），可前往 GitHub 查看".to_string(),
        404 => "GitHub 仓库暂无正式发布版本".to_string(),
        s => format!("GitHub API 返回 {s}，可前往 GitHub 查看"),
    }
}

/// 拉取最新正式版 release 信息
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, CommandError> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build();
    let version = env!("CARGO_PKG_VERSION");

    let result = agent
        .get(GITHUB_RELEASES_API)
        .set("Accept", "application/vnd.github+json")
        .set(
            "User-Agent",
            &format!("serial-tools-update-check/{version}"),
        )
        .call();

    match result {
        Ok(resp) => {
            let value: serde_json::Value = serde_json::from_reader(resp.into_reader())
                .map_err(|e| CommandError::Internal(format!("解析 GitHub 响应失败: {e}")))?;
            let into = |v: &serde_json::Value| v.as_str().unwrap_or_default().to_string();
            let body = value
                .get("body")
                .and_then(|b| b.as_str())
                .map(str::to_string);
            Ok(UpdateInfo {
                tag_name: into(value.get("tag_name").unwrap_or(&serde_json::Value::Null)),
                name: into(value.get("name").unwrap_or(&serde_json::Value::Null)),
                html_url: into(value.get("html_url").unwrap_or(&serde_json::Value::Null)),
                published_at: into(
                    value
                        .get("published_at")
                        .unwrap_or(&serde_json::Value::Null),
                ),
                body,
            })
        }
        Err(ureq::Error::Status(code, resp)) => {
            let remaining = resp.header("X-RateLimit-Remaining").map(str::to_string);
            let _ = resp.into_string();
            Err(CommandError::Internal(classify_http_error(
                code,
                remaining.as_deref(),
            )))
        }
        Err(e) => Err(CommandError::Internal(format!("无法连接 GitHub API: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_rate_limited() {
        assert_eq!(
            classify_http_error(403, Some("0")),
            "GitHub API 请求频率超限（60 次/小时），请稍后重试或前往 GitHub 查看"
        );
    }

    #[test]
    fn classify_forbidden_not_rate_limited() {
        let msg = classify_http_error(403, Some("57"));
        assert!(msg.contains("拒绝请求"));
    }

    #[test]
    fn classify_other_status() {
        assert!(classify_http_error(404, None).contains("暂无正式发布"));
        assert!(classify_http_error(500, None).contains("GitHub API 返回 500"));
    }
}
