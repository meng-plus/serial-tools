import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('api/tauri', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('isTauri returns false when __TAURI_INTERNALS__ is missing', async () => {
    // 在 node 环境中没有 window 对象
    const { isTauri } = await import('@/api/tauri')
    expect(isTauri()).toBe(false)
  })

  it('invoke throws when not in Tauri environment', async () => {
    const { invoke } = await import('@/api/tauri')
    await expect(invoke('test_cmd')).rejects.toThrow('Not in Tauri environment')
  })
})
