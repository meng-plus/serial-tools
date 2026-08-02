import { describe, it, expect, vi } from 'vitest'
import { buildProtocolUtils } from './utils'
import type { ProtocolContext } from './types'

interface ModbusMain {
  init(ctx: ProtocolContext): void
  dispose(): void
  onRx(frame: { bytes: number[] }): void
  onTick(now: number): void
  runAction(actionId: string): void
  setConfig(patch: Record<string, unknown>): void
  getVariables(): { key: string; label: string }[]
}

const utils = buildProtocolUtils()

const MODULE_URL = '../../public/protocols/builtin/modbus-rtu-master/main.js'

function makeCtx(overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    poll: [{ name: 'dev1', addr: 1, func: 3, start: 0, count: 2 }],
    cycle_ms: 500,
    timeout_ms: 200,
    retry: 2,
    byte_order: 'be',
    ...overrides,
  }
  const sent: string[] = []
  const emitted: { valueId: string; value: number }[] = []
  const logs: string[] = []
  const intervals: number[] = []
  const ctx = {
    channelId: 'serial-test',
    instanceId: 'pi-test',
    sendHex: async (hex: string) => {
      sent.push(hex)
      return { bytesSent: hex.length / 2, seq: 1 }
    },
    emitVar: (s: { valueId: string; value: number }) => emitted.push(s),
    log: (_lvl: string, msg: string) => logs.push(msg),
    getParam: (k: string) => params[k],
    timer: {
      setTimeout: () => 0,
      setInterval: (_cb: () => void) => {
        const id = intervals.length + 1
        intervals.push(id)
        return id
      },
      clearTimeout: () => {},
      clearInterval: () => {},
    },
    utils,
  } as unknown as ProtocolContext
  return { ctx, sent, emitted, logs, params }
}

async function load(): Promise<ModbusMain> {
  return (await import(MODULE_URL)).default as ModbusMain
}

function readFrameHex(sentHex: string): number[] {
  return utils.hexToBytes(sentHex)
}

describe('modbus-rtu-master', () => {
  it('init 后按轮询表组帧下发（含 CRC16 校验字节）', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    expect(sent.length).toBe(1)
    const frame = readFrameHex(sent[0])
    expect(frame).toHaveLength(8) // 6 字节 PDU + 2 CRC
    expect(frame.slice(0, 6)).toEqual([0x01, 0x03, 0x00, 0x00, 0x00, 0x02])
    const crc = utils.crc16Modbus(frame.slice(0, 6))
    expect(frame[6]).toBe(crc & 0xff)
    expect(frame[7]).toBe((crc >> 8) & 0xff)
  })

  it('onRx 校验 CRC 并解析寄存器 emitVar', async () => {
    const main = await load()
    const { ctx, emitted, logs } = makeCtx()
    main.init(ctx)

    const data = [0x00, 0x0a, 0x00, 0x14] // 寄存器 10, 20
    const body = [0x01, 0x03, 0x04, ...data]
    const crc = utils.crc16Modbus(body)
    main.onRx({ bytes: [...body, crc & 0xff, (crc >> 8) & 0xff] })

    expect(emitted).toContainEqual({ valueId: 'dev1_0', value: 10 })
    expect(emitted).toContainEqual({ valueId: 'dev1_1', value: 20 })
    expect(logs.some(l => l.includes('读取 2 个寄存器'))).toBe(true)
  })

  it('CRC 错误时丢弃且不产生变量', async () => {
    const main = await load()
    const { ctx, emitted } = makeCtx()
    main.init(ctx)
    main.onRx({ bytes: [0x01, 0x03, 0x04, 0, 10, 0, 20, 0x00, 0x00] })
    expect(emitted).toHaveLength(0)
  })

  it('连续超时后判定离线并重发', async () => {
    vi.useFakeTimers()
    try {
      const main = await load()
      const { ctx, sent, emitted } = makeCtx()
      vi.setSystemTime(1_000_000)
      main.init(ctx)
      const firstLen = sent.length

      const t0 = Date.now()
      // 第一次超时：重试
      vi.setSystemTime(t0 + 200)
      main.onTick(t0 + 200)
      expect(sent.length).toBe(firstLen + 1)

      // 第二次超时：重试
      const t1 = t0 + 400
      vi.setSystemTime(t1)
      main.onTick(t1)
      expect(sent.length).toBe(firstLen + 2)

      // 第三次超时：判定离线
      const t2 = t0 + 600
      vi.setSystemTime(t2)
      main.onTick(t2)
      expect(emitted).toContainEqual({ valueId: 'online_1', value: 0 })
      expect(sent.length).toBe(firstLen + 2) // 不再重发
    } finally {
      vi.useRealTimers()
    }
  })

  it('setConfig 参数变更立即重发一轮', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)
    const before = sent.length
    main.setConfig({ cycle_ms: 300 })
    expect(sent.length).toBeGreaterThan(before)
  })

  it('cycle_ms 为 0 时停止轮询（不建定时器、不发帧）', async () => {
    vi.useFakeTimers()
    try {
      const main = await load()
      const { ctx, sent, params } = makeCtx({ cycle_ms: 0 })
      vi.setSystemTime(1_000_000)
      main.init(ctx)
      // 初始不立即轮询
      expect(sent).toHaveLength(0)

      // 推进定时器时间也不应触发轮询
      vi.advanceTimersByTime(10_000)
      expect(sent).toHaveLength(0)

      // 恢复周期后重新轮询（真实运行时 setConfig 前已合并参数）
      params.cycle_ms = 500
      main.setConfig({ cycle_ms: 500 })
      expect(sent.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runAction read_all 强制重发', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)
    const before = sent.length
    main.runAction('read_all')
    expect(sent.length).toBe(before + 1)
  })

  it('getVariables 生成寄存器变量', async () => {
    const main = await load()
    const { ctx } = makeCtx()
    main.init(ctx)
    const vars = main.getVariables()
    expect(vars).toContainEqual({ key: 'dev1_0', label: 'dev1 寄存器 0', unit: '' })
    expect(vars).toContainEqual({ key: 'dev1_1', label: 'dev1 寄存器 1', unit: '' })
    expect(vars).toContainEqual({ key: 'online_1', label: 'dev1 在线', unit: '' })
  })
})
