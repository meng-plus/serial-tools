/** 协议查询结果（文本/状态）存储辅助 —— 与数值 valueBus 分离 */

export type ProtocolInfoLevel = 'info' | 'warn' | 'error'

export interface ProtocolInfoEntry {
  key: string
  text: string
  label?: string
  level?: ProtocolInfoLevel
  /** 本地时间串，供面板展示 */
  updatedAt: string
}

export interface ProtocolInfoSample {
  key: string
  text: string
  label?: string
  level?: ProtocolInfoLevel
}

function nowStamp(): string {
  return (
    new Date().toLocaleTimeString('zh-CN', { hour12: false }) +
    '.' +
    String(Date.now() % 1000).padStart(3, '0')
  )
}

/** 合并一条 info；同 key 覆盖 text/level/时间，label 未传则保留旧值 */
export function upsertInstanceInfo(
  map: Record<string, ProtocolInfoEntry>,
  sample: ProtocolInfoSample,
): Record<string, ProtocolInfoEntry> {
  const prev = map[sample.key]
  const next: ProtocolInfoEntry = {
    key: sample.key,
    text: String(sample.text ?? ''),
    label: sample.label !== undefined ? sample.label : prev?.label,
    level: sample.level !== undefined ? sample.level : prev?.level ?? 'info',
    updatedAt: nowStamp(),
  }
  return { ...map, [sample.key]: next }
}

/** 按 keys 过滤 info 条目（缺省 keys → 全部，按 key 名字排序） */
export function selectInfoEntries(
  map: Record<string, ProtocolInfoEntry>,
  keys?: string[],
): ProtocolInfoEntry[] {
  if (keys && keys.length > 0) {
    return keys.map(k => map[k]).filter((e): e is ProtocolInfoEntry => !!e)
  }
  return Object.values(map).sort((a, b) => a.key.localeCompare(b.key))
}
