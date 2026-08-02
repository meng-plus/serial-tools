import { describe, it, expect } from 'vitest'
import { cacheFileBytes } from './fileCache'
import { buildProtocolUtils } from './utils'
import type { ProtocolContext } from './types'

interface YmodemMain {
  init(ctx: ProtocolContext): void
  dispose(): void
  onRx(frame: { bytes: number[] }): void
  onTick(now: number): void
  runAction(actionId: string): void
  setConfig(patch: Record<string, unknown>): void
  getVariables(): { key: string; label: string }[]
}

const utils = buildProtocolUtils()

const MODULE_URL = '../../public/protocols/demo/ymodem/main.js'

function makeCtx(overrides: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    file: { name: '', size: 0, token: '' },
    block_size: '1024',
    timeout_ms: 1000,
    retries: 3,
    save_name: '',
    ...overrides,
  }
  const sent: number[][] = []
  const emitted: { valueId: string; value: number }[] = []
  const logs: string[] = []
  const saved: { name: string; bytes: number[] }[] = []
  const ctx = {
    channelId: 'serial-test',
    instanceId: 'pi-ymodem',
    sendHex: async (hex: string) => {
      const bytes: number[] = []
      const clean = hex.replace(/\s+/g, '')
      for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16))
      sent.push(bytes)
      return { bytesSent: bytes.length, seq: sent.length }
    },
    emitVar: (s: { valueId: string; value: number }) => emitted.push(s),
    log: (_lvl: string, msg: string) => logs.push(msg),
    getParam: (k: string) => params[k],
    getFile: (k: string) => {
      const v = params[k] as { token: string } | undefined
      const cached = v && v.token ? (globalThis as unknown as { __file?: { token: string; name: string; bytes: number[] } }).__file : undefined
      return cached && cached.token === v?.token ? { name: cached.name, bytes: cached.bytes } : null
    },
    saveFile: async (name: string, bytes: number[]) => {
      saved.push({ name, bytes })
      return `exports/${name}`
    },
    timer: {
      setTimeout: () => 0,
      setInterval: () => 0,
      clearTimeout: () => {},
      clearInterval: () => {},
    },
    utils,
  } as unknown as ProtocolContext
  return { ctx, sent, emitted, logs, saved, params }
}

async function load(): Promise<YmodemMain> {
  return (await import(MODULE_URL)).default as YmodemMain
}

describe('ymodem main.js', () => {
  it('crc16Xmodem 已知向量', async () => {
    const mod = await import(MODULE_URL)
    const { crc16Xmodem } = mod
    // "123456789" 的 CRC16-XMODEM 为 0x31C3
    const bytes = '123456789'.split('').map(c => c.charCodeAt(0))
    expect(crc16Xmodem(bytes)).toBe(0x31c3)
  })

  it('buildBlock / parseBlock 往返', async () => {
    const mod = await import(MODULE_URL)
    const { buildBlock, parseBlock } = mod
    const data = Array.from({ length: 500 }, (_, i) => (i * 7) & 0xff)
    const frame = buildBlock(3, data, 1024)
    expect(frame[0]).toBe(0x02)
    expect(frame.length).toBe(3 + 1024 + 2)
    expect(frame[1]).toBe(3)
    expect(frame[2]).toBe((~3) & 0xff)
    const parsed = parseBlock(frame)
    expect(parsed?.blockNo).toBe(3)
    expect(parsed?.data.slice(0, 500)).toEqual(data)
  })

  it('buildBlock0 / parseBlock0Meta', async () => {
    const mod = await import(MODULE_URL)
    const { buildBlock0, parseBlock0Meta, parseBlock } = mod
    const frame = buildBlock0('firmware.bin', 2048)
    const parsed = parseBlock(frame)
    expect(parsed?.blockNo).toBe(0)
    const meta = parseBlock0Meta(parsed!.data)
    expect(meta.filename).toBe('firmware.bin')
    expect(meta.size).toBe(2048)
  })

  it('发送方：等待 C → 块0 → 数据块 → EOT', async () => {
    const main = await load()
    const fileBytes = Array.from({ length: 1300 }, (_, i) => i & 0xff)
    const token = cacheFileBytes('up.bin', fileBytes)
    ;(globalThis as unknown as { __file: object }).__file = { token, name: 'up.bin', bytes: fileBytes }
    const { ctx, sent, emitted, logs } = makeCtx({
      file: { name: 'up.bin', size: fileBytes.length, token },
    })
    main.init(ctx)
    main.runAction('start_send')
    expect(logs.some(l => l.includes('等待接收方'))).toBe(true)

    // 接收方发 C
    main.onRx({ bytes: [0x43] })
    expect(sent.length).toBe(1)
    // 块0：SOH(0x01) 块号0
    expect(sent[0][0]).toBe(0x01)
    expect(sent[0][1]).toBe(0)

    // ACK 块0 → 发送数据块（1024）
    main.onRx({ bytes: [0x06] })
    expect(sent.length).toBe(2)
    expect(sent[1][0]).toBe(0x02) // STX
    expect(sent[1][1]).toBe(1)

    // 数据块损坏重发：NAK
    main.onRx({ bytes: [0x15] })
    expect(sent.length).toBe(3)
    expect(sent[2][0]).toBe(0x02)
    expect(sent[2][1]).toBe(1)

    // ACK → 第二块（剩余 276 字节，按 blockSize=1024 仍用 STX 填充）
    main.onRx({ bytes: [0x06] })
    expect(sent.length).toBe(4)
    expect(sent[3][0]).toBe(0x02) // STX
    expect(sent[3][1]).toBe(2)

    // ACK → 所有数据发完 → EOT
    main.onRx({ bytes: [0x06] })
    expect(sent.length).toBe(5)
    expect(sent[4][0]).toBe(0x04) // EOT

    // ACK EOT → done
    main.onRx({ bytes: [0x06] })
    const last = emitted.filter(e => e.valueId === 'progress').pop()
    expect(last?.value).toBe(100)
  })

  it('接收方：C → 块0 → 数据块 → EOT 保存', async () => {
    const mod = await import(MODULE_URL)
    const { buildBlock, buildBlock0 } = mod
    const main = await load()
    const { ctx, sent, saved } = makeCtx()
    main.init(ctx)
    main.runAction('start_recv')
    expect(sent[0][0]).toBe(0x43) // 请求 C

    // 发送方块0
    main.onRx({ bytes: buildBlock0('fw.img', 300) })
    expect(sent.length).toBe(2)
    expect(sent[1][0]).toBe(0x06) // ACK

    // 数据块1（300 字节 → 128 块？按接收端自适应头解析）
    const data1 = Array.from({ length: 300 }, (_, i) => (i + 1) & 0xff)
    main.onRx({ bytes: buildBlock(1, data1.slice(0, 128), 128) })
    expect(sent.length).toBe(3)
    expect(sent[2][0]).toBe(0x06) // ACK
    main.onRx({ bytes: buildBlock(2, data1.slice(128, 256), 128) })
    main.onRx({ bytes: buildBlock(3, data1.slice(256, 300), 128) })
    expect(sent.length).toBe(5)

    // EOT → 保存
    main.onRx({ bytes: [0x04] })
    expect(saved.length).toBe(1)
    expect(saved[0].name).toBe('fw.img')
    expect(saved[0].bytes.length).toBe(300)
    expect(saved[0].bytes).toEqual(data1)
  })

  it('未选择文件时开始下发报错', async () => {
    const main = await load()
    const { ctx, logs } = makeCtx()
    main.init(ctx)
    main.runAction('start_send')
    expect(logs.some(l => l.includes('未选择下发文件'))).toBe(true)
  })

  it('取消传输发送 CAN', async () => {
    const main = await load()
    const fileBytes = [1, 2, 3, 4]
    const token = cacheFileBytes('a.bin', fileBytes)
    ;(globalThis as unknown as { __file: object }).__file = { token, name: 'a.bin', bytes: fileBytes }
    const { ctx, sent } = makeCtx({ file: { name: 'a.bin', size: 4, token } })
    main.init(ctx)
    main.runAction('start_send')
    main.onRx({ bytes: [0x43] })
    main.runAction('cancel')
    expect(sent[sent.length - 1][0]).toBe(0x18) // CAN
  })
})
