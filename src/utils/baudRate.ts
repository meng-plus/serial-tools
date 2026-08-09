/** 常用波特率预设（含高速；更高或非常规值由 UI 手动输入） */
export const BAUD_RATE_PRESETS = [
  9600,
  19200,
  38400,
  57600,
  115200,
  230400,
  460800,
  921600,
  1_000_000,
  1_500_000,
  2_000_000,
] as const

/** 与后端 `u32` 对齐的上限 */
export const BAUD_RATE_MAX = 0xffff_ffff

export function parseBaudRate(input: unknown): number | null {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input <= 0 || input > BAUD_RATE_MAX) return null
    return input
  }
  if (typeof input !== 'string') return null
  const t = input.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  if (!Number.isSafeInteger(n) || n <= 0 || n > BAUD_RATE_MAX) return null
  return n
}

export type BaudRateOption = { value: number; label: string }

/** 预设 + 当前/搜索中的自定义值，升序 */
export function baudRateSelectOptions(...extras: Array<number | null | undefined>): BaudRateOption[] {
  const set = new Set<number>(BAUD_RATE_PRESETS)
  for (const e of extras) {
    if (e != null && e > 0 && e <= BAUD_RATE_MAX) set.add(e)
  }
  return [...set]
    .sort((a, b) => a - b)
    .map((b) => ({ value: b, label: String(b) }))
}
