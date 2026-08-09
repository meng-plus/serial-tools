import { describe, it, expect } from 'vitest'
import { loadProtocol, makeTestContext, frameBytes, withCrc } from './testing'

interface SlaveMain {
  init(ctx: unknown): void
  dispose(): void
  match(frame: { bytes: number[] }): boolean
  handle(frame: { bytes: number[] }): void
  setConfig(patch: Record<string, unknown>): void
  getVariables(): { key: string; label: string }[]
}

const MODULE_URL = '../../public/protocols/builtin/modbus-rtu-slave/main.js'

const BASE_PARAMS: Record<string, unknown> = {
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
}

describe('modbus-rtu-slave', () => {
  it('match 校验地址与 CRC', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    expect(main.match({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })).toBe(true)
    expect(main.match({ bytes: withCrc([0x02, 0x03, 0x00, 0x00, 0x00, 0x01]) })).toBe(false)
    expect(main.match({ bytes: [0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00] })).toBe(false)
  })

  it('01 读线圈按位打包应答', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    // 读线圈 0-1：coil0=1, coil1=0 → 字节 0b0001
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x02]) })
    expect(h.sentHex.length).toBe(1)
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x01])
    expect(h.emitted).toContainEqual({ valueId: 'coil_0', value: 1 })
    expect(h.emitted).toContainEqual({ valueId: 'coil_1', value: 0 })
  })

  it('05 写单线圈生效并回显', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    main.handle({ bytes: withCrc([0x01, 0x05, 0x00, 0x01, 0xff, 0x00]) })
    expect(h.sentHex.length).toBe(1)
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x05, 0x00, 0x01, 0xff, 0x00])

    // 再读线圈 1，应为 1
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x01, 0x00, 0x01]) })
    const readResp = frameBytes(h.sentHex[0])
    expect(readResp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x01])
    expect(h.emitted).toContainEqual({ valueId: 'coil_1', value: 1 })
  })

  it('0F 写多线圈并按位回写', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    // 线圈 0-1 写 1、1 → 字节 0b11
    main.handle({ bytes: withCrc([0x01, 0x0f, 0x00, 0x00, 0x00, 0x02, 0x01, 0x03]) })
    expect(h.sentHex.length).toBe(1)
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x0f, 0x00, 0x00, 0x00, 0x02])

    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x02]) })
    const readResp = frameBytes(h.sentHex[0])
    expect(readResp.slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x03])
  })

  it('02 读离散输入 / 04 读输入寄存器按同一存储区应答', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    main.handle({ bytes: withCrc([0x01, 0x02, 0x00, 0x00, 0x00, 0x02]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 4)).toEqual([0x01, 0x02, 0x01, 0x01])

    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x04, 0x00, 0x00, 0x00, 0x01]) })
    const regResp = frameBytes(h.sentHex[0])
    expect(regResp.slice(0, 5)).toEqual([0x01, 0x04, 0x02, 0x00, 0x64]) // 100 = 0x0064
  })

  it('03 读保持寄存器应答', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 5)).toEqual([0x01, 0x03, 0x02, 0x00, 0x64])
    expect(h.emitted).toContainEqual({ valueId: 'reg_0', value: 100, unit: 'V' })
  })

  it('06 / 10 写寄存器', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    main.handle({ bytes: withCrc([0x01, 0x06, 0x00, 0x00, 0x00, 0x2a]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 6)).toEqual([0x01, 0x06, 0x00, 0x00, 0x00, 0x2a])

    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x10, 0x00, 0x00, 0x00, 0x02, 0x04, 0x00, 0x01, 0x00, 0x02]) })
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 6)).toEqual([0x01, 0x10, 0x00, 0x00, 0x00, 0x02])
  })

  it('不支持的功能码返回异常码 01', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    main.handle({ bytes: withCrc([0x01, 0x20, 0x00, 0x00, 0x00, 0x01]) })
    const resp = frameBytes(h.sentHex[0])
    expect(resp.slice(0, 3)).toEqual([0x01, 0xa0, 0x01])
  })

  it('读取超出配置范围返回异常码 02（不自动创建）', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    // 寄存器最大地址 1，读 1 起 2 个 → 越界
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x01, 0x00, 0x02]) })
    expect(h.sentHex.length).toBe(1)
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x83, 0x02])

    // 起始地址超出最大地址
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x05, 0x00, 0x01]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x83, 0x02])

    // 线圈最大地址 1，读线圈 0 起 3 个 → 越界
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x01, 0x00, 0x00, 0x00, 0x03]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x81, 0x02])

    // 无越界时正常应答且不额外 emit
    h.sentHex.length = 0
    h.emitted.length = 0
    main.handle({ bytes: withCrc([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]) })
    expect(frameBytes(h.sentHex[0])[1]).toBe(0x03)
  })

  it('写入超出配置范围返回异常码 02（不自动创建）', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)

    // 写寄存器 5（最大 1）→ 越界
    main.handle({ bytes: withCrc([0x01, 0x06, 0x00, 0x05, 0x00, 0x2a]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x86, 0x02])

    // 写多寄存器越界（起始 1，共 2 个 → 超出 1）
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x00, 0x01, 0x00, 0x02]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x90, 0x02])

    // 写线圈 2（最大 1）→ 越界
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x05, 0x00, 0x02, 0xff, 0x00]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x85, 0x02])

    // 写多线圈越界（起始 1，共 2 个 → 超出 1）
    h.sentHex.length = 0
    main.handle({ bytes: withCrc([0x01, 0x0f, 0x00, 0x01, 0x00, 0x02, 0x01, 0x03]) })
    expect(frameBytes(h.sentHex[0]).slice(0, 3)).toEqual([0x01, 0x8f, 0x02])
  })

  it('getVariables 输出线圈与寄存器变量', async () => {
    const main = await loadProtocol<SlaveMain>(MODULE_URL)
    const h = makeTestContext({ params: BASE_PARAMS })
    main.init(h.ctx)
    const vars = main.getVariables()
    expect(vars).toContainEqual({ key: 'coil_0', label: 'coil0 (0)', unit: '' })
    expect(vars).toContainEqual({ key: 'reg_0', label: 'reg0 (0)', unit: 'V' })
  })
})
