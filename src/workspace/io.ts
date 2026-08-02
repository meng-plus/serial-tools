import yaml from 'js-yaml'
import type { ViewInstance } from '@/protocol/types'
import {
  WORKSPACE_VERSION,
  emptyPackage,
  normalizeProtocolInstance,
  normalizeTxList,
  type FrameProfile,
  type ProtocolInstanceTemplate,
  type TxListTemplate,
  type ViewTemplate,
  type WorkspacePackage,
} from './schema'
import type { ProtocolRule } from '@/protocol/types'

export function buildWorkspacePackage(input: {
  rules: ProtocolRule[]
  views?: ViewInstance[]
  txLists?: TxListTemplate[]
  frameProfiles?: FrameProfile[]
  settings?: Record<string, unknown>
  protocolInstances?: ProtocolInstanceTemplate[]
}): WorkspacePackage {
  const viewTemplates: ViewTemplate[] = (input.views || []).map(v => ({
    type: v.type,
    title: v.title,
    config: { ...(v.config || {}) },
  }))
  return {
    version: WORKSPACE_VERSION,
    kind: 'workspace_package',
    savedAt: new Date().toISOString(),
    settings: input.settings,
    rules: input.rules.map(({ channelId: _c, ...r }) => r),
    viewTemplates,
    txLists: (input.txLists || []).map(l => normalizeTxList(l as unknown as Record<string, unknown>)),
    frameProfiles: input.frameProfiles || [],
    protocolInstances: input.protocolInstances || [],
  }
}

export function serializeWorkspace(pkg: WorkspacePackage, format: 'yaml' | 'json' = 'yaml'): string {
  if (format === 'json') return JSON.stringify(pkg, null, 2)
  return yaml.dump(pkg, { lineWidth: 100, noRefs: true })
}

export function parseWorkspace(raw: string): WorkspacePackage {
  const trimmed = raw.trim()
  let data: unknown
  if (trimmed.startsWith('{')) {
    data = JSON.parse(trimmed)
  } else {
    data = yaml.load(trimmed)
  }
  return normalizePackage(data)
}

function normalizePackage(data: unknown): WorkspacePackage {
  if (!data || typeof data !== 'object') {
    throw new Error('无效的工作区文件')
  }
  const obj = data as Record<string, unknown>
  // 兼容旧 rules_session
  if (obj.kind === 'rules_session' || (Array.isArray(obj.rules) && !obj.kind)) {
    const base = emptyPackage()
    base.rules = Array.isArray(obj.rules) ? (obj.rules as ProtocolRule[]) : []
    if (obj.settings && typeof obj.settings === 'object') {
      base.settings = obj.settings as Record<string, unknown>
    }
    return base
  }
  if (obj.kind !== 'workspace_package' && obj.version == null) {
    throw new Error('无法识别的工作区格式')
  }
  const pkg = emptyPackage()
  pkg.version = typeof obj.version === 'number' ? obj.version : WORKSPACE_VERSION
  pkg.savedAt = typeof obj.savedAt === 'string' ? obj.savedAt : pkg.savedAt
  if (obj.settings && typeof obj.settings === 'object') {
    pkg.settings = obj.settings as Record<string, unknown>
  }
  pkg.rules = Array.isArray(obj.rules) ? (obj.rules as ProtocolRule[]) : []
  pkg.viewTemplates = Array.isArray(obj.viewTemplates)
    ? (obj.viewTemplates as ViewTemplate[])
    : []
  pkg.txLists = Array.isArray(obj.txLists)
    ? obj.txLists
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map(normalizeTxList)
    : []
  pkg.frameProfiles = Array.isArray(obj.frameProfiles)
    ? (obj.frameProfiles as FrameProfile[])
    : []
  pkg.protocolInstances = Array.isArray(obj.protocolInstances)
    ? obj.protocolInstances
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map(normalizeProtocolInstance)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeProtocolInstance>> => x !== null)
    : []
  return pkg
}
