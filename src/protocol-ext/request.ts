/** ctx.request：主站请求–应答会话（超时 / 重试 / match） */

import type { RxRecord } from '@/protocol/types'

export interface ProtocolRequestFrame {
  bytes: number[]
  hex: string
  channelId: string
}

export interface ProtocolRequestOptions {
  /** 发送的 hex（无空格亦可） */
  hex: string
  /** 应答匹配；仅对本通道 rx 调用 */
  match: (frame: ProtocolRequestFrame) => boolean
  /** 单次等待超时 ms，默认 1000 */
  timeout?: number
  /** 额外重试次数（总尝试 = 1 + retry），默认 0 */
  retry?: number
}

export interface ProtocolRequestResult {
  bytes: number[]
  hex: string
}

export interface RequestDeps {
  channelId: string
  sendHex: (hex: string) => Promise<unknown>
  /** 订阅本通道 rx；返回取消函数 */
  subscribeRx: (fn: (record: RxRecord) => void) => () => void
  signal?: AbortSignal
}

async function waitMatch(
  deps: RequestDeps,
  match: ProtocolRequestOptions['match'],
  timeout: number,
): Promise<ProtocolRequestResult> {
  return new Promise((resolve, reject) => {
    if (deps.signal?.aborted) {
      reject(new Error('request 已取消'))
      return
    }
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsub()
      deps.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => finish(() => reject(new Error('request 已取消')))
    const unsub = deps.subscribeRx(record => {
      const frame: ProtocolRequestFrame = {
        bytes: record.bytes || [],
        hex: record.hex || '',
        channelId: record.channelId,
      }
      try {
        if (!match(frame)) return
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))))
        return
      }
      finish(() => resolve({ bytes: frame.bytes, hex: frame.hex }))
    })
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`request 超时 (${timeout}ms)`)))
    }, timeout)
    deps.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 发送并等待匹配应答；失败按 retry 重发 */
export async function runProtocolRequest(
  deps: RequestDeps,
  opts: ProtocolRequestOptions,
): Promise<ProtocolRequestResult> {
  const timeout = opts.timeout ?? 1000
  const retry = Math.max(0, opts.retry ?? 0)
  let lastError: Error = new Error('request 失败')
  for (let attempt = 0; attempt <= retry; attempt++) {
    if (deps.signal?.aborted) throw new Error('request 已取消')
    try {
      await deps.sendHex(opts.hex)
      return await waitMatch(deps, opts.match, timeout)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (lastError.message === 'request 已取消') throw lastError
      // 继续下一轮重试（立即重发）
    }
  }
  throw lastError
}
