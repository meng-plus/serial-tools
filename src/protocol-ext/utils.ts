/** ctx.utils 组装：复用现有字节 / 校验 / 二进制解码工具 */

import {
  crc16Modbus,
  crc16Xmodem,
  appendChecksum,
  computeChecksum,
  verifyFrameChecksum,
} from '@/protocol/checksum'
import { decodeBinaryFields } from '@/protocol/binaryDecode'
import { hexToBytes, bytesToHex } from '@/protocol/frame'
import type { ProtocolUtils } from './types'

export function readU16(bytes: number[], offset: number, le: boolean): number {
  if (le) return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8)
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff)
}

export function readU32(bytes: number[], offset: number, le: boolean): number {
  if (le) {
    return (
      (bytes[offset] & 0xff) |
      ((bytes[offset + 1] & 0xff) << 8) |
      ((bytes[offset + 2] & 0xff) << 16) |
      ((bytes[offset + 3] & 0xff) << 24)
    ) >>> 0
  }
  return (
    (((bytes[offset] & 0xff) << 24) |
      ((bytes[offset + 1] & 0xff) << 16) |
      ((bytes[offset + 2] & 0xff) << 8) |
      (bytes[offset + 3] & 0xff)) >>>
    0
  )
}

export function readF32(bytes: number[], offset: number, le: boolean): number {
  const buf = new ArrayBuffer(4)
  const view = new DataView(buf)
  for (let i = 0; i < 4; i++) view.setUint8(i, bytes[offset + i] & 0xff)
  return view.getFloat32(0, le)
}

/** 构建协议实现可用的 utils 集合 */
export function buildProtocolUtils(): ProtocolUtils {
  return {
    hexToBytes,
    bytesToHex,
    bytesToHexCompact: (bytes: number[]) => bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join(''),
    crc16Modbus,
    crc16Xmodem,
    appendChecksum: appendChecksum as ProtocolUtils['appendChecksum'],
    computeChecksum: computeChecksum as ProtocolUtils['computeChecksum'],
    verifyFrameChecksum: verifyFrameChecksum as ProtocolUtils['verifyFrameChecksum'],
    decodeBinary: (bytes, fields) =>
      decodeBinaryFields(
        bytes,
        fields.map(f => ({ name: f.name, offset: f.offset, type: f.type as never, scale: f.scale, bias: f.bias, unit: f.unit })),
      ),
    u16: (bytes, offset, endian = 'be') => readU16(bytes, offset, endian === 'le'),
    i16: (bytes, offset, endian = 'be') => {
      const v = readU16(bytes, offset, endian === 'le')
      return v > 0x7fff ? v - 0x10000 : v
    },
    u32: (bytes, offset, endian = 'be') => readU32(bytes, offset, endian === 'le'),
    f32: (bytes, offset, endian = 'be') => readF32(bytes, offset, endian === 'le'),
    encodeU16: (value, endian = 'be') => {
      const v = value & 0xffff
      return endian === 'le' ? [v & 0xff, (v >>> 8) & 0xff] : [(v >>> 8) & 0xff, v & 0xff]
    },
    encodeU32: (value, endian = 'be') => {
      const v = value >>> 0
      if (endian === 'le') {
        return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
      }
      return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    },
  }
}
