import { describe, it, expect } from 'vitest'
import { cacheFileBytes } from './fileCache'
import { importProtocolModule, loadProtocol, makeTestContext } from './testing'

interface YmodemMain {
  init(ctx: unknown): void
  dispose(): void
  onRx(frame: { bytes: number[] }): void
  onTick(now: number): void
  runAction(actionId: string): void
  setConfig(patch: Record<string, unknown>): void
  getVariables(): { key: string; label: string }[]
}

interface YmodemModule {
  crc16Xmodem(bytes: number[]): number
  buildBlock(blockNo: number, data: number[], blockSize: number): number[]
  buildBlock0(filename: string, size: number): number[]
  parseBlock(frame: number[]): { blockNo: number; data: number[] } | null
  parseBlock0Meta(data: number[]): { filename: string; size: number }
}

const MODULE_URL = '../../public/protocols/demo/ymodem/main.js'

const BASE_PARAMS: Record<string, unknown> = {
  file: { name: '', size: 0, token: '' },
  block_size: '1024',
  timeout_ms: 1000,
  retries: 3,
  save_name: '',
}

function seedFile(name: string, bytes: number[]): string {
  const token = cacheFileBytes(name, bytes)
  return token
}

describe('ymodem main.js', () => {
  it('crc16Xmodem 已知向量', async () => {
    const mod = await importProtocolModule<YmodemModule>(MODULE_URL)
    // "123456789" 的 CRC16-XMODEM 为 0x31C3
    const bytes = '123456789'.split('').map(c => c.charCodeAt(0))
    expect(mod.crc16Xmodem(bytes)).toBe(0x31c3)
  })

  it('buildBlock / parseBlock 往返', async () => {
    const mod = await importProtocolModule<YmodemModule>(MODULE_URL)
    const data = Array.from({ length: 500 }, (_, i) => (i * 7) & 0xff)
    const frame = mod.buildBlock(3, data, 1024)
    expect(frame[0]).toBe(0x02)
    expect(frame.length).toBe(3 + 1024 + 2)
    expect(frame[1]).toBe(3)
    expect(frame[2]).toBe((~3) & 0xff)
    const parsed = mod.parseBlock(frame)
    expect(parsed?.blockNo).toBe(3)
    expect(parsed?.data.slice(0, 500)).toEqual(data)
  })

  it('buildBlock0 / parseBlock0Meta', async () => {
    const mod = await importProtocolModule<YmodemModule>(MODULE_URL)
    const frame = mod.buildBlock0('firmware.bin', 2048)
    const parsed = mod.parseBlock(frame)
    expect(parsed?.blockNo).toBe(0)
    const meta = mod.parseBlock0Meta(parsed!.data)
    expect(meta.filename).toBe('firmware.bin')
    expect(meta.size).toBe(2048)
  })

  it('发送方：等待 C → 块0 → 数据块 → EOT', async () => {
    const main = await loadProtocol<YmodemMain>(MODULE_URL)
    const fileBytes = Array.from({ length: 1300 }, (_, i) => i & 0xff)
    const token = seedFile('up.bin', fileBytes)
    const h = makeTestContext({
      params: { ...BASE_PARAMS, file: { name: 'up.bin', size: fileBytes.length, token } },
    })
    main.init(h.ctx)
    main.runAction('start_send')
    expect(h.logs.some(l => l.includes('等待接收方'))).toBe(true)

    // 接收方发 C
    main.onRx({ bytes: [0x43] })
    expect(h.sentBytes.length).toBe(1)
    // 块0：SOH(0x01) 块号0
    expect(h.sentBytes[0][0]).toBe(0x01)
    expect(h.sentBytes[0][1]).toBe(0)

    // ACK 块0 → 发送数据块（1024）
    main.onRx({ bytes: [0x06] })
    expect(h.sentBytes.length).toBe(2)
    expect(h.sentBytes[1][0]).toBe(0x02) // STX
    expect(h.sentBytes[1][1]).toBe(1)

    // 数据块损坏重发：NAK
    main.onRx({ bytes: [0x15] })
    expect(h.sentBytes.length).toBe(3)
    expect(h.sentBytes[2][0]).toBe(0x02)
    expect(h.sentBytes[2][1]).toBe(1)

    // ACK → 第二块（剩余 276 字节，按 blockSize=1024 仍用 STX 填充）
    main.onRx({ bytes: [0x06] })
    expect(h.sentBytes.length).toBe(4)
    expect(h.sentBytes[3][0]).toBe(0x02) // STX
    expect(h.sentBytes[3][1]).toBe(2)

    // ACK → 所有数据发完 → EOT
    main.onRx({ bytes: [0x06] })
    expect(h.sentBytes.length).toBe(5)
    expect(h.sentBytes[4][0]).toBe(0x04) // EOT

    // ACK EOT → done
    main.onRx({ bytes: [0x06] })
    const last = h.emitted.filter(e => e.valueId === 'progress').pop()
    expect(last?.value).toBe(100)
  })

  it('接收方：C → 块0 → 数据块 → EOT 保存', async () => {
    const mod = await importProtocolModule<YmodemModule>(MODULE_URL)
    const main = await loadProtocol<YmodemMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)
    main.runAction('start_recv')
    expect(h.sentBytes[0][0]).toBe(0x43) // 请求 C

    // 发送方块0
    main.onRx({ bytes: mod.buildBlock0('fw.img', 300) })
    expect(h.sentBytes.length).toBe(2)
    expect(h.sentBytes[1][0]).toBe(0x06) // ACK

    // 数据块1（300 字节 → 128 块？按接收端自适应头解析）
    const data1 = Array.from({ length: 300 }, (_, i) => (i + 1) & 0xff)
    main.onRx({ bytes: mod.buildBlock(1, data1.slice(0, 128), 128) })
    expect(h.sentBytes.length).toBe(3)
    expect(h.sentBytes[2][0]).toBe(0x06) // ACK
    main.onRx({ bytes: mod.buildBlock(2, data1.slice(128, 256), 128) })
    main.onRx({ bytes: mod.buildBlock(3, data1.slice(256, 300), 128) })
    expect(h.sentBytes.length).toBe(5)

    // EOT → 保存
    main.onRx({ bytes: [0x04] })
    expect(h.saved.length).toBe(1)
    expect(h.saved[0].name).toBe('fw.img')
    expect(h.saved[0].bytes.length).toBe(300)
    expect(h.saved[0].bytes).toEqual(data1)
  })

  it('未选择文件时开始下发报错', async () => {
    const main = await loadProtocol<YmodemMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)
    main.runAction('start_send')
    expect(h.logs.some(l => l.includes('未选择下发文件'))).toBe(true)
  })

  it('取消传输发送 CAN', async () => {
    const main = await loadProtocol<YmodemMain>(MODULE_URL)
    const fileBytes = [1, 2, 3, 4]
    const token = seedFile('a.bin', fileBytes)
    const h = makeTestContext({
      params: { ...BASE_PARAMS, file: { name: 'a.bin', size: 4, token } },
    })
    main.init(h.ctx)
    main.runAction('start_send')
    main.onRx({ bytes: [0x43] })
    main.runAction('cancel')
    expect(h.sentBytes[h.sentBytes.length - 1][0]).toBe(0x18) // CAN
  })
})
