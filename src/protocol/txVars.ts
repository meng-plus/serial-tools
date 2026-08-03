/**
 * 定时发送变量：目录（UI 查阅）与展开器共用，避免文档漂移。
 * 语法：{{seq}} / {{seq:u8|u16le|u16be}} / {{channel.seq…}} / {{time:…}} / {{rand:N}}
 *       {{crc8}} / {{crc16:le}} / {{sum8}} / {{xor8}} 等校验变量
 */

import {
  crc8 as crc8Fn,
  crc16Modbus,
  crc16CcittFalse,
  crc16Xmodem,
  crc16Ibm,
  sum8 as sum8Fn,
  sum16 as sum16Fn,
  xor8 as xor8Fn,
} from './checksum'

export type TxPayloadFormat = 'text' | 'hex' | 'gbk'

export type TxVarCategory = '序号' | '时间' | '校验' | '随机'

export interface TxVarCatalogEntry {
  token: string
  description: string
  scope: string
  category: TxVarCategory
  textExample: string
  hexExample: string
}

/** 变量分组顺序 */
export const TX_VAR_CATEGORIES: TxVarCategory[] = ['序号', '时间', '校验', '随机']

/** 单一真相源：变量说明 Drawer 直接渲染本表 */
export const TX_VAR_CATALOG: TxVarCatalogEntry[] = [
  // ── 序号变量 ──────────────────────────────────────────────
  {
    token: '{{seq}}',
    description: '本条目序号。文本为十进制；HEX 为 1 字节（两位十六进制）。',
    scope: '条目',
    category: '序号',
    textExample: 'CMD {{seq}}',
    hexExample: '01 03 {{seq}}',
  },
  {
    token: '{{seq:u8}}',
    description: '本条目序号，1 字节（0–255 循环）。',
    scope: '条目',
    category: '序号',
    textExample: 'n={{seq:u8}}',
    hexExample: 'AA {{seq:u8}} BB',
  },
  {
    token: '{{seq:u16le}}',
    description: '本条目序号，2 字节小端。',
    scope: '条目',
    category: '序号',
    textExample: 'id={{seq:u16le}}',
    hexExample: '01 {{seq:u16le}}',
  },
  {
    token: '{{seq:u16be}}',
    description: '本条目序号，2 字节大端。',
    scope: '条目',
    category: '序号',
    textExample: 'id={{seq:u16be}}',
    hexExample: '01 {{seq:u16be}}',
  },
  {
    token: '{{channel.seq}}',
    description: '本通道共享序号（多条目共用递增）。文本十进制；HEX 为 1 字节。',
    scope: '通道',
    category: '序号',
    textExample: 'CH {{channel.seq}}',
    hexExample: 'FE {{channel.seq}}',
  },
  {
    token: '{{channel.seq:u8}}',
    description: '通道序号，1 字节。',
    scope: '通道',
    category: '序号',
    textExample: '{{channel.seq:u8}}',
    hexExample: '{{channel.seq:u8}}',
  },
  {
    token: '{{channel.seq:u16le}}',
    description: '通道序号，2 字节小端。',
    scope: '通道',
    category: '序号',
    textExample: '{{channel.seq:u16le}}',
    hexExample: '{{channel.seq:u16le}}',
  },
  {
    token: '{{channel.seq:u16be}}',
    description: '通道序号，2 字节大端。',
    scope: '通道',
    category: '序号',
    textExample: '{{channel.seq:u16be}}',
    hexExample: '{{channel.seq:u16be}}',
  },

  // ── 时间变量 ──────────────────────────────────────────────
  {
    token: '{{time:unix}}',
    description: '本地 Unix 时间戳（秒）。',
    scope: '时间',
    category: '时间',
    textExample: 'ts={{time:unix}}',
    hexExample: '（建议用文本模式；HEX 中为十进制数字的 ASCII 十六进制编码，一般用文本）',
  },
  {
    token: '{{time:ms}}',
    description: '本地 Unix 时间戳（毫秒）。',
    scope: '时间',
    category: '时间',
    textExample: '{{time:ms}}',
    hexExample: '同 unix，优先文本模式',
  },
  {
    token: '{{time:YYYYMMDD}}',
    description: '本地日期 YYYYMMDD。',
    scope: '时间',
    category: '时间',
    textExample: 'D{{time:YYYYMMDD}}',
    hexExample: '优先文本；或自行写成固定 HEX',
  },
  {
    token: '{{time:HHmmss}}',
    description: '本地时间 HHmmss。',
    scope: '时间',
    category: '时间',
    textExample: 'T{{time:HHmmss}}',
    hexExample: '优先文本',
  },

  // ── 校验变量 ──────────────────────────────────────────────
  {
    token: '{{crc8}}',
    description: 'CRC-8（多项式 0x07）。默认 hex 输出；可加 :dec 冒号后缀。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc8}}',
    hexExample: '01 03 00 00 00 0A {{crc8}}',
  },
  {
    token: '{{crc8_31}}',
    description: 'CRC-8（多项式 0x31）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc8_31}}',
    hexExample: '01 03 {{crc8_31}}',
  },
  {
    token: '{{crc16}}',
    description: 'CRC16-Modbus（多项式 0xA001）。可加 :le / :be / :dec 后缀。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16}}',
    hexExample: '01 03 00 00 00 0A {{crc16:le}}',
  },
  {
    token: '{{crc16:le}}',
    description: 'CRC16-Modbus，小端输出（低字节在前）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16:le}}',
    hexExample: '01 03 {{crc16:le}}',
  },
  {
    token: '{{crc16:be}}',
    description: 'CRC16-Modbus，大端输出（高字节在前）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16:be}}',
    hexExample: '01 03 {{crc16:be}}',
  },
  {
    token: '{{crc16_ccitt}}',
    description: 'CRC16-CCITT-FALSE（多项式 0x1021，默认大端）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16_ccitt}}',
    hexExample: '01 03 {{crc16_ccitt:be}}',
  },
  {
    token: '{{crc16_xmodem}}',
    description: 'CRC16-XMODEM（多项式 0x1021，初值 0，YMODEM 用）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16_xmodem}}',
    hexExample: '{{crc16_xmodem:be}}',
  },
  {
    token: '{{crc16_ibm}}',
    description: 'CRC16-IBM/ANSI（多项式 0x8005，默认小端）。',
    scope: '校验',
    category: '校验',
    textExample: '{{crc16_ibm}}',
    hexExample: '{{crc16_ibm:le}}',
  },
  {
    token: '{{sum8}}',
    description: '累加和 8 位（单字节取模）。',
    scope: '校验',
    category: '校验',
    textExample: '{{sum8}}',
    hexExample: '01 03 {{sum8}}',
  },
  {
    token: '{{sum16}}',
    description: '累加和 16 位。可加 :le / :be 后缀。',
    scope: '校验',
    category: '校验',
    textExample: '{{sum16}}',
    hexExample: '{{sum16:le}}',
  },
  {
    token: '{{xor8}}',
    description: '异或校验 8 位。',
    scope: '校验',
    category: '校验',
    textExample: '{{xor8}}',
    hexExample: '01 03 {{xor8}}',
  },

  // ── 随机变量 ──────────────────────────────────────────────
  {
    token: '{{rand:N}}',
    description: 'N 字节随机值。HEX：2N 位十六进制；文本：同样输出十六进制字符串（无空格）。N=1..32。',
    scope: '随机',
    category: '随机',
    textExample: 'nonce={{rand:4}}',
    hexExample: 'AA {{rand:2}} BB',
  },
]

export interface ExpandCtx {
  format: TxPayloadFormat
  itemSeq: number
  channelSeq: number
  now?: Date
  /** 可注入以便单测 */
  randomBytes?: (n: number) => number[]
}

export interface ExpandResult {
  payload: string
  usedItemSeq: boolean
  usedChannelSeq: boolean
  usedCrc: boolean
}

type SeqWidth = 'default' | 'u8' | 'u16le' | 'u16be'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatLocal(d: Date, kind: 'YYYYMMDD' | 'HHmmss'): string {
  if (kind === 'YYYYMMDD') {
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
  }
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function toHexBytes(bytes: number[]): string {
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('')
}

function toHexWithSpace(bytes: number[]): string {
  return bytes.map(b => (b & 0xff).toString(16).padStart(2, '0')).join(' ')
}

function encodeSeq(value: number, width: SeqWidth, format: TxPayloadFormat): string {
  const v = value >>> 0
  if (format === 'hex') {
    if (width === 'u16le') {
      const lo = v & 0xff
      const hi = (v >>> 8) & 0xff
      return toHexBytes([lo, hi])
    }
    if (width === 'u16be') {
      const hi = (v >>> 8) & 0xff
      const lo = v & 0xff
      return toHexBytes([hi, lo])
    }
    // default / u8
    return toHexBytes([v & 0xff])
  }
  // text / gbk
  if (width === 'u16le' || width === 'u16be') return String(v & 0xffff)
  if (width === 'u8') return String(v & 0xff)
  return String(v)
}

function defaultRandom(n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * 256))
  return out
}

/** 将 hex 字符串转为字节数组（忽略空格和 0x 前缀） */
function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16))
  }
  return bytes
}

// ── CRC 算法映射 ─────────────────────────────────────────────
type CrcAlgoName = '8' | '8_31' | '16' | '16_ccitt' | '16_xmodem' | '16_ibm' | 'sum8' | 'sum16' | 'xor8'

const CRC_ALGO_MAP: Record<CrcAlgoName, (bytes: number[]) => number> = {
  '8': (b) => crc8Fn(b, 0x07),
  '8_31': (b) => crc8Fn(b, 0x31),
  '16': crc16Modbus,
  '16_ccitt': crc16CcittFalse,
  '16_xmodem': crc16Xmodem,
  '16_ibm': crc16Ibm,
  sum8: sum8Fn,
  sum16: sum16Fn,
  xor8: xor8Fn,
}

const CRC_WIDTH: Record<CrcAlgoName, 1 | 2> = {
  '8': 1, '8_31': 1, '16': 2, '16_ccitt': 2, '16_xmodem': 2, '16_ibm': 2,
  sum8: 1, sum16: 2, xor8: 1,
}

/** 默认端序：16-bit CCITT/XMODEM 默认 be，其余 le */
const CRC_DEFAULT_ENDIAN: Record<CrcAlgoName, 'le' | 'be'> = {
  '8': 'le', '8_31': 'le', '16': 'le', '16_ccitt': 'be', '16_xmodem': 'be', '16_ibm': 'le',
  sum8: 'le', sum16: 'le', xor8: 'le',
}

// ── 正则 ─────────────────────────────────────────────────────
// 匹配：seq / channel.seq / time:xxx / rand:N / crc(algo)(fmt)? / sum(algo)(fmt)? / xor(algo)(fmt)?
// crc 变量格式：{{crc8}} {{crc16}} {{crc16:le}} 等
const TOKEN_RE =
  /\{\{(?:(channel\.)?seq(?::(u8|u16le|u16be))?|time:(unix|ms|YYYYMMDD|HHmmss)|rand:(\d+)|crc(8_31|16_ccitt|16_xmodem|16_ibm|8|16)|sum(8|16)|xor(8))(?::(hex|dec|le|be))?\}\}/g

/**
 * 展开 payload 中的变量；不修改序号（由调用方在发送成功后自增）。
 * CRC 变量基于展开后的完整内容计算（两遍处理）。
 */
export function expandTxPayload(payload: string, ctx: ExpandCtx): ExpandResult {
  const now = ctx.now ?? new Date()
  const randFn = ctx.randomBytes ?? defaultRandom
  let usedItemSeq = false
  let usedChannelSeq = false
  let usedCrc = false

  // ── 第一遍：展开非 CRC 变量，CRC 变量暂保留 ──────────────
  const afterNonCrc = payload.replace(
    TOKEN_RE,
    (
      full,
      channelPrefix: string | undefined,
      seqWidth: string | undefined,
      timeKind: string | undefined,
      randN: string | undefined,
      _crcAlgo: string | undefined,
      _sumAlgo: string | undefined,
      _xorAlgo: string | undefined,
      _crcFmt: string | undefined,
    ) => {
      // CRC 变量原样保留
      if (_crcAlgo !== undefined || _sumAlgo !== undefined || _xorAlgo !== undefined) return full
      if (randN != null) {
        const n = Math.min(32, Math.max(1, parseInt(randN, 10) || 1))
        return toHexBytes(randFn(n))
      }
      if (timeKind) {
        if (timeKind === 'unix') return String(Math.floor(now.getTime() / 1000))
        if (timeKind === 'ms') return String(now.getTime())
        if (timeKind === 'YYYYMMDD' || timeKind === 'HHmmss') return formatLocal(now, timeKind)
        return full
      }
      const width = (seqWidth as SeqWidth | undefined) || 'default'
      if (channelPrefix) {
        usedChannelSeq = true
        return encodeSeq(ctx.channelSeq, width, ctx.format)
      }
      usedItemSeq = true
      return encodeSeq(ctx.itemSeq, width, ctx.format)
    },
  )

  // ── 第二遍：计算 CRC 并替换 ──────────────────────────────
  // 将展开后的内容转为字节（用于 CRC 计算）
  const contentBytes = ctx.format === 'hex'
    ? hexToBytes(afterNonCrc)
    : Array.from(new TextEncoder().encode(afterNonCrc))

  const out = afterNonCrc.replace(
    TOKEN_RE,
    (
      full,
      _ch: string | undefined,
      _sw: string | undefined,
      _tk: string | undefined,
      _rn: string | undefined,
      crcAlgo: string | undefined,
      sumAlgo: string | undefined,
      xorAlgo: string | undefined,
      crcFmt: string | undefined,
    ) => {
      // 非 CRC 变量已在第一遍处理
      if (crcAlgo === undefined && sumAlgo === undefined && xorAlgo === undefined) return full

      usedCrc = true
      // 确定算法名称
      let algo: CrcAlgoName
      if (crcAlgo) {
        algo = crcAlgo as CrcAlgoName
      } else if (sumAlgo) {
        algo = `sum${sumAlgo}` as CrcAlgoName
      } else {
        algo = `xor${xorAlgo}` as CrcAlgoName
      }

      const fn = CRC_ALGO_MAP[algo]
      if (!fn) return full

      const value = fn(contentBytes)
      const width = CRC_WIDTH[algo]
      const defaultEndian = CRC_DEFAULT_ENDIAN[algo]
      const fmt = (crcFmt || 'hex') as string

      return formatCrcValue(value, width, defaultEndian, fmt, ctx.format)
    },
  )

  return { payload: out, usedItemSeq, usedChannelSeq, usedCrc }
}

/** 格式化 CRC 值 */
function formatCrcValue(
  value: number,
  width: 1 | 2,
  defaultEndian: 'le' | 'be',
  fmt: string,
  payloadFormat: TxPayloadFormat,
): string {
  if (width === 1) {
    // 8-bit 校验：只支持 hex / dec
    if (fmt === 'dec') return String(value & 0xff)
    return toHexBytes([value & 0xff])
  }

  // 16-bit 校验
  const lo = value & 0xff
  const hi = (value >>> 8) & 0xff

  if (fmt === 'dec') return String(value & 0xffff)
  if (fmt === 'hex') {
    // 默认跟随 payload 格式
    if (payloadFormat === 'hex') return toHexWithSpace([hi, lo]) // 默认大端显示
    return String(value & 0xffff)
  }
  if (fmt === 'le') return toHexWithSpace([lo, hi])
  if (fmt === 'be') return toHexWithSpace([hi, lo])

  // 默认：hex 格式用小端，其他用字符串
  if (payloadFormat === 'hex') {
    return defaultEndian === 'le' ? toHexWithSpace([lo, hi]) : toHexWithSpace([hi, lo])
  }
  return String(value & 0xffff)
}

/** 预览用：与 expand 相同，供 UI 只读展示 */
export function previewTxPayload(payload: string, ctx: ExpandCtx): string {
  return expandTxPayload(payload, ctx).payload
}

/**
 * 校验变量展开结果是否与 hex 发送兼容。
 * 返回不兼容的变量列表（用于发送前警告）。
 */
export function checkHexCompatibility(payload: string): { compatible: boolean; incompatibleTokens: string[] } {
  const incompatible: string[] = []

  // 提取所有 CRC 变量的格式
  const crcRe = /\{\{crc(?::\w+)?(?::(?:hex|dec|le|be))?\}\}/g
  let match: RegExpExecArray | null
  while ((match = crcRe.exec(payload)) !== null) {
    const token = match[0]
    // 检查格式修饰符
    const fmtMatch = token.match(/::(hex|dec|le|be)$/)
    if (fmtMatch && fmtMatch[1] === 'dec') {
      // dec 格式会产生十进制字符串，可能包含非 hex 字符（虽然数字是安全的）
      // 但为了明确提示，仍然标记
      incompatible.push(token)
    }
  }

  return { compatible: incompatible.length === 0, incompatibleTokens: incompatible }
}
