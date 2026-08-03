/** Workspace 整包 schema（不绑定易变 channelId） */

import type { ProtocolRule, ViewType } from '@/protocol/types'
import { CHECKSUM_CATALOG, type ChecksumAlgo } from '@/protocol/checksum'

export type { ChecksumAlgo }

export const WORKSPACE_VERSION = 2

export interface ViewTemplate {
  type: ViewType
  title?: string
  config?: Record<string, unknown>
}

/** 定时发送条目：各自周期 / 次数；校验经变量或条目级追加校验 */
export interface TxListItem {
  id: string
  label?: string
  format: 'text' | 'hex' | 'gbk'
  payload: string
  /** 是否参与「启动全部已启用」 */
  enabled: boolean
  /** 本条周期 ms */
  intervalMs: number
  /** true=无限循环；false=发满 count 次后停 */
  loop: boolean
  /** 非循环时的发送次数 */
  count: number
  /** @deprecated 发送路径已忽略；仅兼容旧 workspace */
  frameProfileId?: string
  /** 追加校验算法（仅 HEX 模式生效） */
  checksum?: ChecksumAlgo
  /** 校验写入端序 */
  checksumEndian?: 'le' | 'be'
  /** 校验覆盖起始字节 */
  coverStart?: number
  /** 校验覆盖结束模式 */
  coverEndMode?: 'to_end' | 'exclude_tail' | 'length'
  /** 校验覆盖结束值（exclude_tail/length 模式） */
  coverEndValue?: number
}

export interface TxListTemplate {
  id: string
  name: string
  items: TxListItem[]
  /** @deprecated 发送路径已忽略；仅兼容旧 workspace */
  frameProfileId?: string
}

/** @deprecated 旧「帧配置」；导入仍可读，UI/发送不再使用 */
export interface FrameProfile {
  id: string
  name: string
  checksum: ChecksumAlgo
  /** 在指定偏移写入递增序号（1 字节），-1 表示不写 */
  seqOffset: number
}

/** 协议实例模板：不绑死 channelId（与规则一致，加载时应用到当前通道） */
export interface ProtocolInstanceTemplate {
  protocolId: string
  enabled: boolean
  params: Record<string, unknown>
}

export interface WorkspacePackage {
  version: number
  kind: 'workspace_package'
  savedAt: string
  settings?: Record<string, unknown>
  rules: ProtocolRule[]
  /** 应用到「当前通道」的视图模板（不含 channelId） */
  viewTemplates: ViewTemplate[]
  txLists: TxListTemplate[]
  frameProfiles: FrameProfile[]
  /** 协议扩展实例（v2 起） */
  protocolInstances: ProtocolInstanceTemplate[]
}

export function emptyPackage(): WorkspacePackage {
  return {
    version: WORKSPACE_VERSION,
    kind: 'workspace_package',
    savedAt: new Date().toISOString(),
    rules: [],
    viewTemplates: [],
    txLists: [],
    frameProfiles: [],
    protocolInstances: [],
  }
}

export function createDefaultTxItem(partial?: Partial<TxListItem>): TxListItem {
  return {
    id: partial?.id || `item-${Date.now()}`,
    label: partial?.label ?? '',
    format: partial?.format ?? 'hex',
    payload: partial?.payload ?? '01 03 00 00 00 0A',
    enabled: partial?.enabled ?? true,
    intervalMs: partial?.intervalMs ?? 1000,
    loop: partial?.loop ?? true,
    count: partial?.count ?? 1,
    frameProfileId: partial?.frameProfileId,
    checksum: partial?.checksum,
    checksumEndian: partial?.checksumEndian,
    coverStart: partial?.coverStart,
    coverEndMode: partial?.coverEndMode,
    coverEndValue: partial?.coverEndValue,
  }
}

/** 规范化条目；兼容旧字段 suffix / 列表级 intervalMs·loop */
/** 规范化协议实例；兼容旧字段与缺失字段 */
export function normalizeProtocolInstance(
  raw: Record<string, unknown>,
): ProtocolInstanceTemplate | null {
  const protocolId = typeof raw.protocolId === 'string' && raw.protocolId ? raw.protocolId : ''
  if (!protocolId) return null
  return {
    protocolId,
    enabled: raw.enabled === true || raw.enabled === 'true',
    params: raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
      ? (raw.params as Record<string, unknown>)
      : {},
  }
}

const CHECKSUM_ALGOS = new Set<string>(CHECKSUM_CATALOG.map(c => c.id))

function parseChecksumAlgo(raw: unknown): ChecksumAlgo | undefined {
  if (typeof raw !== 'string' || !CHECKSUM_ALGOS.has(raw)) return undefined
  return raw as ChecksumAlgo
}

export function normalizeTxItem(
  raw: Record<string, unknown>,
  listDefaults?: { intervalMs?: number; loop?: boolean; frameProfileId?: string },
): TxListItem {
  const format = raw.format === 'text' || raw.format === 'gbk' || raw.format === 'hex'
    ? raw.format
    : 'hex'
  const intervalMs = typeof raw.intervalMs === 'number'
    ? raw.intervalMs
    : (listDefaults?.intervalMs ?? 1000)
  const loop = typeof raw.loop === 'boolean'
    ? raw.loop
    : (listDefaults?.loop ?? true)
  const count = typeof raw.count === 'number' && raw.count >= 1 ? Math.floor(raw.count) : 1
  const checksum = parseChecksumAlgo(raw.checksum)
  const checksumEndian =
    raw.checksumEndian === 'le' || raw.checksumEndian === 'be' ? raw.checksumEndian : undefined
  const coverEndMode =
    raw.coverEndMode === 'to_end' ||
    raw.coverEndMode === 'exclude_tail' ||
    raw.coverEndMode === 'length'
      ? raw.coverEndMode
      : checksum && checksum !== 'none'
        ? 'to_end'
        : undefined
  return {
    id: typeof raw.id === 'string' ? raw.id : `item-${Date.now()}`,
    label: typeof raw.label === 'string' ? raw.label : '',
    format,
    payload: typeof raw.payload === 'string' ? raw.payload : '',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    intervalMs: Math.max(50, intervalMs),
    loop,
    count,
    frameProfileId:
      typeof raw.frameProfileId === 'string'
        ? raw.frameProfileId
        : listDefaults?.frameProfileId,
    checksum,
    checksumEndian,
    coverStart:
      typeof raw.coverStart === 'number'
        ? Math.max(0, Math.floor(raw.coverStart))
        : checksum && checksum !== 'none'
          ? 0
          : undefined,
    coverEndMode,
    coverEndValue:
      typeof raw.coverEndValue === 'number' ? Math.max(0, Math.floor(raw.coverEndValue)) : undefined,
  }
}

export function normalizeTxList(raw: Record<string, unknown>): TxListTemplate {
  const listInterval = typeof raw.intervalMs === 'number' ? raw.intervalMs : undefined
  const listLoop = typeof raw.loop === 'boolean' ? raw.loop : undefined
  const frameProfileId = typeof raw.frameProfileId === 'string' ? raw.frameProfileId : undefined
  const itemsRaw = Array.isArray(raw.items) ? raw.items : []
  const items = itemsRaw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(x => normalizeTxItem(x, { intervalMs: listInterval, loop: listLoop, frameProfileId }))
  return {
    id: typeof raw.id === 'string' ? raw.id : `tx-${Date.now()}`,
    name: typeof raw.name === 'string' ? raw.name : '定时发送',
    items,
    frameProfileId,
  }
}
