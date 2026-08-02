import { describe, it, expect } from 'vitest'
import { buildProtocolUtils } from './utils'
import type { ProtocolContext } from './types'

interface SlaveMain {
  init(ctx: ProtocolContext): void
  dispose(): void
  match(frame: { bytes: number[] }): boolean
  handle(frame: { bytes: number[] }): void
  setConfig(patch: Record<string, unknown>): void
  getVariables(): { key: string; label: string }[]
}

const utils = buildProtocolUtils()

const MODULE_URL = '../../public/protocols/builtin/modbus-rtu-slave/main.js'

function makeCtx(overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    addr: 1,
    coils: [
      { addr: 0, value: 1, name: 'coil0' },
      { addr: 1, value: 0, name: 'coil1' },
    ],
    registers: [
      { reg: 0, value: 100, name: 'reg0', unit: 'V' },
      { reg: 1, value: 200, name: 'reg1', unit: 'V' },
    ],
    byte_order: 'be',
    ...overrides,
  }
  const sent: string[] = []
  const emitted: { valueId: string; value: number; unit?: string }[] = []
  const logs: string[] = []
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
      setInterval: () => 0,
      clearTimeout: () => {},
      clearInterval: () => {},
    },
    utils,
  } as unknown as ProtocolContext
  return { ctx, sent, emitted, logs, params }
}

async function load(): Promise<SlaveMain> {
  return (await import(MODULE_URL)).default as SlaveMain
}

function withCrc(body: number[]): number[] {
  const crc = utils.crc16Modbus(body)
  return [...body, crc & 0xff, (crc >> 8) & 0xff]
}

describe('modbus-rtu-slave', () => {
  it('match 校验地址与 CRC', async () => {
    const main = await load()
    const { ctx } = makeCtx()
    main.init(ctx)

    expect(main.match({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })).toBe(true)
    expect(main.match({ bytes: withCrc([0x02, 0x03, 0x00, 0x00, 0x00, 0x01]) })).toBe(false)
    expect(main.match({ bytes: [0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00] })).toBe(false)
  })

  it('01 读线圈按位打包应答', async () => {
    const main = await load()
    const { ctx, sent, emitted } = makeCtx()
    main.init(ctx)

    // 读线圈 0-1：coil0=1, coil1=0 → 字节 0b0001
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x02]) })
    expect(sent.length).toBe(1)
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x01])
    expect(emitted).toContainEqual({ valueId: 'coil_0', value: 1 })
    expect(emitted).toContainEqual({ valueId: 'coil_1', value: 0 })
  })

  it('05 写单线圈生效并回显', async () => {
    const main = await load()
    const { ctx, sent, emitted } = makeCtx()
    main.init(ctx)

    main.handle({ bytes: withCrc([0x01, 0x05, 0x00, 0x01, 0xff, 0x00]) })
    expect(sent.length).toBe(1)
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x05, 0x00, 0x01, 0xff, 0x00])

    // 再读线圈 1，应为 1
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x01, 0x00, 0x01]) })
    const readResp = utils.hexToBytes(sent[0])
    expect(readResp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x01])
    expect(emitted).toContainEqual({ valueId: 'coil_1', value: 1 })
  })

  it('0F 写多线圈并按位回写', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    // 线圈 0-1 写 1、1 → 字节 0b11
    main.handle({ bytes: withCrc([0x01, 0x0f, 0x00, 0x00, 0x00, 0x02, 0x01, 0x03]) })
    expect(sent.length).toBe(1)
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x0f, 0x00, 0x00, 0x00, 0x02])

    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x02]) })
    const readResp = utils.hexToBytes(sent[0])
    expect(readResp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x03])
  })

  it('02 读离散输入 / 04 读输入寄存器按同一存储区应答', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    main.handle({ bytes: withCrc([0x01, 0x02, 0x00, 0x00, 0x00, 0x02]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 4)).toEqual([0x01, 0x02, 0x01, 0x01])

    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x04, 0x00, 0x00, 0x00, 0x01]) })
    const regResp = utils.hexToBytes(sent[0])
    expect(regResp.slice(0, 5)).toEqual([0x01, 0x04, 0x02, 0x00, 0x64]) // 100 = 0x0064
  })

  it('03 读保持寄存器应答', async () => {
    const main = await load()
    const { ctx, sent, emitted } = makeCtx()
    main.init(ctx)

    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 5)).toEqual([0x01, 0x03, 0x02, 0x00, 0x64])
    expect(emitted).toContainEqual({ valueId: 'reg_0', value: 100, unit: 'V' })
  })

  it('06 / 10 写寄存器', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    main.handle({ bytes: withCrc([0x01, 0x06, 0x00, 0x00, 0x00, 0x2a]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 6)).toEqual([0x01, 0x06, 0x00, 0x00, 0x00, 0x2a])

    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x10, 0x00, 0x00, 0x00, 0x02, 0x04, 0x00, 0x01, 0x00, 0x02]) })
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x10, 0x00, 0x00, 0x00, 0x02])
  })

  it('不支持的功能码返回异常码 01', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    main.handle({ bytes: withCrc([0x01, 0x20, 0x00, 0x00, 0x00, 0x01]) })
    const resp = utils.hexToBytes(sent[0])
    expect(resp.slice(0, 3)).toEqual([0x01, 0xa0, 0x01])
  })

  it('读取超出配置范围返回异常码 02（不自动创建）', async () => {
    const main = await load()
    const { ctx, sent, emitted } = makeCtx()
    main.init(ctx)

    // 寄存器最大地址 1，读 1 起 2 个 → 越界
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x01, 0x00, 0x02]) })
    expect(sent.length).toBe(1)
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x83, 0x02])

    // 起始地址超出最大地址
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x05, 0x00, 0x01]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x83, 0x02])

    // 线圈最大地址 1，读线圈 0 起 3 个 → 越界
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x03]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x81, 0x02])

    // 无越界时正常应答且不额外 emit
    sent.length = 0
    emitted.length = 0
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })
    expect(utils.hexToBytes(sent[0])[1]).toBe(0x03)
  })

  it('写入超出配置范围返回异常码 02（不自动创建）', async () => {
    const main = await load()
    const { ctx, sent } = makeCtx()
    main.init(ctx)

    // 写寄存器 5（最大 1）→ 越界
    main.handle({ bytes: withCrc([0x01, 0x06, 0x00, 0x05, 0x00, 0x2a]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x86, 0x02])

    // 写多寄存器越界（起始 1，共 2 个 → 超出 1）
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x00, 0x01, 0x00, 0x02]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x90, 0x02])

    // 写线圈 2（最大 1）→ 越界
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x05, 0x00, 0x02, 0xff, 0x00]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x85, 0x02])

    // 写多线圈越界（起始 1，共 2 个 → 超出 1）
    sent.length = 0
    main.handle({ bytes: withCrc([0x01, 0x0f, 0x00, 0x01, 0x00, 0x02, 0x01, 0x03]) })
    expect(utils.hexToBytes(sent[0]).slice(0, 3)).toEqual([0x01, 0x8f, 0x02])
  })

  it('getVariables 输出线圈与寄存器变量', async () => {
    const main = await load()
    const { ctx } = makeCtx()
    main.init(ctx)
    const vars = main.getVariables()
    expect(vars).toContainEqual({ key: 'coil_0', label: 'coil0 (0)', unit: '' })
    expect(vars).toContainEqual({ key: 'reg_0', label: 'reg0 (0)', unit: 'V' })
  })
})
