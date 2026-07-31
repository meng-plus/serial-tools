import { appendChecksum, type ChecksumAlgo } from './checksum'
import type { FrameProfile } from '@/workspace/schema'

export { crc16Modbus, sum8 } from './checksum'

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0) throw new Error('HEX 长度必须为偶数')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 2) {
    const n = parseInt(clean.slice(i, i + 2), 16)
    if (Number.isNaN(n)) throw new Error(`无效 HEX: ${clean.slice(i, i + 2)}`)
    out.push(n)
  }
  return out
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('')
}

/**
 * 应用帧配置：可选写入序号，再追加校验。
 */
export function applyFrame(
  payload: number[],
  profile: FrameProfile | undefined,
  seq: number,
): { bytes: number[]; nextSeq: number } {
  if (!profile || (profile.checksum === 'none' && profile.seqOffset < 0)) {
    return { bytes: [...payload], nextSeq: seq }
  }
  const buf = [...payload]
  let nextSeq = seq
  if (profile.seqOffset >= 0) {
    while (buf.length <= profile.seqOffset) buf.push(0)
    buf[profile.seqOffset] = seq & 0xff
    nextSeq = (seq + 1) & 0xff
  }
  const algo: ChecksumAlgo = profile.checksum
  return { bytes: appendChecksum(buf, algo), nextSeq }
}
