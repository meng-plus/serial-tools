/** 浏览器/WebView 落盘下载 */

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 本地时间戳：20260801_123045 */
export function formatExportTime(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/** 通道 id 等做文件名安全化 */
export function sanitizeFilePart(s: string, max = 40): string {
  return (s || 'unknown')
    .replace(/[<>:"/\\|?*\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max) || 'unknown'
}

/**
 * 默认导出文件名：{功能}_{通道}_{时间}.{ext}
 * 例：收发日志_COM3_20260801_123045.txt
 */
export function buildExportFilename(opts: {
  feature: string
  channelId?: string
  channelLabel?: string
  ext: string
  when?: Date
}): string {
  const channel = sanitizeFilePart(opts.channelLabel || opts.channelId || 'channel')
  const feature = sanitizeFilePart(opts.feature, 24)
  const ext = opts.ext.replace(/^\./, '')
  return `${feature}_${channel}_${formatExportTime(opts.when)}.${ext}`
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, data: unknown) {
  downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8')
}
