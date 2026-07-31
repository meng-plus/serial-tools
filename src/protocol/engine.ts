import type { FieldExtract, ParsedField, ProtocolRule, RxRecord } from './types'

function parseJsonPath(obj: unknown, path: string): unknown {
  const p = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path
  if (!p) return obj
  const parts = p.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const key of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function toField(extract: FieldExtract, raw: string): ParsedField | null {
  const unit = extract.unit || ''
  if (extract.as === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return {
      name: extract.name,
      value: String(n),
      unit,
      numberValue: n,
      valueId: extract.valueId || extract.name,
    }
  }
  return {
    name: extract.name,
    value: raw,
    unit,
    valueId: extract.valueId || extract.name,
  }
}

/** 对单条 RX 文本应用一条规则；不匹配返回 null（不按 channelId 过滤） */
export function matchRule(rule: ProtocolRule, record: RxRecord): ParsedField[] | null {
  if (!rule.enabled) return null

  const text = record.text || ''
  if (rule.type === 'regex') {
    let re: RegExp
    try {
      re = new RegExp(rule.pattern)
    } catch {
      return null
    }
    const m = text.match(re)
    if (!m) return null
    const fields: ParsedField[] = []
    for (const extract of rule.fields) {
      const g = extract.group ?? 1
      const raw = m[g]
      if (raw == null) continue
      const f = toField(extract, raw)
      if (f) fields.push(f)
    }
    return fields.length > 0 || rule.fields.length === 0 ? fields : null
  }

  if (rule.type === 'json') {
    let obj: unknown
    try {
      obj = JSON.parse(text)
    } catch {
      return null
    }
    const pat = rule.pattern.trim()
    if (pat.startsWith('$')) {
      const gate = parseJsonPath(obj, pat)
      if (gate === undefined || gate === null) return null
    }
    const fields: ParsedField[] = []
    for (const extract of rule.fields) {
      const path = extract.path || extract.name
      const v = parseJsonPath(obj, path)
      if (v === undefined || v === null) continue
      const f = toField(extract, String(v))
      if (f) fields.push(f)
    }
    return fields.length > 0 ? fields : null
  }

  if (rule.type === 'binary') {
    // 二进制由 BinaryFramer 路径处理
    return null
  }

  return null
}

export interface MatchHit {
  rule: ProtocolRule
  fields: ParsedField[]
}

/** 对启用规则全部尝试；通道范围由调用方（当前工作区）决定 */
export function matchAllRules(rules: ProtocolRule[], record: RxRecord): MatchHit[] {
  if (record.direction !== 'rx') return []
  const hits: MatchHit[] = []
  for (const rule of rules) {
    const fields = matchRule(rule, record)
    if (fields) hits.push({ rule, fields })
  }
  return hits
}
