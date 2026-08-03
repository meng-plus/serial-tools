import type { DisplayConfig, TerminalLine } from '@/stores/terminalStore'

/** 格式化收包耗时展示 */
export function formatDurationMs(ms: number | undefined): string {
  if (ms == null || Number.isNaN(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`
}

/** 按显示配置格式化一行（导出 / 实时落盘共用） */
export function formatLogLine(
  line: TerminalLine,
  displayText: string,
  cfg: DisplayConfig,
): string {
  const parts: string[] = []
  if (cfg.showTimestamp) {
    if (cfg.showDuration && line.timestampEnd && line.timestampEnd !== line.timestamp) {
      parts.push(`[${line.timestamp}→${line.timestampEnd}]`)
    } else {
      parts.push(`[${line.timestamp}]`)
    }
  }
  if (cfg.showDuration && line.durationMs != null) {
    parts.push(`(${formatDurationMs(line.durationMs)})`)
  }
  if (cfg.showDirection) parts.push(line.direction.toUpperCase())
  if (cfg.showChannel) parts.push(line.channelId)
  parts.push(displayText)
  return parts.join(' ')
}
