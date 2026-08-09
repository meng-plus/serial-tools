import { describe, it, expect } from 'vitest'
import { progressPercent, upsertProgress } from './progressMap'

describe('progressMap', () => {
  it('upsert 合并进度', () => {
    let map = upsertProgress({}, { id: 'ota', current: 1, total: 10, label: '下载' })
    expect(map.ota.current).toBe(1)
    expect(map.ota.total).toBe(10)
    map = upsertProgress(map, { id: 'ota', current: 10, total: 10, done: true })
    expect(map.ota.done).toBe(true)
    expect(progressPercent(map.ota)).toBe(100)
  })

  it('current 不超过 total', () => {
    const map = upsertProgress({}, { id: 'x', current: 99, total: 5 })
    expect(map.x.current).toBe(5)
  })
})
