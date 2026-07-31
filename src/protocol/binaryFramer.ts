import { verifyFrameChecksum, type ChecksumAlgo } from './checksum'
import { hexToBytes } from './frame'

export type LengthMode = 'fixed' | 'field' | 'idle'

export interface BinaryFrameConfig {
  syncHeader?: string
  lengthMode: LengthMode
  fixedLength?: number
  lengthOffset?: number
  lengthSize?: 1 | 2
  lengthEndian?: 'le' | 'be'
  /** totalLen = lengthField + lengthBias */
  lengthBias?: number
  idleMs: number
  maxFrame: number
  checksum: ChecksumAlgo
  checksumEndian?: 'le' | 'be'
}

export const DEFAULT_FRAME_CONFIG: BinaryFrameConfig = {
  lengthMode: 'idle',
  idleMs: 40,
  maxFrame: 1024,
  checksum: 'none',
}

export interface FrameEmit {
  bytes: number[]
  ok: boolean
  reason?: string
}

function readLengthField(buf: number[], offset: number, size: 1 | 2, endian: 'le' | 'be'): number | null {
  if (buf.length < offset + size) return null
  if (size === 1) return buf[offset] & 0xff
  if (endian === 'be') return ((buf[offset] & 0xff) << 8) | (buf[offset + 1] & 0xff)
  return (buf[offset] & 0xff) | ((buf[offset + 1] & 0xff) << 8)
}

/**
 * 每规则（或每通道）一个分帧器：定界符优先，idle 超时兜底。
 */
export class BinaryFramer {
  private buf: number[] = []
  private lastPushAt = 0
  private header: number[]

  constructor(private config: BinaryFrameConfig) {
    this.header = config.syncHeader ? hexToBytes(config.syncHeader.replace(/\s+/g, '')) : []
  }

  updateConfig(config: BinaryFrameConfig) {
    this.config = config
    this.header = config.syncHeader ? hexToBytes(config.syncHeader.replace(/\s+/g, '')) : []
  }

  reset() {
    this.buf = []
    this.lastPushAt = 0
  }

  push(bytes: number[], now = Date.now()): FrameEmit[] {
    if (!bytes.length) return this.tick(now)
    this.buf.push(...bytes.map(b => b & 0xff))
    this.lastPushAt = now
    if (this.buf.length > this.config.maxFrame * 2) {
      this.buf = this.buf.slice(-this.config.maxFrame)
    }
    return this.extractReady()
  }

  /** 超时兜底：无新字节超过 idleMs 则冲刷 */
  tick(now = Date.now()): FrameEmit[] {
    if (this.buf.length === 0) return []
    if (now - this.lastPushAt < this.config.idleMs) return []
    return this.flushIdle()
  }

  private extractReady(): FrameEmit[] {
    const out: FrameEmit[] = []
    // 有同步头：循环搜头
    if (this.header.length > 0) {
      while (true) {
        const idx = this.findHeader()
        if (idx < 0) {
          // 保留可能的半个头部
          if (this.buf.length > this.header.length) {
            this.buf = this.buf.slice(-(this.header.length - 1))
          }
          break
        }
        if (idx > 0) this.buf.splice(0, idx)
        const total = this.resolveTotalLength()
        if (total == null) break
        if (total <= 0 || total > this.config.maxFrame) {
          // 坏长度，丢 1 字节再搜
          this.buf.shift()
          continue
        }
        if (this.buf.length < total) break
        const frame = this.buf.splice(0, total)
        out.push(this.finish(frame))
      }
      return out
    }

    // 无头：仅 fixed 可在 push 时切；field 无头也尝试；idle 等 tick
    if (this.config.lengthMode === 'fixed' && this.config.fixedLength) {
      const n = this.config.fixedLength
      while (this.buf.length >= n) {
        out.push(this.finish(this.buf.splice(0, n)))
      }
    } else if (this.config.lengthMode === 'field') {
      while (true) {
        const total = this.resolveTotalLength()
        if (total == null || this.buf.length < total) break
        if (total <= 0 || total > this.config.maxFrame) {
          this.buf.shift()
          continue
        }
        out.push(this.finish(this.buf.splice(0, total)))
      }
    }
    return out
  }

  private flushIdle(): FrameEmit[] {
    if (this.buf.length === 0) return []
    // 有头时尽量切完整帧，剩余不足一帧也整包吐出（现场调试友好）
    const ready = this.extractReady()
    if (this.buf.length === 0) return ready
    const rest = this.buf.splice(0, this.buf.length)
    if (rest.length > this.config.maxFrame) {
      return [...ready, this.finish(rest.slice(0, this.config.maxFrame))]
    }
    return [...ready, this.finish(rest)]
  }

  private findHeader(): number {
    if (this.header.length === 0) return 0
    for (let i = 0; i <= this.buf.length - this.header.length; i++) {
      let ok = true
      for (let j = 0; j < this.header.length; j++) {
        if (this.buf[i + j] !== this.header[j]) {
          ok = false
          break
        }
      }
      if (ok) return i
    }
    return -1
  }

  private resolveTotalLength(): number | null {
    const mode = this.config.lengthMode
    if (mode === 'idle') {
      // 有头时 idle 模式下仍可用 fixedLength（若配置）
      if (this.config.fixedLength && this.config.fixedLength > 0) return this.config.fixedLength
      return null
    }
    if (mode === 'fixed') {
      return this.config.fixedLength && this.config.fixedLength > 0
        ? this.config.fixedLength
        : null
    }
    // field
    const off = this.config.lengthOffset ?? this.header.length
    const size = (this.config.lengthSize ?? 1) as 1 | 2
    const endian = this.config.lengthEndian ?? 'be'
    const field = readLengthField(this.buf, off, size, endian)
    if (field == null) return null
    return field + (this.config.lengthBias ?? 0)
  }

  private finish(frame: number[]): FrameEmit {
    const algo = this.config.checksum
    const ok = verifyFrameChecksum(frame, algo, this.config.checksumEndian)
    return {
      bytes: frame,
      ok,
      reason: ok ? undefined : `checksum ${algo} mismatch`,
    }
  }
}
