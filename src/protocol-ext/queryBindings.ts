/** manifest ui.queries：将协议解析结果声明式绑定到 emitInfo / setParam */

export type QueryValueFormat = 'text' | 'hex' | 'hex_size' | 'bool_cn'

export interface QueryInfoBinding {
  from: string
  key: string
  label?: string
  format?: QueryValueFormat
  level?: 'info' | 'warn' | 'error'
}

export interface QuerySetParamBinding {
  from: string
  format?: QueryValueFormat
}

export interface QueryBindingDef {
  action: string
  info?: QueryInfoBinding[]
  setParam?: Record<string, QuerySetParamBinding>
}

/** 点分路径取值：a.b.c */
export function getByPath(data: unknown, path: string): unknown {
  if (!path) return undefined
  let cur: unknown = data
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

export function formatQueryValue(raw: unknown, format: QueryValueFormat = 'text'): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (format === 'hex') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isNaN(n)) return String(raw)
    return '0x' + Math.trunc(n).toString(16)
  }
  if (format === 'hex_size') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isNaN(n)) return String(raw)
    const hex = '0x' + Math.trunc(n).toString(16)
    return `${hex}（${Math.trunc(n)} 字节）`
  }
  if (format === 'bool_cn') {
    return raw ? '支持' : '不支持'
  }
  return String(raw)
}

export interface ApplyQuerySink {
  emitInfo(sample: { key: string; text: string; label?: string; level?: 'info' | 'warn' | 'error' }): void
  setParam(patch: Record<string, unknown>): void
}

/** 按 action 查找绑定并写入 info / 参数；无匹配时 no-op */
export function applyQueryBindings(
  queries: QueryBindingDef[] | undefined,
  actionId: string,
  data: Record<string, unknown>,
  sink: ApplyQuerySink,
): boolean {
  const def = (queries || []).find(q => q.action === actionId)
  if (!def) return false

  for (const row of def.info || []) {
    const raw = getByPath(data, row.from)
    if (raw === undefined || raw === null || raw === '') continue
    const text = formatQueryValue(raw, row.format || 'text')
    if (text === undefined) continue
    let level = row.level
    if (!level && row.format === 'bool_cn') {
      level = raw ? 'info' : 'warn'
    }
    sink.emitInfo({ key: row.key, text, label: row.label, level })
  }

  if (def.setParam) {
    const patch: Record<string, unknown> = {}
    for (const [paramKey, bind] of Object.entries(def.setParam)) {
      const raw = getByPath(data, bind.from)
      if (raw === undefined || raw === null) continue
      const text = formatQueryValue(raw, bind.format || 'text')
      if (text !== undefined) patch[paramKey] = text
    }
    if (Object.keys(patch).length) sink.setParam(patch)
  }
  return true
}
