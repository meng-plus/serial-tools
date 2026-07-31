import { describe, it, expect } from 'vitest'
import { expandTxPayload, TX_VAR_CATALOG } from './txVars'

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
