/** Manifest 解析与校验 + 默认值补齐 */

import yaml from 'js-yaml'
import {
  PROTOCOL_API_VERSION,
  type DashboardControl,
  type GroupDef,
  type PresetDef,
  type ProtocolManifest,
  type ProtocolRole,
  type QueryBindingDef,
} from './types'

const ID_RE = /^[a-z0-9_-]+$/
const ROLES = new Set(['passive', 'master', 'slave'])
const CONTROL_TYPES = new Set([
  'value',
  'button',
  'table',
  'chart',
  'text',
  'register_grid',
  'info_panel',
  'progress',
])
const PARAM_TYPES = new Set([
  'number',
  'text',
  'bool',
  'select',
  'table',
  'multiline',
  'password',
  'file',
])

export class ManifestError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ManifestError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/** 解析 YAML/JSON 文本为 Manifest，校验关键字段并补齐默认值 */
export function parseManifest(raw: string): ProtocolManifest {
  let data: unknown
  try {
    const trimmed = raw.trim()
    data = trimmed.startsWith('{') ? JSON.parse(trimmed) : yaml.load(trimmed)
  } catch (e) {
    throw new ManifestError(`manifest 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isRecord(data)) throw new ManifestError('manifest 必须为对象')

  const id = asStr(data.id, '')
  if (!ID_RE.test(id)) throw new ManifestError(`id 非法（须为 ${ID_RE}）: "${id}"`)

  const role = asStr(data.role, 'passive')
  if (!ROLES.has(role)) throw new ManifestError(`role 非法: ${role}`)
  const apiVersion =
    typeof data.apiVersion === 'number' ? data.apiVersion : Number(data.apiVersion ?? 0)
  if (Number.isNaN(apiVersion) || apiVersion > PROTOCOL_API_VERSION) {
    throw new ManifestError(`apiVersion ${apiVersion} 超出运行时支持(${PROTOCOL_API_VERSION})`)
  }

  const entry = asStr(data.entry, 'main.js')

  const channelTypes = Array.isArray(data.channelTypes)
    ? data.channelTypes.filter((x): x is string => typeof x === 'string')
    : ['serial', 'tcp_client']
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.filter((x): x is string => typeof x === 'string')
    : ['send']

  const ui = isRecord(data.ui) ? data.ui : {}
  const uiParams = normalizeParams(ui.params)
  const variables = normalizeVariables(ui.variables)
  const actions = normalizeActions(ui.actions)
  const presets = normalizePresets(ui.presets)
  const groups = normalizeGroups(ui.groups)
  const dashboard = normalizeDashboard(ui.dashboard)
  const queries = normalizeQueries(ui.queries)

  return {
    id,
    name: asStr(data.name, id),
    description: typeof data.description === 'string' ? data.description : undefined,
    version: asStr(data.version, '0.0.0'),
    apiVersion: apiVersion || PROTOCOL_API_VERSION,
    role: role as ProtocolRole,
    entry,
    channelTypes,
    capabilities,
    ui: {
      params: uiParams,
      variables,
      actions,
      presets,
      groups,
      dashboard,
      queries,
    },
  }
}

function normalizeParams(raw: unknown): ProtocolManifest['ui']['params'] {
  if (!Array.isArray(raw)) return []
  const out: NonNullable<ProtocolManifest['ui']['params']> = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.key !== 'string' || !item.key) continue
    const type = asStr(item.type, 'text')
    if (!PARAM_TYPES.has(type)) continue
    const p: NonNullable<ProtocolManifest['ui']['params']>[number] = {
      key: item.key,
      label: asStr(item.label, item.key),
      type: type as NonNullable<ProtocolManifest['ui']['params']>[number]['type'],
    }
    if (typeof item.group === 'string' && item.group) p.group = item.group
    if ('default' in item) p.default = item.default
    if (typeof item.min === 'number') p.min = item.min
    if (typeof item.max === 'number') p.max = item.max
    if (typeof item.step === 'number') p.step = item.step
    if (Array.isArray(item.options)) {
      p.options = item.options.filter(isRecord).map(o => ({
        value: asStr(o.value, ''),
        label: asStr(o.label, asStr(o.value, '')),
      }))
    }
    if (Array.isArray(item.columns)) {
      p.columns = item.columns.filter(isRecord).map(c => ({
        key: asStr(c.key, ''),
        label: asStr(c.label, asStr(c.key, '')),
        type: typeof c.type === 'string' && PARAM_TYPES.has(c.type) ? (c.type as never) : undefined,
        default: 'default' in c ? c.default : undefined,
      }))
    }
    if (typeof item.placeholder === 'string') p.placeholder = item.placeholder
    if (typeof item.accept === 'string') p.accept = item.accept
    out.push(p)
  }
  return out
}

function normalizeVariables(raw: unknown): ProtocolManifest['ui']['variables'] {
  if (!Array.isArray(raw)) return []
  const out: NonNullable<ProtocolManifest['ui']['variables']> = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.key !== 'string' || !item.key) continue
    out.push({
      key: item.key,
      label: asStr(item.label, item.key),
      unit: typeof item.unit === 'string' ? item.unit : undefined,
      decimals: typeof item.decimals === 'number' ? item.decimals : undefined,
    })
  }
  return out
}

function normalizeActions(raw: unknown): ProtocolManifest['ui']['actions'] {
  if (!Array.isArray(raw)) return []
  const out: NonNullable<ProtocolManifest['ui']['actions']> = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue
    out.push({
      id: item.id,
      label: asStr(item.label, item.id),
      params: normalizeParams(item.params),
    })
  }
  return out
}

function normalizePresets(raw: unknown): PresetDef[] {
  if (!Array.isArray(raw)) return []
  const out: PresetDef[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    const p: PresetDef = {
      id: item.id,
      label: asStr(item.label, item.id),
    }
    if (isRecord(item.params)) {
      p.params = {}
      for (const [k, v] of Object.entries(item.params)) {
        if (k) p.params[k] = v
      }
    }
    out.push(p)
  }
  return out
}

function normalizeGroups(raw: unknown): GroupDef[] {
  if (!Array.isArray(raw)) return []
  const out: GroupDef[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    const g: GroupDef = {
      id: item.id,
      label: asStr(item.label, item.id),
    }
    if (Array.isArray(item.buttons)) {
      g.buttons = []
      for (const b of item.buttons) {
        if (!isRecord(b) || typeof b.id !== 'string' || !b.id) continue
        const btn: NonNullable<GroupDef['buttons']>[number] = {
          id: b.id,
          label: asStr(b.label, b.id),
        }
        if (b.kind === 'read' || b.kind === 'write') btn.kind = b.kind
        if (typeof b.action === 'string' && b.action) btn.action = b.action
        if (isRecord(b.args)) {
          btn.args = {}
          for (const [k, v] of Object.entries(b.args)) {
            if (typeof v === 'string') btn.args[k] = v
          }
        }
        g.buttons.push(btn)
      }
    }
    out.push(g)
  }
  return out
}

function normalizeDashboard(raw: unknown): DashboardControl[] {
  if (!Array.isArray(raw)) return []
  const out: DashboardControl[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const type = asStr(item.type, '')
    if (!CONTROL_TYPES.has(type)) continue
    const c: DashboardControl = {
      id: asStr(item.id, `ctl-${out.length}`),
      type: type as DashboardControl['type'],
      row: typeof item.row === 'number' ? item.row : 0,
      col: typeof item.col === 'number' ? item.col : 0,
      w: typeof item.w === 'number' ? item.w : 4,
      h: typeof item.h === 'number' ? item.h : 3,
    }
    if (typeof item.title === 'string') c.title = item.title
    if (typeof item.group === 'string' && item.group) c.group = item.group
    if (Array.isArray(item.valueIds)) c.valueIds = item.valueIds.filter((x): x is string => typeof x === 'string')
    if (typeof item.maxPoints === 'number') c.maxPoints = item.maxPoints
    if (typeof item.actionId === 'string') c.actionId = item.actionId
    if (isRecord(item.actionParams)) c.actionParams = item.actionParams
    if (typeof item.text === 'string') c.text = item.text
    if (isRecord(item.grid)) c.grid = normalizeGrid(item.grid)
    if (Array.isArray(item.keys)) c.keys = item.keys.filter((x): x is string => typeof x === 'string')
    if (typeof item.progressId === 'string' && item.progressId) c.progressId = item.progressId
    out.push(c)
  }
  return out
}

function normalizeGrid(raw: Record<string, unknown>): NonNullable<DashboardControl['grid']> {
  const grid: NonNullable<DashboardControl['grid']> = {
    label: asStr(raw.label, '寄存器'),
  }
  if (typeof raw.paramKey === 'string' && raw.paramKey) grid.paramKey = raw.paramKey
  if (typeof raw.valuePattern === 'string' && raw.valuePattern) grid.valuePattern = raw.valuePattern
  if (typeof raw.writeAction === 'string' && raw.writeAction) grid.writeAction = raw.writeAction
  if (isRecord(raw.writeArgs)) {
    grid.writeArgs = {}
    for (const [k, v] of Object.entries(raw.writeArgs)) {
      if (typeof v === 'string') grid.writeArgs[k] = v
    }
  }
  if (typeof raw.editable === 'boolean') grid.editable = raw.editable
  if (Array.isArray(raw.columns)) {
    grid.columns = raw.columns
      .filter(isRecord)
      .map(c => ({
        key: asStr(c.key, ''),
        label: asStr(c.label, asStr(c.key, '')),
      }))
      .filter(c => c.key)
  }
  return grid
}

const QUERY_FORMATS = new Set(['text', 'hex', 'hex_size', 'bool_cn'])

function normalizeQueries(raw: unknown): QueryBindingDef[] {
  if (!Array.isArray(raw)) return []
  const out: QueryBindingDef[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const action = asStr(item.action, '')
    if (!action) continue
    const def: QueryBindingDef = { action }
    if (Array.isArray(item.info)) {
      def.info = []
      for (const row of item.info) {
        if (!isRecord(row)) continue
        const from = asStr(row.from, '')
        const key = asStr(row.key, '')
        if (!from || !key) continue
        const format = asStr(row.format, 'text')
        const info: NonNullable<QueryBindingDef['info']>[number] = { from, key }
        if (typeof row.label === 'string') info.label = row.label
        if (QUERY_FORMATS.has(format) && format !== 'text') {
          info.format = format as NonNullable<typeof info.format>
        }
        if (row.level === 'info' || row.level === 'warn' || row.level === 'error') {
          info.level = row.level
        }
        def.info.push(info)
      }
    }
    if (isRecord(item.setParam)) {
      def.setParam = {}
      for (const [paramKey, bind] of Object.entries(item.setParam)) {
        if (!isRecord(bind)) continue
        const from = asStr(bind.from, '')
        if (!from) continue
        const format = asStr(bind.format, 'text')
        const sp: NonNullable<QueryBindingDef['setParam']>[string] = { from }
        if (QUERY_FORMATS.has(format) && format !== 'text') {
          sp.format = format as NonNullable<typeof sp.format>
        }
        def.setParam[paramKey] = sp
      }
    }
    out.push(def)
  }
  return out
}

/** 依据 manifest 的 ui.params 生成默认参数值 */
export function defaultParams(manifest: ProtocolManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of manifest.ui.params || []) {
    if ('default' in p) {
      out[p.key] = p.default
    } else if (p.type === 'table' && p.columns) {
      out[p.key] = []
    } else if (p.type === 'bool') {
      out[p.key] = false
    } else if (p.type === 'file') {
      out[p.key] = { name: '', size: 0, token: '' }
    } else if (p.type === 'number') {
      out[p.key] = 0
    } else {
      out[p.key] = ''
    }
  }
  return out
}
