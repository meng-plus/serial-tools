/**
 * Intel HEX 解析器
 *
 * 解析 Intel HEX 文本 → 字节映射（addr → data），支持：
 * - 类型 00：数据记录（Data）
 * - 类型 01：文件结束（EOF）
 * - 类型 02：扩展段地址（Ext Segmented Address，<<4）
 * - 类型 03：起始段地址（Start Segmented Address，忽略数据）
 * - 类型 04：扩展线性地址（Ext Linear Address，<<16）
 * - 类型 05：起始线性地址（Start Linear Address，忽略数据）
 *
 * 地址可能有空洞（hex 中未覆盖的字节），返回稀疏映射；
 * `toBin(start, length)` 可把 [start, start+length) 范围填充为连续 bin（空洞补 0xFF）。
 */

export interface HexSegment {
  start: number
  bytes: number[]
}

export interface HexParseResult {
  /** 已解析的最小地址（所有记录） */
  minAddr: number
  /** 已解析的最大地址+1 */
  maxAddr: number
  /** 稀疏字节映射（已处理段地址） */
  map: Map<number, number>
  /** 按地址排序的连续段（相邻地址合并） */
  segments: HexSegment[]
  /** 解析异常（非致命） */
  warnings: string[]
}

/** 解析单行 Intel HEX 记录 */
export function parseHexLine(line: string, base: number): { addr: number; type: number; data: number[] } | null {
  if (typeof line !== 'string') return null
  const s = line.trim()
  if (!s || s[0] !== ':') return null
  const hex = s.slice(1)
  if (hex.length < 10 || hex.length % 2 !== 0) return null
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  if (Number.isNaN(bytes[0])) return null
  const count = bytes[0]
  const addr = ((bytes[1] << 8) | bytes[2]) + base
  const type = bytes[3]
  const data = bytes.slice(4, 4 + count)
  // 校验和：总和取反+1 后 & 0xFF 应为 0
  let sum = 0
  for (const b of bytes) sum += b
  if ((sum & 0xff) !== 0) return null
  return { addr, type, data }
}

/** 解析整个 Intel HEX 文本，返回稀疏映射与连续段 */
export function parseIntelHex(text: string): HexParseResult {
  const map = new Map<number, number>()
  const warnings: string[] = []
  let base = 0
  let minAddr = Infinity
  let maxAddr = -Infinity

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim()[0] !== ':') continue
    const rec = parseHexLine(line, base)
    if (!rec) {
      warnings.push(`跳过无法解析的行: ${line.trim().slice(0, 24)}`)
      continue
    }
    if (rec.type === 0) {
      // 数据记录
      for (let i = 0; i < rec.data.length; i++) {
        map.set(rec.addr + i, rec.data[i])
      }
      minAddr = Math.min(minAddr, rec.addr)
      maxAddr = Math.max(maxAddr, rec.addr + rec.data.length)
    } else if (rec.type === 1) {
      break // EOF
    } else if (rec.type === 2) {
      // 扩展段地址：高 4 位地址 <<4
      base = ((rec.data[0] << 8) | rec.data[1]) << 4
    } else if (rec.type === 4) {
      // 扩展线性地址：高 16 位地址 <<16
      base = ((rec.data[0] << 8) | rec.data[1]) << 16
    }
    // 类型 03/05 忽略
  }

  if (!Number.isFinite(minAddr)) {
    return { minAddr: 0, maxAddr: 0, map, segments: [], warnings }
  }

  // 按地址排序合并连续段
  const sorted = [...map.keys()].sort((a, b) => a - b)
  const segments: HexSegment[] = []
  let seg: HexSegment | null = null
  for (const addr of sorted) {
    if (!seg || addr !== seg.start + seg.bytes.length) {
      if (seg) segments.push(seg)
      seg = { start: addr, bytes: [map.get(addr)!] }
    } else {
      seg.bytes.push(map.get(addr)!)
    }
  }
  if (seg) segments.push(seg)

  return { minAddr, maxAddr, map, segments, warnings }
}

/** 把 [start, start+length) 范围填充为连续 bin（空洞补 0xFF），返回裁剪后的 bin */
export function hexToBin(result: HexParseResult, start: number, length: number): number[] {
  const out: number[] = []
  for (let i = 0; i < length; i++) {
    const v = result.map.get(start + i)
    out.push(v === undefined ? 0xff : v)
  }
  return out
}
