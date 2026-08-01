/**
 * 发送流水线：变量展开 →（可选）按覆盖区间算校验并追加到帧尾。
 */

import {
  appendChecksum,
  computeChecksum,
  checksumSize,
  type ChecksumAlgo,
} from './checksum'
import { expandTxPayload, type ExpandCtx, type TxPayloadFormat } from './txVars'
import { bytesToHex, hexToBytes } from './frame'

export type CoverEndMode = 'to_end' | 'exclude_tail' | 'length'

export interface ChecksumCover {
  /** 覆盖起始字节下标（含），从 0 开始 */
  start: number
  endMode: CoverEndMode
  /** exclude_tail：尾部排除字节数；length：覆盖长度；to_end 忽略 */
  endValue?: number
}

export function resolveCoverRange(
  len: number,
  cover: ChecksumCover,
): { start: number; end: number } {
  const start = Math.max(0, Math.min(Math.floor(cover.start) || 0, len))
  let end = len
  if (cover.endMode === 'exclude_tail') {
    const n = Math.max(0, Math.floor(cover.endValue ?? 0))
    end = Math.max(start, len - n)
  } else if (cover.endMode === 'length') {
    const n = Math.max(0, Math.floor(cover.endValue ?? len - start))
    end = Math.min(len, start + n)
  }
  return { start, end }
}

/** 对 cover 区间计算校验，追加到整帧末尾 */
export function appendChecksumWithCover(
  payload: number[],
  algo: ChecksumAlgo,
  cover?: ChecksumCover,
  endian?: 'le' | 'be',
): number[] {
  if (algo === 'none' || checksumSize(algo) === 0) return [...payload]
  if (!cover || (cover.start === 0 && cover.endMode === 'to_end')) {
    return appendChecksum(payload, algo, endian)
  }
  const { start, end } = resolveCoverRange(payload.length, cover)
  const value = computeChecksum(algo, payload.slice(start, end))
  const size = checksumSize(algo)
  const out = [...payload]
  if (size === 1) {
    out.push(value & 0xff)
  } else {
    const end: 'le' | 'be' = endian === 'be' ? 'be' : 'le'
    if (end === 'be') {
      out.push((value >>> 8) & 0xff, value & 0xff)
    } else {
      out.push(value & 0xff, (value >>> 8) & 0xff)
    }
  }
  return out
}

export interface SendPipelineInput {
  format: TxPayloadFormat
  payload: string
  expandCtx: ExpandCtx
  /** 仅 HEX 路径追加校验；文本模式忽略 */
  checksum?: ChecksumAlgo
  cover?: ChecksumCover
}

export interface SendPipelineResult {
  expanded: string
  wire: string
  preview: string
  usedItemSeq: boolean
  usedChannelSeq: boolean
  format: TxPayloadFormat
}

export function runSendPipeline(input: SendPipelineInput): SendPipelineResult {
  const expanded = expandTxPayload(input.payload, {
    ...input.expandCtx,
    format: input.format,
  })

  if (input.format !== 'hex') {
    return {
      expanded: expanded.payload,
      wire: expanded.payload,
      preview: expanded.payload,
      usedItemSeq: expanded.usedItemSeq,
      usedChannelSeq: expanded.usedChannelSeq,
      format: input.format,
    }
  }

  let bytes = hexToBytes(expanded.payload)
  const algo = input.checksum || 'none'
  if (algo !== 'none') {
    bytes = appendChecksumWithCover(bytes, algo, input.cover)
  }
  const wire = bytesToHex(bytes)
  return {
    expanded: expanded.payload,
    wire,
    preview: wire.match(/.{1,2}/g)?.join(' ') || wire,
    usedItemSeq: expanded.usedItemSeq,
    usedChannelSeq: expanded.usedChannelSeq,
    format: 'hex',
  }
}

/** HEX 粘贴：去空白后按字节插空格 */
export function normalizeHexInput(raw: string, pretty = true): string {
  const clean = raw.replace(/[^0-9a-fA-F]/g, '')
  if (!pretty) return clean
  return clean.replace(/(.{2})/g, '$1 ').trim()
}
