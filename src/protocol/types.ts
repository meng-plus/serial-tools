/** 协议 / 多视图共享类型 */

export type RuleType = 'regex' | 'json'

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
  pattern: string
  fields: FieldExtract[]
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

export type ViewType = 'terminal' | 'parsed_log' | 'monitor' | 'chart' | 'tx_list' | 'chat'

export interface ViewInstance {
  id: string
  type: ViewType
  channelId: string
  title?: string
  config: Record<string, unknown>
}
