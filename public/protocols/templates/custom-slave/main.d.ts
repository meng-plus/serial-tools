/**
 * 协议 ABI 类型提示（供编辑器使用，不参与运行）
 *
 * 将本文件与 main.js 放在同一目录，编辑器中 import 此文件即可获得补全：
 *   import type { ProtocolModule } from './main.d'
 *   const impl: ProtocolModule = { ... }
 *   export default impl
 */

export interface RxFrame {
  seq?: number
  channelId: string
  timestamp: string
  direction: 'rx' | 'tx'
  hex: string
  text: string
  bytes: number[]
}

export interface ProtocolContext {
  channelId: string
  instanceId: string
  /** 经后端发送 hex（无后缀追加） */
  sendHex(hex: string): Promise<{ bytesSent: number; seq: number }>
  /** 推送数值样本 → 监控 / 图表 / 数据导出 */
  emitVar(sample: { valueId: string; value: number; unit?: string; timestamp?: string }): void
  log(level: 'info' | 'warn' | 'error', msg: string): void
  getParam(key: string): unknown
  timer: {
    setTimeout(cb: () => void, ms: number): number
    setInterval(cb: () => void, ms: number): number
    clearTimeout(id: number): void
    clearInterval(id: number): void
  }
  utils: {
    hexToBytes(hex: string): number[]
    bytesToHex(bytes: number[]): string
    bytesToHexCompact(bytes: number[]): string
    crc16Modbus(bytes: number[]): number
    appendChecksum(payload: number[], algo: string, endian?: 'le' | 'be'): number[]
    computeChecksum(algo: string, cover: number[]): number
    verifyFrameChecksum(frame: number[], algo: string, endian?: 'le' | 'be'): boolean
    decodeBinary(
      bytes: number[],
      fields: { name: string; offset: number; type: string; scale?: number; bias?: number; unit?: string }[],
    ): { name: string; value: string; unit: string; numberValue?: number; valueId?: string }[]
    u16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
    i16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
    u32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
    f32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
    encodeU16(value: number, endian?: 'le' | 'be'): number[]
    encodeU32(value: number, endian?: 'le' | 'be'): number[]
  }
}

export interface VariableDef {
  key: string
  label: string
  unit?: string
  decimals?: number
}

export interface ProtocolModule {
  /** 必选：初始化。在此读取参数、注册定时器、启动轮询。 */
  init(ctx: ProtocolContext): void | Promise<void>
  /** 可选：清理资源（ctx.timer 定时器会自动清理，这里处理额外资源） */
  dispose?(): void
  /** 可选：通道收到数据 */
  onRx?(frame: RxFrame): void
  /** 可选：定时驱动（运行时统一约 50ms 调用，自判时间间隔） */
  onTick?(now: number): void
  /** 可选：参数变更即时生效（例如立即重发一轮） */
  setConfig?(patch: Record<string, unknown>): void | Promise<void>
  /** 可选（role: slave）：报文匹配 */
  match?(frame: RxFrame): boolean
  /** 可选（role: slave）：匹配后处理 / 应答 */
  handle?(frame: RxFrame): void | Promise<void>
  /** 可选：仪表盘按钮触发的动作 */
  runAction?(actionId: string, args: Record<string, unknown>): void | Promise<void>
  /** 可选：动态变量表（供监控 / 图表下拉） */
  getVariables?(): VariableDef[]
}
