import { describe, it, expect } from 'vitest'
import {
  appendChecksumWithCover,
  resolveCoverRange,
  runSendPipeline,
  normalizeHexInput,
} from './sendPipeline'
import { bytesToHex, hexToBytes } from './frame'

describe('checksum cover', () => {
  it('resolveCoverRange modes', () => {
    expect(resolveCoverRange(10, { start: 2, endMode: 'to_end' })).toEqual({ start: 2, end: 10 })
    expect(resolveCoverRange(10, { start: 2, endMode: 'exclude_tail', endValue: 2 })).toEqual({
      start: 2,
      end: 8,
    })
    expect(resolveCoverRange(10, { start: 2, endMode: 'length', endValue: 3 })).toEqual({
      start: 2,
      end: 5,
    })
  })

  it('appendChecksumWithCover uses slice not full payload', () => {
    const payload = hexToBytes('AA000102FF')
    const framed = appendChecksumWithCover(payload, 'sum8', {
      start: 1,
      endMode: 'length',
      endValue: 3,
    })
    expect(framed.slice(0, 5)).toEqual(payload)
    expect(framed[5]).toBe((0 + 1 + 2) & 0xff)
  })
})

describe('runSendPipeline', () => {
  it('expands vars then appends crc for hex', () => {
    const r = runSendPipeline({
      format: 'hex',
      payload: '01 {{seq:u8}}',
      expandCtx: { format: 'hex', itemSeq: 3, channelSeq: 0 },
      checksum: 'sum8',
      cover: { start: 0, endMode: 'to_end' },
    })
    expect(r.expanded.replace(/\s/g, '').toLowerCase()).toBe('0103')
    const bytes = hexToBytes(r.wire)
    expect(bytesToHex(bytes.slice(0, 2))).toBe('0103')
    expect(bytes[2]).toBe((0x01 + 0x03) & 0xff)
    expect(r.usedItemSeq).toBe(true)
  })

  it('text path skips checksum', () => {
    const r = runSendPipeline({
      format: 'text',
      payload: 'hi{{seq}}',
      expandCtx: { format: 'text', itemSeq: 9, channelSeq: 0 },
      checksum: 'sum8',
    })
    expect(r.wire).toBe('hi9')
  })
})

describe('normalizeHexInput', () => {
  it('strips junk and pretty prints', () => {
    expect(normalizeHexInput('01-03 aa')).toBe('01 03 aa')
  })
})
