/** Workspace 整包 schema（不绑定易变 channelId） */

import type { ProtocolRule, ViewType } from '@/protocol/types'

export const WORKSPACE_VERSION = 2

export interface ViewTemplate {
  type: ViewType
  title?: string
  config?: Record<string, unknown>
}

/** 定时发送条目：各自周期 / 次数；内容原样发送（无自动后缀） */
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
  /** 可选帧配置 id（CRC 等，展开变量之后应用） */
  frameProfileId?: string
}

export interface TxListTemplate {
  id: string
  name: string
  items: TxListItem[]
  /** 列表默认帧配置（条目未指定时） */
  frameProfileId?: string
}

export type ChecksumAlgo =
  | 'none'
  | 'sum8'
  | 'sum16_le'
  | 'sum16_be'
  | 'xor8'
  | 'crc8_07'
  | 'crc8_31'
  | 'crc16_modbus'
  | 'crc16_ccitt_false'
  | 'crc16_xmodem'
  | 'crc16_ibm'


export interface FrameProfile {
  id: string
  name: string
  /** 在末尾追加校验 */
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
