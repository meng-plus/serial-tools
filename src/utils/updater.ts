/**
 * GitHub 更新检查与外部链接打开（关于页共用）
 *
 * - 版本比较：纯函数，便于单测；网络请求封装为可注入的 fetchLatestRelease。
 * - 打开链接：Tauri 环境走 shell plugin，浏览器环境回退 window.open。
 */

import { isTauri } from '@/api/tauri'
import { invoke } from '@/api'
import { errorMessage } from '@/utils/error'

export const GITHUB_REPO = 'meng-plus/serial-tools'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

/** GitHub Release 字段子集（/releases/latest 响应） */
export interface GitHubRelease {
  tag_name: string
  name: string
  html_url: string
  published_at: string
  body: string | null
}

/** 解析版本号（去 v 前缀、去 prerelease 后缀），取 major/minor/patch */
export function parseVersion(v: string): [number, number, number] {
  const cleaned = v.replace(/^[vV]/, '').trim()
  const parts = cleaned.split('-')[0].split('.')
  return [
    Number(parts[0]) || 0,
    Number(parts[1]) || 0,
    Number(parts[2]) || 0,
  ]
}

/**
 * 比较两个版本号：a > b 返回 1，相等返回 0，a < b 返回 -1
 * 主 / 次 / 补丁逐段比较
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}

/**
 * 拉取 GitHub 最新正式版；网络 / 解析失败抛错。
 * Tauri 环境走后端命令（规避 WebView fetch 的 CORS/UA 环境差异，错误分类更精确）；
 * 浏览器预览回退直接 fetch。
 */
export async function fetchLatestRelease(): Promise<GitHubRelease> {
  if (isTauri()) {
    try {
      return await invoke<GitHubRelease>('check_for_update')
    } catch (e) {
      throw new Error(errorMessage(e))
    }
  }
  const res = await fetch(GITHUB_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('GitHub API 请求频率超限，请稍后重试或前往 GitHub 查看')
    }
    throw new Error(`GitHub API 返回 ${res.status}`)
  }
  return (await res.json()) as GitHubRelease
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  latest: GitHubRelease | null
  error: string | null
}

/**
 * 对比当前版本与 GitHub 最新正式版。
 * 网络 / 解析失败不抛出，而是返回 error 供 UI 提示。
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const latest = await fetchLatestRelease()
    if (compareVersions(latest.tag_name, currentVersion) > 0) {
      return { hasUpdate: true, latest, error: null }
    }
    return { hasUpdate: false, latest: null, error: null }
  } catch (e) {
    return { hasUpdate: false, latest: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 打开外部链接：Tauri 用 shell plugin，浏览器用 window.open */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
