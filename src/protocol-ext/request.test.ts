import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runProtocolRequest } from './request'
import type { RxRecord } from '@/protocol/types'

function makeRx(bytes: number[], channelId = 'ch1'): RxRecord {
  return {
    direction: 'rx',
    channelId,
    bytes,
    hex: bytes.map(b => b.toString(16).padStart(2, '0')).join(''),
    text: '',
    timestamp: '',
    seq: 1,
  }
}

describe('runProtocolRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('发送后匹配应答即返回', async () => {
    const sent: string[] = []
    const listeners: Array<(r: RxRecord) => void> = []
    const p = runProtocolRequest(
      {
        channelId: 'ch1',
        sendHex: async hex => {
          sent.push(hex)
        },
        subscribeRx: fn => {
          listeners.push(fn)
          return () => {
            const i = listeners.indexOf(fn)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
      },
      {
        hex: '0102',
        match: f => f.bytes[0] === 0xaa,
        timeout: 500,
      },
    )
    await Promise.resolve()
    expect(sent).toEqual(['0102'])
    listeners[0]?.(makeRx([0xaa, 1]))
    await expect(p).resolves.toEqual({ bytes: [0xaa, 1], hex: 'aa01' })
  })

  it('超时后按 retry 重发', async () => {
    const sent: string[] = []
    const listeners: Array<(r: RxRecord) => void> = []
    const p = runProtocolRequest(
      {
        channelId: 'ch1',
        sendHex: async hex => {
          sent.push(hex)
        },
        subscribeRx: fn => {
          listeners.push(fn)
          return () => {
            const i = listeners.indexOf(fn)
            if (i >= 0) listeners.splice(i, 1)
          }
        },
      },
      {
        hex: '01',
        match: f => f.bytes[0] === 0x55,
        timeout: 100,
        retry: 1,
      },
    )
    await Promise.resolve()
    expect(sent).toHaveLength(1)
    // 第一次超时 → 自动重发
    await vi.advanceTimersByTimeAsync(100)
    expect(sent).toHaveLength(2)
    listeners[listeners.length - 1]?.(makeRx([0x55]))
    await expect(p).resolves.toMatchObject({ bytes: [0x55] })
  })

  it('AbortSignal 取消进行中的等待', async () => {
    const ac = new AbortController()
    const p = runProtocolRequest(
      {
        channelId: 'ch1',
        sendHex: async () => {},
        subscribeRx: () => () => {},
        signal: ac.signal,
      },
      { hex: '01', match: () => false, timeout: 5000 },
    )
    await Promise.resolve()
    ac.abort()
    await expect(p).rejects.toThrow('已取消')
  })
})
