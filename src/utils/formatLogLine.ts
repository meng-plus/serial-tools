import type { DisplayConfig, TerminalLine } from '@/stores/terminalStore'

/** 按显示配置格式化一行（导出 / 实时落盘共用） */
export function formatLogLine(
  line: TerminalLine,
  displayText: string,
  cfg: DisplayConfig,
): string {
  const parts: string[] = []
  if (cfg.showTimestamp) parts.push(`[${line.timestamp}]`)
  if (cfg.showDirection) parts.push(line.direction.toUpperCase())
  if (cfg.showChannel) parts.push(line.channelId)
  parts.push(displayText)
  return parts.join(' ')
}
