/**
 * 协议扩展系统：测试脚手架（仅供 vitest 测试引用，不参与运行时）
 *
 * 目标：让「每个协议包都带配套测试」变成低成本动作——
 * 无需再手写 mock ctx，直接用 makeTestContext / createLoop 即可驱动协议实现。
 *
 * 用法：
 *   import { describe, it, expect } from 'vitest'
 *   import { loadProtocol, makeTestContext, frameBytes, withCrc } from './testing'
 *
 *   const main = await loadProtocol<ModbusMaster>('../../public/protocols/builtin/modbus-rtu-master/main.js')
 *   const h = makeTestContext({ params: { poll: [...], cycle_ms: 500 } })
 *   main.init(h.ctx)
 */

import { buildProtocolUtils } from './utils'
import { getCachedFile } from './fileCache'
import { applyQueryBindings } from './queryBindings'
import type { ProtocolContext, ProtocolUtils, QueryBindingDef } from './types'

/** 采样：协议经 emitVar 推送的数值 */
export interface VarSample {
  valueId: string
  value: number
  unit?: string
}

/** 保存文件：协议经 saveFile 落盘的记录 */
export interface SavedFile {
  name: string
  bytes: number[]
}

/** makeTestContext 的可选配置 */
export interface TestCtxOptions {
  /** 协议参数表（getParam 读取源）；可按测试覆盖缺省默认值 */
  params?: Record<string, unknown>
  channelId?: string
  instanceId?: string
  /** manifest.ui.queries，供 ctx.applyQuery */
  queries?: QueryBindingDef[]
}

/** makeTestContext 返回值：mock ctx 与各收集器 */
export interface TestHarness {
  ctx: ProtocolContext
  params: Record<string, unknown>
  /** sendHex 的原始 hex 字符串记录（按发送顺序） */
  sentHex: string[]
  /** sendHex 解析后的字节数组记录（与 sentHex 一一对应） */
  sentBytes: number[][]
  /** emitVar 采样记录 */
  emitted: VarSample[]
  /** emitInfo 文本/状态 */
  infos: { key: string; text: string; label?: string; level?: string }[]
  /** emitProgress 进度 */
  progresses: { id: string; current: number; total: number; label?: string; done?: boolean }[]
  /** setParam 调用记录 */
  paramPatches: Record<string, unknown>[]
  /** log 记录（'level: msg' 拼接，便于 include 断言） */
  logs: string[]
  /** saveFile 记录 */
  saved: SavedFile[]
  /** 已注册的定时器 id（setInterval / setTimeout） */
  timerIds: number[]
}

/** 便捷：hex 字符串 → 字节数组（断言用） */
export function frameBytes(hex: string): number[] {
  return buildProtocolUtils().hexToBytes(hex)
}

/** 便捷：为报文 body 追加 CRC16-Modbus 小端字节（构造合法帧） */
export function withCrc(body: number[]): number[] {
  const utils = buildProtocolUtils()
  const crc = utils.crc16Modbus(body)
  return [...body, crc & 0xff, (crc >> 8) & 0xff]
}

/** 动态加载协议包 main.js，返回默认导出（协议实现体） */
export async function loadProtocol<T>(pkgPath: string): Promise<T> {
  return (await import(pkgPath)).default as T
}

/** 动态加载协议包 main.js，返回整个模块对象（含命名的辅助函数导出） */
export async function importProtocolModule<T>(pkgPath: string): Promise<T> {
  return (await import(pkgPath)) as T
}

/**
 * 构建一个可直接注入协议实现体的 mock ProtocolContext。
 * 内部已接好 buildProtocolUtils()；getFile 走真实 fileCache（cacheFileBytes 预置即可）。
 */
export function makeTestContext(opts: TestCtxOptions = {}): TestHarness {
  const params: Record<string, unknown> = { ...opts.params }
  const sentHex: string[] = []
  const sentBytes: number[][] = []
  const emitted: VarSample[] = []
  const infos: { key: string; text: string; label?: string; level?: string }[] = []
  const progresses: { id: string; current: number; total: number; label?: string; done?: boolean }[] = []
  const paramPatches: Record<string, unknown>[] = []
  const logs: string[] = []
  const saved: SavedFile[] = []
  const timerIds: number[] = []
  let seq = 0

  const ctx = {
    channelId: opts.channelId ?? 'serial-test',
    instanceId: opts.instanceId ?? 'pi-test',
    sendHex: async (hex: string) => {
      sentHex.push(hex)
      const bytes = buildProtocolUtils().hexToBytes(hex)
      sentBytes.push(bytes)
      seq += 1
      return { bytesSent: bytes.length, seq }
    },
    emitVar: (s: VarSample) => emitted.push(s),
    emitInfo: (s: { key: string; text: string; label?: string; level?: string }) => infos.push(s),
    emitProgress: (s: { id: string; current: number; total: number; label?: string; done?: boolean }) =>
      progresses.push(s),
    applyQuery: (actionId: string, data: Record<string, unknown>) =>
      applyQueryBindings(opts.queries, actionId, data, {
        emitInfo: s => infos.push(s),
        setParam: p => {
          paramPatches.push(p)
          Object.assign(params, p)
        },
      }),
    request: async () => {
      throw new Error('makeTestContext.request 未接虚拟总线；请用 runProtocolRequest 单测或 createLoop')
    },
    setParam: (p: Record<string, unknown>) => {
      paramPatches.push(p)
      Object.assign(params, p)
    },
    log: (level: string, msg: string) => logs.push(`${level}: ${msg}`),
    getParam: (key: string) => params[key],
    getFile: (key: string) => {
      const v = params[key] as { token?: string } | undefined
      if (!v?.token) return null
      return getCachedFile(v.token)
    },
    saveFile: async (name: string, bytes: number[]) => {
      saved.push({ name, bytes })
      return `exports/${name}`
    },
    timer: {
      setTimeout: (_cb: () => void) => {
        const id = ++seq
        timerIds.push(id)
        return id
      },
      setInterval: (_cb: () => void) => {
        const id = ++seq
        timerIds.push(id)
        return id
      },
      clearTimeout: () => {},
      clearInterval: () => {},
    },
    utils: buildProtocolUtils(),
  } as unknown as ProtocolContext

  return { ctx, params, sentHex, sentBytes, emitted, infos, progresses, paramPatches, logs, saved, timerIds }
}

/** createLoop 的构造参数：主从协议实现体与各自的参数表 */
export interface LoopOptions<M, S> {
  master: { module: M; params?: Record<string, unknown> }
  slave: { module: S; params?: Record<string, unknown> }
}

/** createLoop 返回值：两个实例、ctx 与各收集器 */
export interface LoopHarness<M, S> {
  master: M
  slave: S
  masterCtx: ProtocolContext
  slaveCtx: ProtocolContext
  masterSentHex: string[]
  slaveSentHex: string[]
  masterSentBytes: number[][]
  slaveSentBytes: number[][]
  masterEmitted: VarSample[]
  slaveEmitted: VarSample[]
  masterLogs: string[]
  slaveLogs: string[]
}

/**
 * 构建虚拟总线闭环：slave.sendHex → 自动喂回 master.onRx；
 * master.sendHex → 自动喂给 slave.handle。模拟同一总线上一问一答。
 * 注意：调用方需在收到返回值后自行 init（peer 引用已预先建立）。
 */
export function createLoop<M, S>(opts: LoopOptions<M, S>): LoopHarness<M, S> {
  const masterSentHex: string[] = []
  const masterSentBytes: number[][] = []
  const slaveSentHex: string[] = []
  const slaveSentBytes: number[][] = []
  const masterEmitted: VarSample[] = []
  const slaveEmitted: VarSample[] = []
  const masterLogs: string[] = []
  const slaveLogs: string[] = []
  const utils = buildProtocolUtils()

  const master = opts.master.module as M & {
    onRx?(frame: { bytes: number[] }): void
  } | null
  const slave = opts.slave.module as S & {
    handle?(frame: { bytes: number[] }): void
  } | null

  const masterCtx = {
    channelId: 'serial-loop',
    instanceId: 'pi-master',
    sendHex: async (hex: string) => {
      masterSentHex.push(hex)
      const bytes = utils.hexToBytes(hex)
      masterSentBytes.push(bytes)
      // 主站请求 → 从站收
      if (slave?.handle) slave.handle({ bytes })
      return { bytesSent: bytes.length, seq: masterSentHex.length }
    },
    emitVar: (s: VarSample) => masterEmitted.push(s),
    emitInfo: () => {},
    emitProgress: () => {},
    applyQuery: () => false,
    request: async () => {
      throw new Error('createLoop 未实现 ctx.request')
    },
    setParam: () => {},
    log: (level: string, msg: string) => masterLogs.push(`${level}: ${msg}`),
    getParam: (key: string) => opts.master.params?.[key],
    getFile: () => null,
    saveFile: async () => '',
    timer: { setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} },
    utils,
  } as unknown as ProtocolContext

  const slaveCtx = {
    channelId: 'serial-loop',
    instanceId: 'pi-slave',
    sendHex: async (hex: string) => {
      slaveSentHex.push(hex)
      const bytes = utils.hexToBytes(hex)
      slaveSentBytes.push(bytes)
      // 从站应答 → 主站收
      if (master?.onRx) master.onRx({ bytes })
      return { bytesSent: bytes.length, seq: slaveSentHex.length }
    },
    emitVar: (s: VarSample) => slaveEmitted.push(s),
    emitInfo: () => {},
    emitProgress: () => {},
    applyQuery: () => false,
    request: async () => {
      throw new Error('createLoop 未实现 ctx.request')
    },
    setParam: () => {},
    log: (level: string, msg: string) => slaveLogs.push(`${level}: ${msg}`),
    getParam: (key: string) => opts.slave.params?.[key],
    getFile: () => null,
    saveFile: async () => '',
    timer: { setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} },
    utils,
  } as unknown as ProtocolContext

  return {
    master: master as M,
    slave: slave as S,
    masterCtx,
    slaveCtx,
    masterSentHex,
    slaveSentHex,
    masterSentBytes,
    slaveSentBytes,
    masterEmitted,
    slaveEmitted,
    masterLogs,
    slaveLogs,
  }
}

export type { ProtocolContext, ProtocolUtils }
