/** 协议 / 多视图共享类型 */

import type { BinaryFrameConfig } from './binaryFramer'
import type { ChecksumAlgo } from './checksum'

export type RuleType = 'regex' | 'json' | 'binary'

export type BinaryNumberType =
  | 'u8'
  | 'i8'
  | 'u16le'
  | 'u16be'
  | 'i16le'
  | 'i16be'
  | 'u32le'
  | 'u32be'
  | 'i32le'
  | 'i32be'
  | 'f32le'
  | 'f32be'

export interface FieldExtract {
  name: string
  /** regex 捕获组序号（1-based）；json 时忽略 */
  group?: number
  /** JSONPath 简化：如 $.temp 或 temp（根级键） */
  path?: string
  as?: 'string' | 'number'
  unit?: string
  valueId?: string
}

/** 二进制字段：offset + 类型 + 线性变换 */
export interface BinaryFieldDef {
  name: string
  offset: number
  type: BinaryNumberType
  scale?: number
  bias?: number
  unit?: string
  valueId?: string
}

export interface ProtocolRule {
  id: string
  name: string
  type: RuleType
  enabled: boolean
  /**
   * 已废弃：规则不绑死通道，仅对「当前工作区通道」的 RX 生效。
   * 保留字段仅为兼容旧会话；匹配时忽略。
   */
  channelId?: string
  /** regex/json 用；binary 时可放 syncHeader 便于展示 */
  pattern: string
  fields: FieldExtract[]
  /** binary 规则分帧配置 */
  frame?: BinaryFrameConfig
  /** binary 字段表 */
  binaryFields?: BinaryFieldDef[]
}

export interface ParsedField {
  name: string
  value: string
  unit: string
  numberValue?: number
  valueId?: string
}

export interface ParsedRecord {
  id: string
  timestamp: string
  channelId: string
  ruleId: string
  ruleName: string
  content: string
  fields: ParsedField[]
  seq?: number
}

export interface RxRecord {
  seq?: number
  channelId: string
  timestamp: string
  direction: 'rx' | 'tx'
  hex: string
  text: string
  bytes: number[]
}

export interface ValueSample {
  channelId: string
  valueId: string
  timestamp: string
  value: number
  unit: string
  ruleId: string
}

export type ViewType = 'terminal' | 'parsed_log' | 'monitor' | 'chart' | 'tx_list' | 'chat' | 'vt100'

export interface ViewInstance {
  id: string
  type: ViewType
  channelId: string
  title?: string
  config: Record<string, unknown>
}

export type { ChecksumAlgo, BinaryFrameConfig }
