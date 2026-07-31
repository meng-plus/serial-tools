/**
 * 通用校验算法（发送追加 / 接收校验共用）。
 * crc16_modbus 仅为算法名，不表示产品级 Modbus 支持。
 */

export type ChecksumAlgo =
  | 'none'
  | 'sum8'
  | 'sum16_le'
  | 'sum16_be'
  | 'xor8'
  | 'crc8_07'
  | 'crc8_31'
  | 'crc16_modbus'
  | 'crc16_ccitt_false'
  | 'crc16_ibm'

export interface ChecksumCatalogEntry {
  id: ChecksumAlgo
  name: string
  size: 0 | 1 | 2
  /** 追加到帧尾时的默认字节序 */
  defaultEndian: 'le' | 'be' | 'na'
}

/** UI / 帧配置下拉同源 */
export const CHECKSUM_CATALOG: ChecksumCatalogEntry[] = [
  { id: 'none', name: '无', size: 0, defaultEndian: 'na' },
  { id: 'sum8', name: '累加和 8 位', size: 1, defaultEndian: 'na' },
  { id: 'sum16_le', name: '累加和 16 位（LE）', size: 2, defaultEndian: 'le' },
  { id: 'sum16_be', name: '累加和 16 位（BE）', size: 2, defaultEndian: 'be' },
  { id: 'xor8', name: '异或 8 位', size: 1, defaultEndian: 'na' },
  { id: 'crc8_07', name: 'CRC8（poly 0x07）', size: 1, defaultEndian: 'na' },
  { id: 'crc8_31', name: 'CRC8（poly 0x31）', size: 1, defaultEndian: 'na' },
  { id: 'crc16_modbus', name: 'CRC16-Modbus（poly A001）', size: 2, defaultEndian: 'le' },
  { id: 'crc16_ccitt_false', name: 'CRC16-CCITT-FALSE（poly 1021）', size: 2, defaultEndian: 'be' },
  { id: 'crc16_ibm', name: 'CRC16-IBM/ANSI（poly 8005）', size: 2, defaultEndian: 'le' },
]

export function checksumSize(algo: ChecksumAlgo): 0 | 1 | 2 {
  return CHECKSUM_CATALOG.find(c => c.id === algo)?.size ?? 0
}

export function sum8(bytes: number[]): number {
  let s = 0
  for (const b of bytes) s = (s + (b & 0xff)) & 0xff
  return s
}

export function sum16(bytes: number[]): number {
  let s = 0
  for (const b of bytes) s = (s + (b & 0xff)) & 0xffff
  return s
}

export function xor8(bytes: number[]): number {
  let x = 0
  for (const b of bytes) x ^= b & 0xff
  return x & 0xff
}

/** CRC8，初值 0，poly 为常规表示（非反射） */
export function crc8(bytes: number[], poly: number, init = 0): number {
  let crc = init & 0xff
  for (const b of bytes) {
    crc ^= b & 0xff
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80) crc = ((crc << 1) ^ poly) & 0xff
      else crc = (crc << 1) & 0xff
    }
  }
  return crc
}

/** CRC16 Modbus：poly 0xA001 反射，初值 0xFFFF，结果低字节在前常用 */
export function crc16Modbus(bytes: number[]): number {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b & 0xff
    for (let i = 0; i < 8; i++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xa001
      else crc >>>= 1
    }
  }
  return crc & 0xffff
}

/** CRC16-CCITT-FALSE：poly 0x1021，初值 0xFFFF，非反射 */
export function crc16CcittFalse(bytes: number[]): number {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff
      else crc = (crc << 1) & 0xffff
    }
  }
  return crc & 0xffff
}

/** CRC16-IBM/ANSI：poly 0x8005 反射为 0xA001，初值 0x0000 */
export function crc16Ibm(bytes: number[]): number {
  let crc = 0
  for (const b of bytes) {
    crc ^= b & 0xff
    for (let i = 0; i < 8; i++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xa001
      else crc >>>= 1
    }
  }
  return crc & 0xffff
}

/** 计算校验数值（未打包成字节） */
export function computeChecksum(algo: ChecksumAlgo, cover: number[]): number {
  switch (algo) {
    case 'none':
      return 0
    case 'sum8':
      return sum8(cover)
    case 'sum16_le':
    case 'sum16_be':
      return sum16(cover)
    case 'xor8':
      return xor8(cover)
    case 'crc8_07':
      return crc8(cover, 0x07)
    case 'crc8_31':
      return crc8(cover, 0x31)
    case 'crc16_modbus':
      return crc16Modbus(cover)
    case 'crc16_ccitt_false':
      return crc16CcittFalse(cover)
    case 'crc16_ibm':
      return crc16Ibm(cover)
    default:
      return 0
  }
}

export function appendChecksum(
  payload: number[],
  algo: ChecksumAlgo,
  endian?: 'le' | 'be',
): number[] {
  if (algo === 'none') return [...payload]
  const entry = CHECKSUM_CATALOG.find(c => c.id === algo)
  const size = entry?.size ?? 0
  if (size === 0) return [...payload]
  const value = computeChecksum(algo, payload)
  const out = [...payload]
  const end = endian || entry?.defaultEndian || 'le'
  if (size === 1) {
    out.push(value & 0xff)
  } else if (end === 'be') {
    out.push((value >>> 8) & 0xff, value & 0xff)
  } else {
    out.push(value & 0xff, (value >>> 8) & 0xff)
  }
  return out
}

/**
 * 校验帧尾校验码。cover = frame.slice(0, -size)
 */
export function verifyFrameChecksum(
  frame: number[],
  algo: ChecksumAlgo,
  endian?: 'le' | 'be',
): boolean {
  if (algo === 'none') return true
  const size = checksumSize(algo)
  if (size === 0) return true
  if (frame.length < size) return false
  const cover = frame.slice(0, frame.length - size)
  const expected = computeChecksum(algo, cover)
  const entry = CHECKSUM_CATALOG.find(c => c.id === algo)
  const end = endian || entry?.defaultEndian || 'le'
  if (size === 1) {
    return (frame[frame.length - 1] & 0xff) === (expected & 0xff)
  }
  const stored =
    end === 'be'
      ? ((frame[frame.length - 2] & 0xff) << 8) | (frame[frame.length - 1] & 0xff)
      : (frame[frame.length - 2] & 0xff) | ((frame[frame.length - 1] & 0xff) << 8)
  return stored === (expected & 0xffff)
}
