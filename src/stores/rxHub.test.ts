import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

const storedSettings = { rxDebounceMs: 0 }
vi.mock('@/utils/appSettings', () => ({
  loadAppSettings: () => ({ ...storedSettings }),
  saveAppSettings: (s: { rxDebounceMs: number }) => {
    storedSettings.rxDebounceMs = s.rxDebounceMs
  },
}))

import { setActivePinia, createPinia } from 'pinia'
import { useRxHub } from '@/stores/rxHub'

function rec(over: Partial<{ direction: 'rx' | 'tx'; channelId: string; seq: number; timestamp: string }>) {
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

describe('rxHub.subscribe 防抖', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认（全局配置 0）即时分发', () => {
    const hub = useRxHub()
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction))
    hub.pushRecord(rec({ direction: 'rx' }))
    hub.pushRecord(rec({ direction: 'tx' }))
    expect(got).toEqual(['rx', 'tx'])
  })

  it('全局节流：窗口内多次事件合并为一次批量下发，不丢数据', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(100)
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction))
    hub.pushRecord(rec({ direction: 'rx' }))
    hub.pushRecord(rec({ direction: 'tx' }))
    expect(got).toEqual([])
    vi.advanceTimersByTime(100)
    expect(got).toEqual(['rx', 'tx'])
  })

  it('节流窗口内持续到达：定时器不重置，窗口到期一次性批量下发全部', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(100)
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction))
    // t=0 首条到达启动窗口
    hub.pushRecord(rec({ direction: 'rx' }))
    vi.advanceTimersByTime(50)
    // t=50 再来一条，不重置窗口
    hub.pushRecord(rec({ direction: 'tx' }))
    vi.advanceTimersByTime(50)
    // t=100 窗口到期，两条全部下发
    expect(got).toEqual(['rx', 'tx'])
  })

  it('持续高频：每窗口 flush 一批，不积压、不无限延迟', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(100)
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction))
    // 第一窗口 0-100ms（记录需内容不同，避免去重）
    hub.pushRecord(rec({ direction: 'rx', timestamp: '12:00:00.001' }))
    hub.pushRecord(rec({ direction: 'rx', timestamp: '12:00:00.002' }))
    vi.advanceTimersByTime(100)
    expect(got).toEqual(['rx', 'rx'])
    // 第二窗口 100-200ms 持续到达
    hub.pushRecord(rec({ direction: 'tx', timestamp: '12:00:00.101' }))
    hub.pushRecord(rec({ direction: 'tx', timestamp: '12:00:00.102' }))
    vi.advanceTimersByTime(100)
    expect(got).toEqual(['rx', 'rx', 'tx', 'tx'])
  })

  it('订阅级 debounceMs 覆盖全局配置', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(200)
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction), { debounceMs: 50 })
    hub.pushRecord(rec({ direction: 'rx' }))
    expect(got).toEqual([])
    vi.advanceTimersByTime(50)
    expect(got).toEqual(['rx'])
  })

  it('订阅级 debounceMs=0 覆盖全局配置即时分发', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(100)
    const got: string[] = []
    hub.subscribe((r) => got.push(r.direction), { debounceMs: 0 })
    hub.pushRecord(rec({ direction: 'rx' }))
    expect(got).toEqual(['rx'])
  })

  it('取消订阅同时清除待触发定时器', () => {
    const hub = useRxHub()
    hub.setGlobalDebounceMs(100)
    const got: string[] = []
    const unsub = hub.subscribe((r) => got.push(r.direction))
    hub.pushRecord(rec({ direction: 'rx' }))
    unsub()
    vi.advanceTimersByTime(100)
    expect(got).toEqual([])
  })
})
