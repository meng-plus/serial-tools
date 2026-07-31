import { describe, it, expect } from 'vitest'
import {
  appendChecksum,
  computeChecksum,
  verifyFrameChecksum,
  crc16Modbus,
  sum8,
  xor8,
} from './checksum'
import { BinaryFramer } from './binaryFramer'
import { decodeBinaryFields } from './binaryDecode'
import { hexToBytes, bytesToHex } from './frame'

describe('checksum catalog', () => {
  it('sum8 xor8', () => {
    expect(sum8([1, 2, 0xff])).toBe(0x02)
    expect(xor8([0x01, 0x02, 0x03])).toBe(0x00)
  })

  it('crc16 modbus vector', () => {
    expect(crc16Modbus(hexToBytes('01030000000A'))).toBe(0xcdc5)
  })

  it('append and verify roundtrip', () => {
    const payload = hexToBytes('AA5500E60190')
    const framed = appendChecksum(payload, 'sum8')
    expect(verifyFrameChecksum(framed, 'sum8')).toBe(true)
    framed[framed.length - 1] ^= 0xff
    expect(verifyFrameChecksum(framed, 'sum8')).toBe(false)
  })

  it('crc16_modbus append le', () => {
    const payload = hexToBytes('01030000000A')
    const framed = appendChecksum(payload, 'crc16_modbus')
    expect(bytesToHex(framed.slice(-2))).toBe('c5cd')
    expect(verifyFrameChecksum(framed, 'crc16_modbus')).toBe(true)
  })
})

describe('BinaryFramer', () => {
  it('cuts fixed length with header', () => {
    const framer = new BinaryFramer({
      syncHeader: 'AA55',
      lengthMode: 'fixed',
      fixedLength: 6,
      idleMs: 40,
      maxFrame: 256,
      checksum: 'none',
    })
    // AA 55 01 02 03 04 | AA 55 ...
    const frames = framer.push(hexToBytes('AA5501020304AA5505060708'))
    expect(frames).toHaveLength(2)
    expect(bytesToHex(frames[0].bytes)).toBe('aa5501020304')
    expect(frames[0].ok).toBe(true)
  })

  it('idle flush without header', () => {
    const framer = new BinaryFramer({
      lengthMode: 'idle',
      idleMs: 30,
      maxFrame: 256,
      checksum: 'none',
    })
    framer.push(hexToBytes('010203'), 1000)
    expect(framer.tick(1010)).toHaveLength(0)
    const frames = framer.tick(1040)
    expect(frames).toHaveLength(1)
    expect(bytesToHex(frames[0].bytes)).toBe('010203')
  })

  it('verifies checksum on frame', () => {
    const payload = hexToBytes('AA550001')
    const full = appendChecksum(payload, 'sum8')
    const framer = new BinaryFramer({
      syncHeader: 'AA55',
      lengthMode: 'fixed',
      fixedLength: full.length,
      idleMs: 40,
      maxFrame: 256,
      checksum: 'sum8',
    })
    const frames = framer.push(full)
    expect(frames[0].ok).toBe(true)
  })
})

describe('binaryDecode', () => {
  it('decodes u16be with scale', () => {
    // AA 55 | 00 E6 (230) | 01 90 (400)
    const bytes = hexToBytes('AA5500E60190')
    const fields = decodeBinaryFields(bytes, [
      { name: 'temp', offset: 2, type: 'u16be', scale: 0.1, unit: 'C', valueId: 'temperature' },
      { name: 'hum', offset: 4, type: 'u16be', scale: 0.1, unit: '%', valueId: 'humidity' },
    ])
    expect(fields[0].numberValue).toBeCloseTo(23.0)
    expect(fields[1].numberValue).toBeCloseTo(40.0)
  })
})

describe('computeChecksum export', () => {
  it('none is 0', () => {
    expect(computeChecksum('none', [1, 2])).toBe(0)
  })
})
