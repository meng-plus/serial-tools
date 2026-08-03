import { describe, it, expect } from 'vitest'
import { expandTxPayload, checkHexCompatibility, TX_VAR_CATALOG } from './txVars'
import { crc16Modbus, crc8, sum8, xor8, crc16Xmodem } from './checksum'

describe('txVars', () => {
  it('catalog has tokens and examples', () => {
    expect(TX_VAR_CATALOG.length).toBeGreaterThan(5)
    for (const e of TX_VAR_CATALOG) {
      expect(e.token).toMatch(/^\{\{.+}\}$/)
      expect(e.description.length).toBeGreaterThan(0)
      expect(e.textExample.length).toBeGreaterThan(0)
    }
  })

  it('expands item seq in text and hex', () => {
    const text = expandTxPayload('n={{seq}}', {
      format: 'text',
      itemSeq: 7,
      channelSeq: 0,
    })
    expect(text.payload).toBe('n=7')
    expect(text.usedItemSeq).toBe(true)

    const hex = expandTxPayload('01 {{seq}} FF', {
      format: 'hex',
      itemSeq: 7,
      channelSeq: 0,
    })
    expect(hex.payload).toBe('01 07 FF')
  })

  it('expands channel seq independently', () => {
    const r = expandTxPayload('{{seq:u8}}-{{channel.seq:u8}}', {
      format: 'hex',
      itemSeq: 1,
      channelSeq: 2,
    })
    expect(r.payload).toBe('01-02')
    expect(r.usedItemSeq).toBe(true)
    expect(r.usedChannelSeq).toBe(true)
  })

  it('expands u16le / u16be', () => {
    const le = expandTxPayload('{{seq:u16le}}', { format: 'hex', itemSeq: 0x1234, channelSeq: 0 })
    expect(le.payload).toBe('3412')
    const be = expandTxPayload('{{seq:u16be}}', { format: 'hex', itemSeq: 0x1234, channelSeq: 0 })
    expect(be.payload).toBe('1234')
  })

  it('expands time and rand', () => {
    const now = new Date(1_754_000_000_000) // fixed ms
    const t = expandTxPayload('{{time:unix}} {{time:ms}}', {
      format: 'text',
      itemSeq: 0,
      channelSeq: 0,
      now,
    })
    expect(t.payload).toBe(`${Math.floor(1_754_000_000_000 / 1000)} 1754000000000`)

    const local = new Date(2026, 7, 1, 10, 20, 30) // local Aug 1 2026
    const d = expandTxPayload('{{time:YYYYMMDD}} {{time:HHmmss}}', {
      format: 'text',
      itemSeq: 0,
      channelSeq: 0,
      now: local,
    })
    expect(d.payload).toBe('20260801 102030')

    const r = expandTxPayload('{{rand:2}}', {
      format: 'hex',
      itemSeq: 0,
      channelSeq: 0,
      randomBytes: () => [0xab, 0xcd],
    })
    expect(r.payload).toBe('abcd')
    expect(r.usedItemSeq).toBe(false)
  })
})

describe('txVars 内联校验变量', () => {
  const strip = (s: string) => s.replace(/\s/g, '').toLowerCase()

  it('{{crc16}} 默认小端，只覆盖校验字段之前的字节', () => {
    // 期望 = crc16Modbus(AA 01 02)，默认 le → 低字节在前 d1 b1
    const r = expandTxPayload('AA 01 02 {{crc16}}', { format: 'hex', itemSeq: 0, channelSeq: 0 })
    expect(r.usedCrc).toBe(true)
    expect(strip(r.payload)).toBe('aa0102d1b1')
  })

  it('{{crc16:le}} 与 {{crc16:be}} 端序不同', () => {
    const le = expandTxPayload('AA 01 02 {{crc16:le}}', {
      format: 'hex',
      itemSeq: 0,
      channelSeq: 0,
    })
    const be = expandTxPayload('AA 01 02 {{crc16:be}}', {
      format: 'hex',
      itemSeq: 0,
      channelSeq: 0,
    })
    expect(strip(le.payload)).toBe('aa0102d1b1')
    expect(strip(be.payload)).toBe('aa0102b1d1')
  })

  it('{{crc8}} / {{sum8}} / {{xor8}} 单字节校验', () => {
    const base = [0xaa, 0x01, 0x02]
    const c8 = expandTxPayload('AA 01 02 {{crc8}}', { format: 'hex', itemSeq: 0, channelSeq: 0 })
    expect(strip(c8.payload)).toBe(
      `aa0102${(crc8(base, 0x07) & 0xff).toString(16).padStart(2, '0')}`,
    )
    const s8 = expandTxPayload('AA 01 02 {{sum8}}', { format: 'hex', itemSeq: 0, channelSeq: 0 })
    expect(strip(s8.payload)).toBe(
      `aa0102${(sum8(base) & 0xff).toString(16).padStart(2, '0')}`,
    )
    const x8 = expandTxPayload('AA 01 02 {{xor8}}', { format: 'hex', itemSeq: 0, channelSeq: 0 })
    expect(strip(x8.payload)).toBe(
      `aa0102${(xor8(base) & 0xff).toString(16).padStart(2, '0')}`,
    )
  })

  it('{{crc16_xmodem}} 默认大端', () => {
    const r = expandTxPayload('AA 01 02 {{crc16_xmodem}}', {
      format: 'hex',
      itemSeq: 0,
      channelSeq: 0,
    })
    const v = crc16Xmodem([0xaa, 0x01, 0x02])
    expect(strip(r.payload)).toBe(
      `aa0102${((v >> 8) & 0xff).toString(16).padStart(2, '0')}${(v & 0xff).toString(16).padStart(2, '0')}`,
    )
  })

  it('校验变量与序号变量混用：基数 = 展开后剔除校验 token', () => {
    // {{seq:u8}} 先展开为 03，再算 CRC 覆盖 AA 01 03
    const r = expandTxPayload('AA 01 {{seq:u8}} {{crc16}}', {
      format: 'hex',
      itemSeq: 3,
      channelSeq: 0,
    })
    const v = crc16Modbus([0xaa, 0x01, 0x03])
    expect(strip(r.payload)).toBe(
      `aa0103${(v & 0xff).toString(16).padStart(2, '0')}${((v >> 8) & 0xff).toString(16).padStart(2, '0')}`,
    )
    expect(r.usedItemSeq).toBe(true)
    expect(r.usedCrc).toBe(true)
  })

  it('文本模式 {{crc16}} 输出十进制数值', () => {
    const r = expandTxPayload('LEN={{crc16}}', { format: 'text', itemSeq: 0, channelSeq: 0 })
    // 基数 = 剔除校验 token 后的其余文本 "LEN=" 的字节
    const v = crc16Modbus([0x4c, 0x45, 0x4e, 0x3d])
    expect(r.payload).toBe(`LEN=${v}`)
    expect(r.usedCrc).toBe(true)
  })

  it('checkHexCompatibility 能识别 {{crc16:dec}} 警告', () => {
    expect(checkHexCompatibility('01 {{crc16}}')).toEqual({
      compatible: true,
      incompatibleTokens: [],
    })
    expect(checkHexCompatibility('01 {{crc16:dec}}')).toEqual({
      compatible: false,
      incompatibleTokens: ['{{crc16:dec}}'],
    })
  })
})
