/**
 * 定时发送变量：目录（UI 查阅）与展开器共用，避免文档漂移。
 * 语法：{{seq}} / {{seq:u8|u16le|u16be}} / {{channel.seq…}} / {{time:…}} / {{rand:N}}
 */

export type TxPayloadFormat = 'text' | 'hex' | 'gbk'

export interface TxVarCatalogEntry {
  token: string
  description: string
  scope: string
  textExample: string
  hexExample: string
}

/** 单一真相源：变量说明 Drawer 直接渲染本表 */
export const TX_VAR_CATALOG: TxVarCatalogEntry[] = [
  {
    token: '{{seq}}',
    description: '本条目序号。文本为十进制；HEX 为 1 字节（两位十六进制）。',
    scope: '条目',
    textExample: 'CMD {{seq}}',
    hexExample: '01 03 {{seq}}',
  },
  {
    token: '{{seq:u8}}',
    description: '本条目序号，1 字节（0–255 循环）。',
    scope: '条目',
    textExample: 'n={{seq:u8}}',
    hexExample: 'AA {{seq:u8}} BB',
  },
  {
    token: '{{seq:u16le}}',
    description: '本条目序号，2 字节小端。',
    scope: '条目',
    textExample: 'id={{seq:u16le}}',
    hexExample: '01 {{seq:u16le}}',
  },
  {
    token: '{{seq:u16be}}',
    description: '本条目序号，2 字节大端。',
    scope: '条目',
    textExample: 'id={{seq:u16be}}',
    hexExample: '01 {{seq:u16be}}',
  },
  {
    token: '{{channel.seq}}',
    description: '本通道共享序号（多条目共用递增）。文本十进制；HEX 为 1 字节。',
    scope: '通道',
    textExample: 'CH {{channel.seq}}',
    hexExample: 'FE {{channel.seq}}',
  },
  {
    token: '{{channel.seq:u8}}',
    description: '通道序号，1 字节。',
    scope: '通道',
    textExample: '{{channel.seq:u8}}',
    hexExample: '{{channel.seq:u8}}',
  },
  {
    token: '{{channel.seq:u16le}}',
    description: '通道序号，2 字节小端。',
    scope: '通道',
    textExample: '{{channel.seq:u16le}}',
    hexExample: '{{channel.seq:u16le}}',
  },
  {
    token: '{{channel.seq:u16be}}',
    description: '通道序号，2 字节大端。',
    scope: '通道',
    textExample: '{{channel.seq:u16be}}',
    hexExample: '{{channel.seq:u16be}}',
  },
  {
    token: '{{time:unix}}',
    description: '本地 Unix 时间戳（秒）。',
    scope: '时间',
    textExample: 'ts={{time:unix}}',
    hexExample: '（建议用文本模式；HEX 中为十进制数字的 ASCII 十六进制编码，一般用文本）',
  },
  {
    token: '{{time:ms}}',
    description: '本地 Unix 时间戳（毫秒）。',
    scope: '时间',
    textExample: '{{time:ms}}',
    hexExample: '同 unix，优先文本模式',
  },
  {
    token: '{{time:YYYYMMDD}}',
    description: '本地日期 YYYYMMDD。',
    scope: '时间',
    textExample: 'D{{time:YYYYMMDD}}',
    hexExample: '优先文本；或自行写成固定 HEX',
  },
  {
    token: '{{time:HHmmss}}',
    description: '本地时间 HHmmss。',
    scope: '时间',
    textExample: 'T{{time:HHmmss}}',
    hexExample: '优先文本',
  },
  {
    token: '{{rand:N}}',
    description: 'N 字节随机值。HEX：2N 位十六进制；文本：同样输出十六进制字符串（无空格）。N=1..32。',
    scope: '随机',
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

const TOKEN_RE =
  /\{\{(?:(channel\.)?seq(?::(u8|u16le|u16be))?|time:(unix|ms|YYYYMMDD|HHmmss)|rand:(\d+))\}\}/g

/**
 * 展开 payload 中的变量；不修改序号（由调用方在发送成功后自增）。
 */
export function expandTxPayload(payload: string, ctx: ExpandCtx): ExpandResult {
  const now = ctx.now ?? new Date()
  const randFn = ctx.randomBytes ?? defaultRandom
  let usedItemSeq = false
  let usedChannelSeq = false

  const out = payload.replace(
    TOKEN_RE,
    (
      full,
      channelPrefix: string | undefined,
      seqWidth: string | undefined,
      timeKind: string | undefined,
      randN: string | undefined,
    ) => {
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

  return { payload: out, usedItemSeq, usedChannelSeq }
}

/** 预览用：与 expand 相同，供 UI 只读展示 */
export function previewTxPayload(payload: string, ctx: ExpandCtx): string {
  return expandTxPayload(payload, ctx).payload
}
