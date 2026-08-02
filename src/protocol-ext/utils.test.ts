import { describe, it, expect } from 'vitest'
import { buildProtocolUtils } from './utils'

const u = buildProtocolUtils()

describe('bytes helpers', () => {
  it('hexToBytes / bytesToHex 往返', () => {
    expect(u.hexToBytes('01 0A FF')).toEqual([1, 10, 255])
    expect(u.bytesToHex([1, 10, 255])).toBe('010aff')
    expect(u.bytesToHexCompact([1, 10, 255])).toBe('010aff')
  })
})

describe('crc16Modbus', () => {
  it('已知向量（独立查表法交叉验证）', () => {
    // 01 03 00 00 00 0A → CRC16-Modbus = 0xCDC5（小端存储 C5 CD）
    const crc = u.crc16Modbus([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a])
    expect(crc).toBe(0xcdc5)
  })
})

describe('integer decode/encode', () => {
  it('u16 大端', () => {
    expect(u.u16([0x12, 0x34], 0, 'be')).toBe(0x1234)
    expect(u.u16([0x12, 0x34], 0, 'le')).toBe(0x3412)
  })

  it('i16 有符号', () => {
    expect(u.i16([0xff, 0xfe], 0, 'be')).toBe(-2)
    expect(u.i16([0x00, 0x02], 0, 'be')).toBe(2)
  })

  it('u32 大端', () => {
    expect(u.u32([0x01, 0x02, 0x03, 0x04], 0, 'be')).toBe(0x01020304)
    expect(u.u32([0x01, 0x02, 0x03, 0x04], 0, 'le')).toBe(0x04030201)
  })

  it('encodeU16 / encodeU32 端序', () => {
    expect(u.encodeU16(0x1234, 'be')).toEqual([0x12, 0x34])
    expect(u.encodeU16(0x1234, 'le')).toEqual([0x34, 0x12])
    expect(u.encodeU32(0x01020304, 'be')).toEqual([1, 2, 3, 4])
    expect(u.encodeU32(0x01020304, 'le')).toEqual([4, 3, 2, 1])
  })

  it('f32 往返', () => {
    // IEEE754 32 位大端：1.5 = 0x3FC00000
    expect(u.f32([0x3f, 0xc0, 0x00, 0x00], 0, 'be')).toBe(1.5)
  })
})

describe('decodeBinary', () => {
  it('按字段表解码', () => {
    const res = u.decodeBinary(
      [0x01, 0x00, 0x0a, 0x00, 0x14],
      [
        { name: 'a', offset: 0, type: 'u8' },
        { name: 'b', offset: 2, type: 'u16be' },
      ],
    )
    expect(res[0].numberValue).toBe(1)
    expect(res[1].numberValue).toBe(0x0a00)
  })
})
