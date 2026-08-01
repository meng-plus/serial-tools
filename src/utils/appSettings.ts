/** 全局设置 localStorage 读写 */

export interface AppSettings {
  encoding: 'utf-8' | 'gbk' | 'hex'
  maxLines: number
  defaultSuffix: string
  defaultBaudRate: number
  serialByteTimeoutMs: number
  serialFrameTimeoutMs: number
}

const KEY = 'serial-tools-settings'
const CHANNEL_TIMEOUT_KEY = 'serial-tools-channel-timeouts'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  encoding: 'utf-8',
  maxLines: 10000,
  defaultSuffix: 'none',
  defaultBaudRate: 115200,
  serialByteTimeoutMs: 50,
  serialFrameTimeoutMs: 200,
}

export function loadAppSettings(): AppSettings {
  const out = { ...DEFAULT_APP_SETTINGS }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return out
    const parsed = JSON.parse(raw)
    Object.assign(out, parsed)
    if ((out.encoding as string) === 'gb2312') out.encoding = 'gbk'
  } catch { /* ignore */ }
  return out
}

export function saveAppSettings(settings: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings))
}

export function loadChannelTimeouts(): Record<string, { byte: number; frame: number }> {
  try {
    const raw = localStorage.getItem(CHANNEL_TIMEOUT_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function saveChannelTimeout(channelId: string, byte: number, frame: number) {
  const map = loadChannelTimeouts()
  map[channelId] = { byte, frame }
  localStorage.setItem(CHANNEL_TIMEOUT_KEY, JSON.stringify(map))
}
