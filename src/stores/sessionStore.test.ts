import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/stores/sessionStore'
import { invoke } from '@/api/tauri'

describe('sessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should initialize with empty state', () => {
    const store = useSessionStore()
    expect(store.sessions).toEqual([])
    expect(store.currentSession).toBe('')
  })

  it('should load session list', async () => {
    const store = useSessionStore()
    vi.mocked(invoke).mockResolvedValue([
      { name: 'test-session', path: '/path/test.yaml', modified: '2026-07-31 12:00:00' },
    ])

    await store.loadList()

    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].name).toBe('test-session')
  })

  it('should load session content', async () => {
    const store = useSessionStore()
    vi.mocked(invoke).mockResolvedValue('connection:\n  type: serial')

    const content = await store.load('test-session')

    expect(content).toBe('connection:\n  type: serial')
    expect(store.currentSession).toBe('test-session')
    expect(invoke).toHaveBeenCalledWith('load_session', { name: 'test-session' })
  })

  it('should save session', async () => {
    const store = useSessionStore()
    vi.mocked(invoke)
      .mockResolvedValueOnce(true)  // save_session
      .mockResolvedValueOnce([])    // list_sessions

    await store.save('my-session', 'content')

    expect(store.currentSession).toBe('my-session')
    expect(invoke).toHaveBeenCalledWith('save_session', { name: 'my-session', content: 'content' })
  })

  it('should delete session', async () => {
    const store = useSessionStore()
    store.currentSession = 'to-delete'
    vi.mocked(invoke)
      .mockResolvedValueOnce(true)  // delete_session
      .mockResolvedValueOnce([])    // list_sessions

    await store.remove('to-delete')

    expect(store.currentSession).toBe('')
    expect(invoke).toHaveBeenCalledWith('delete_session', { name: 'to-delete' })
  })

  it('should not clear currentSession if deleting different session', async () => {
    const store = useSessionStore()
    store.currentSession = 'keep-this'
    vi.mocked(invoke)
      .mockResolvedValueOnce(true)  // delete_session
      .mockResolvedValueOnce([])    // list_sessions

    await store.remove('delete-that')

    expect(store.currentSession).toBe('keep-this')
  })
})
