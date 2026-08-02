/** 协议扩展系统：类型与 ABI 定义 */

import type { RxRecord } from '@/protocol/types'

/** 当前 ABI 版本（协议包的 apiVersion 必须等于或低于此值） */
export const PROTOCOL_API_VERSION = 1

export type ProtocolRole = 'passive' | 'master' | 'slave'

export type ParamType =
  | 'number'
  | 'text'
  | 'bool'
  | 'select'
  | 'table'
  | 'multiline'
  | 'password'

export interface ParamColumnDef {
  key: string
  label: string
  type?: ParamType
  default?: unknown
}

export interface ParamDef {
  key: string
  label: string
  type: ParamType
  default?: unknown
  min?: number
  max?: number
  step?: number
  /** select 选项 */
  options?: { value: string; label: string }[]
  /** table 列定义 */
  columns?: ParamColumnDef[]
  placeholder?: string
}

export interface VariableDef {
  key: string
  label: string
  unit?: string
  decimals?: number
}

export interface ActionDef {
  id: string
  label: string
  params?: ParamDef[]
}

export type ControlType = 'value' | 'button' | 'table' | 'chart' | 'text'

export interface DashboardControl {
  id: string
  type: ControlType
  row: number
  col: number
  w: number
  h: number
  title?: string
  /** value / chart / table 绑定的变量 key（多个用逗号分隔的 valueIds） */
  valueIds?: string[]
  /** button 触发的动作 id */
  actionId?: string
  actionParams?: Record<string, unknown>
  text?: string
}

export interface ProtocolManifest {
  id: string
  name: string
  description?: string
  version: string
  apiVersion: number
  role: ProtocolRole
  entry: string
  channelTypes: string[]
  capabilities: string[]
  ui: {
    params?: ParamDef[]
    variables?: VariableDef[]
    actions?: ActionDef[]
    dashboard?: DashboardControl[]
  }
}

/** 已安装协议包（内置或用户安装） */
export interface ProtocolPackage {
  manifest: ProtocolManifest
  /** 来源：builtin=随应用打包 / user=数据目录用户安装 */
  source: 'builtin' | 'user'
  /** 用户包的绝对目录；builtin 为空 */
  dir?: string
}

/** 协议实现体（main.js 的 ESM 默认导出） */
export interface ProtocolModule {
  init(ctx: ProtocolContext): void | Promise<void>
  dispose?(): void
  /** 通道收到数据 */
  onRx?(frame: RxRecord): void
  /** 定时驱动（运行时统一每 50ms 调用，协议自判时间间隔） */
  onTick?(now: number): void
  /** 参数变更即时生效 */
  setConfig?(patch: Record<string, unknown>): void | Promise<void>
  /** 从站：报文匹配 */
  match?(frame: RxRecord): boolean
  /** 从站：匹配后处理 / 应答 */
  handle?(frame: RxRecord): void | Promise<void>
  /** 仪表盘按钮动作 */
  runAction?(actionId: string, args: Record<string, unknown>): void | Promise<void>
  getVariables?(): VariableDef[]
}

/** 注入协议实现的上下文 */
export interface ProtocolContext {
  channelId: string
  instanceId: string
  /** 经后端 send_data 发送 hex（无后缀追加） */
  sendHex(hex: string): Promise<{ bytesSent: number; seq: number }>
  /** 推送数值样本 → valueBus（监控 / 图表 / 数据导出） */
  emitVar(sample: { valueId: string; value: number; unit?: string; timestamp?: string }): void
  log(level: 'info' | 'warn' | 'error', msg: string): void
  getParam(key: string): unknown
  /** 定时器：dispose 时自动清理 */
  timer: {
    setTimeout(cb: () => void, ms: number): number
    setInterval(cb: () => void, ms: number): number
    clearTimeout(id: number): void
    clearInterval(id: number): void
  }
  utils: ProtocolUtils
}

/** ctx.utils：封装通用字节 / 校验 / 分帧工具，协议实现可直接使用 */
export interface ProtocolUtils {
  hexToBytes(hex: string): number[]
  bytesToHex(bytes: number[]): string
  /** 无空格小写 */
  bytesToHexCompact(bytes: number[]): string
  /** CRC16-Modbus（小端） */
  crc16Modbus(bytes: number[]): number
  appendChecksum(payload: number[], algo: string, endian?: 'le' | 'be'): number[]
  computeChecksum(algo: string, cover: number[]): number
  verifyFrameChecksum(frame: number[], algo: string, endian?: 'le' | 'be'): boolean
  /** 从帧按 offset + 类型解码数值（复用二进制规则引擎） */
  decodeBinary(
    bytes: number[],
    fields: { name: string; offset: number; type: string; scale?: number; bias?: number; unit?: string }[],
  ): { name: string; value: string; unit: string; numberValue?: number; valueId?: string }[]
  /** 读写整数 / 浮点（le/be） */
  u16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  i16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  u32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  f32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  /** 把数值按类型写入数组（追加模式），返回附加字节 */
  encodeU16(value: number, endian?: 'le' | 'be'): number[]
  encodeU32(value: number, endian?: 'le' | 'be'): number[]
}

/** 运行中的协议实例（绑定某通道） */
export interface ProtocolInstance {
  instanceId: string
  manifest: ProtocolManifest
  channelId: string
  enabled: boolean
  params: Record<string, unknown>
  status: 'idle' | 'running' | 'error'
  error?: string
  variables: VariableDef[]
  startedAt?: string
  lastRxAt?: string
}
