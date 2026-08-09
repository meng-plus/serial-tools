/** 协议实例进度条状态（OTA / 文件传输等） */

export interface ProtocolProgressEntry {
  id: string
  current: number
  total: number
  label?: string
  /** 事务是否结束（成功或失败） */
  done?: boolean
  updatedAt: string
}

export function upsertProgress(
  map: Record<string, ProtocolProgressEntry>,
  sample: { id: string; current: number; total: number; label?: string; done?: boolean },
): Record<string, ProtocolProgressEntry> {
  const total = Math.max(0, Number(sample.total) || 0)
  const current = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, Number(sample.current) || 0))
  return {
    ...map,
    [sample.id]: {
      id: sample.id,
      current,
      total,
      label: sample.label,
      done: sample.done === true,
      updatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    },
  }
}

export function progressPercent(entry: ProtocolProgressEntry): number {
  if (!entry.total || entry.total <= 0) return 0
  return Math.min(100, Math.round((entry.current / entry.total) * 100))
}
