import { describe, it, expect } from 'vitest'
import { crc16Modbus, sum8, applyFrame, hexToBytes, bytesToHex } from './frame'

describe('frame builder', () => {
  it('crc16 modbus known vector', () => {
    // 01 03 00 00 00 0A → CRC 0xCDC5（低字节在前 C5 CD）
    const data = hexToBytes('01030000000A')
    expect(crc16Modbus(data)).toBe(0xcdc5)
  })

  it('sum8', () => {
    expect(sum8([0x01, 0x02, 0xff])).toBe(0x02)
  })

  it('applyFrame appends crc and seq', () => {
    const { bytes, nextSeq } = applyFrame(
      hexToBytes('01030000000A'),
      { id: 'p', name: 'p', checksum: 'crc16_modbus', seqOffset: -1 },
      0,
    )
    expect(bytesToHex(bytes)).toBe('01030000000ac5cd')
    expect(nextSeq).toBe(0)
  })

  it('writes seq byte', () => {
    const { bytes, nextSeq } = applyFrame(
      [0x00, 0x00, 0x00],
      { id: 'p', name: 'p', checksum: 'none', seqOffset: 1 },
      7,
    )
    expect(bytes[1]).toBe(7)
    expect(nextSeq).toBe(8)
  })
})
