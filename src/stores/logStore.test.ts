import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

vi.mock('@/api/events', () => ({
  onLogEntry: vi.fn(() => Promise.resolve(() => {})),
}))

import { setActivePinia, createPinia } from 'pinia'
import { useLogStore } from '@/stores/logStore'
import { invoke } from '@/api/tauri'

describe('logStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should initialize with empty state', () => {
    const store = useLogStore()
    expect(store.logs).toEqual([])
    expect(store.filterLevel).toBeUndefined()
  })

  it('should fetch logs', async () => {
    const store = useLogStore()
    vi.mocked(invoke).mockResolvedValue([
      { timestamp: '12:00:00.000', level: 'info', source: 'test', message: 'msg1' },
      { timestamp: '12:00:01.000', level: 'error', source: 'test', message: 'msg2' },
    ])

    await store.fetchLogs()

    expect(store.logs).toHaveLength(2)
    expect(store.logs[0].level).toBe('info')
    expect(store.logs[1].level).toBe('error')
  })

  it('should clear logs', async () => {
    const store = useLogStore()
    store.logs = [
      { timestamp: '12:00:00.000', level: 'info', source: 'test', message: 'msg' },
    ]
    vi.mocked(invoke).mockResolvedValue(true)

    await store.clearLogs()

    expect(store.logs).toEqual([])
    expect(invoke).toHaveBeenCalledWith('clear_logs')
  })

  it('should fetch with level filter', async () => {
    const store = useLogStore()
    vi.mocked(invoke).mockResolvedValue([])

    await store.fetchLogs(100, 'error')

    expect(invoke).toHaveBeenCalledWith('get_logs', { limit: 100, level: 'error' })
  })
})
