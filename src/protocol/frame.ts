import type { ChecksumAlgo, FrameProfile } from '@/workspace/schema'

/** CRC16 Modbus（poly 0xA001，初值 0xFFFF） */
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

export function sum8(bytes: number[]): number {
  let s = 0
  for (const b of bytes) s = (s + (b & 0xff)) & 0xff
  return s
}

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
 * seq 为调用方维护的当前序号（写入后由调用方自增）。
 */
export function applyFrame(
  payload: number[],
  profile: FrameProfile | undefined,
  seq: number,
): { bytes: number[]; nextSeq: number } {
  if (!profile || profile.checksum === 'none' && profile.seqOffset < 0) {
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
  if (algo === 'sum8') {
    buf.push(sum8(buf))
  } else if (algo === 'crc16_modbus') {
    const crc = crc16Modbus(buf)
    buf.push(crc & 0xff, (crc >>> 8) & 0xff) // 低字节在前
  }
  return { bytes: buf, nextSeq }
}
