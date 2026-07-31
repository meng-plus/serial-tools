import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

vi.mock('@/api/events', () => ({
  onRxData: vi.fn(() => Promise.resolve(() => {})),
  onConnectionChanged: vi.fn(() => Promise.resolve(() => {})),
  onLogEntry: vi.fn(() => Promise.resolve(() => {})),
}))

import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStore } from '@/stores/terminalStore'

describe('terminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should initialize with empty state', () => {
    const store = useTerminalStore()
    expect(store.lines).toEqual([])
    expect(store.encoding).toBe('utf-8')
    expect(store.activeChannelId).toBe('')
    expect(store.rxCount).toBe(0)
    expect(store.txCount).toBe(0)
  })

  it('should add lines via sendText', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue({ success: true, bytes_sent: 5 })

    await store.sendText('ch1', 'hello', 'none')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].channelId).toBe('ch1')
    expect(store.lines[0].text).toBe('hello')
  })

  it('should add lines via sendHex', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue({ success: true, bytes_sent: 3 })

    await store.sendHex('ch1', '010203')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].hex).toBe('010203')
  })

  it('should filter by channel', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue({ success: true, bytes_sent: 1 })

    // 添加来自不同通道的数据
    await store.sendText('ch1', 'data1')
    await store.sendText('ch2', 'data2')
    await store.sendText('ch1', 'data3')

    store.activeChannelId = 'ch1'
    expect(store.filteredLines).toHaveLength(2)
    expect(store.filteredLines[0].text).toBe('data1')
    expect(store.filteredLines[1].text).toBe('data3')

    store.activeChannelId = ''
    expect(store.filteredLines).toHaveLength(3)
  })

  it('should filter TCP Server to include client channels', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue({ success: true, bytes_sent: 1 })

    await store.sendText('tcp_server-0.0.0.0:5000', 'server')
    await store.sendText('tcp_client-192.168.1.5:12345', 'client1')
    await store.sendText('tcp_client-192.168.1.6:12345', 'client2')
    await store.sendText('serial-COM3', 'serial')

    // 选择 TCP Server 应该包含 server + 所有 client
    store.activeChannelId = 'tcp_server-0.0.0.0:5000'
    expect(store.filteredLines).toHaveLength(3)

    // 选择具体 client 应该只显示该 client
    store.activeChannelId = 'tcp_client-192.168.1.5:12345'
    expect(store.filteredLines).toHaveLength(1)

    // 选择 serial 不应该包含 TCP
    store.activeChannelId = 'serial-COM3'
    expect(store.filteredLines).toHaveLength(1)
  })

  it('should count rx and tx correctly', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue({ success: true, bytes_sent: 1 })

    await store.sendText('ch1', 'rx1')
    await store.sendText('ch1', 'rx2')
    await store.sendText('ch1', 'tx1')

    // sendText 总是添加 tx 方向
    expect(store.txCount).toBe(3)
  })

  it('should display text based on encoding', () => {
    const store = useTerminalStore()
    const line = {
      id: 1,
      timestamp: '12:00:00.000',
      direction: 'rx' as const,
      channelId: 'ch1',
      hex: '48656c6c6f',
      text: 'Hello',
      rawBytes: [72, 101, 108, 108, 111],
    }

    store.encoding = 'utf-8'
    expect(store.displayText(line)).toBe('Hello')

    store.encoding = 'hex'
    expect(store.displayText(line)).toBe('48 65 6c 6c 6f')
  })

  it('should clear packets', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValueOnce({ success: true, bytes_sent: 1 })
    await store.sendText('ch1', 'data')
    expect(store.lines).toHaveLength(1)

    vi.mocked(invoke).mockResolvedValueOnce(true)
    await store.clear()

    expect(store.lines).toEqual([])
  })
})
