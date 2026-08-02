import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

vi.mock('@/api/events', () => ({
  onRxData: vi.fn(() => Promise.resolve(() => {})),
  onRxGap: vi.fn(() => Promise.resolve(() => {})),
  onConnectionChanged: vi.fn(() => Promise.resolve(() => {})),
  onLogEntry: vi.fn(() => Promise.resolve(() => {})),
}))

import { setActivePinia, createPinia } from 'pinia'
import { useRxHub } from '@/stores/rxHub'

function rec(over: Partial<{ direction: 'rx' | 'tx'; channelId: string; seq: number }>) {
  return {
    direction: 'rx' as 'rx' | 'tx',
    channelId: 'ch1',
    hex: '00',
    text: '',
    bytes: [0],
    timestamp: '12:00:00.000',
    seq: undefined as number | undefined,
    ...over,
  }
}

describe('rxHub.subscribe 方向与通道过滤', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认订阅 rx + tx 全部方向', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction))
    hub.pushRecord(rec({ direction: 'rx' }))
    hub.pushRecord(rec({ direction: 'tx' }))
    expect(got).toEqual(['rx', 'tx'])
  })

  it('direction: rx 只收到接收', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction), { direction: 'rx' })
    hub.pushRecord(rec({ direction: 'rx' }))
    hub.pushRecord(rec({ direction: 'tx' }))
    expect(got).toEqual(['rx'])
  })

  it('direction: tx 只收到发送', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction), { direction: 'tx' })
    hub.pushRecord(rec({ direction: 'rx' }))
    hub.pushRecord(rec({ direction: 'tx' }))
    expect(got).toEqual(['tx'])
  })

  it('channelId 过滤指定通道', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(r.channelId), { channelId: 'chA' })
    hub.pushRecord(rec({ channelId: 'chA' }))
    hub.pushRecord(rec({ channelId: 'chB' }))
    expect(got).toEqual(['chA'])
  })

  it('方向 + 通道可组合过滤', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(`${r.channelId}:${r.direction}`), {
      direction: 'rx',
      channelId: 'chA',
    })
    hub.pushRecord(rec({ channelId: 'chA', direction: 'rx' }))
    hub.pushRecord(rec({ channelId: 'chA', direction: 'tx' }))
    hub.pushRecord(rec({ channelId: 'chB', direction: 'rx' }))
    expect(got).toEqual(['chA:rx'])
  })

  it('取消订阅后不再收到', () => {
    const hub = useRxHub()
    const got: string[] = []
    const unsub = hub.subscribe((r) => got.push(r.direction), { direction: 'rx' })
    unsub()
    hub.pushRecord(rec({ direction: 'rx' }))
    expect(got).toEqual([])
  })
})
