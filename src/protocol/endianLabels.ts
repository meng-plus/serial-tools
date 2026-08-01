/**
 * 字节序与二进制数值类型的可读标签（UI 共用）。
 */

import type { BinaryNumberType } from './types'
import { CHECKSUM_CATALOG, checksumSize, type ChecksumAlgo } from './checksum'

export type Endian = 'le' | 'be'

export const ENDIAN_OPTIONS: { value: Endian; label: string; hint: string }[] = [
  {
    value: 'le',
    label: '小端 LE',
    hint: '低字节在前（例：数值 0x1234 → 线上 34 12）',
  },
  {
    value: 'be',
    label: '大端 BE',
    hint: '高字节在前（例：数值 0x1234 → 线上 12 34）',
  },
]

export function endianLabel(e: Endian | 'na' | undefined): string {
  if (!e || e === 'na') return '—'
  return ENDIAN_OPTIONS.find(o => o.value === e)?.label || e
}

export function endianHint(e: Endian): string {
  return ENDIAN_OPTIONS.find(o => o.value === e)?.hint || ''
}

/** 二进制数值类型下拉（含中文说明） */
export const BINARY_TYPE_OPTIONS: {
  value: BinaryNumberType
  label: string
  group: string
}[] = [
  { value: 'u8', label: '无符号 8 位（单字节，无端序）', group: '8 位' },
  { value: 'i8', label: '有符号 8 位（单字节，无端序）', group: '8 位' },
  { value: 'u16le', label: '无符号 16 位 · 小端 LE', group: '16 位' },
  { value: 'u16be', label: '无符号 16 位 · 大端 BE', group: '16 位' },
  { value: 'i16le', label: '有符号 16 位 · 小端 LE', group: '16 位' },
  { value: 'i16be', label: '有符号 16 位 · 大端 BE', group: '16 位' },
  { value: 'u32le', label: '无符号 32 位 · 小端 LE', group: '32 位' },
  { value: 'u32be', label: '无符号 32 位 · 大端 BE', group: '32 位' },
  { value: 'i32le', label: '有符号 32 位 · 小端 LE', group: '32 位' },
  { value: 'i32be', label: '有符号 32 位 · 大端 BE', group: '32 位' },
  { value: 'f32le', label: '浮点 32 位 · 小端 LE', group: '浮点' },
  { value: 'f32be', label: '浮点 32 位 · 大端 BE', group: '浮点' },
]

export function binaryTypeLabel(t: BinaryNumberType): string {
  return BINARY_TYPE_OPTIONS.find(o => o.value === t)?.label || t
}

/** 校验算法展示名（含端序说明） */
export function checksumOptionLabel(algo: ChecksumAlgo): string {
  const e = CHECKSUM_CATALOG.find(c => c.id === algo)
  if (!e) return algo
  return e.name
}

export function checksumNeedsEndian(algo: ChecksumAlgo): boolean {
  return checksumSize(algo) === 2
}

/** sum16_le / sum16_be 与端序联动 */
export function applyEndianToChecksumAlgo(
  algo: ChecksumAlgo,
  endian: Endian,
): ChecksumAlgo {
  if (algo === 'sum16_le' || algo === 'sum16_be') {
    return endian === 'be' ? 'sum16_be' : 'sum16_le'
  }
  return algo
}

export function defaultEndianForChecksum(algo: ChecksumAlgo): Endian {
  const e = CHECKSUM_CATALOG.find(c => c.id === algo)?.defaultEndian
  return e === 'be' ? 'be' : 'le'
}
