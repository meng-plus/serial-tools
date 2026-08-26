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

vi.mock('@/utils/appSettings', () => ({
  loadAppSettings: () => ({ rxDebounceMs: 0 }),
  saveAppSettings: () => {},
}))

import { setActivePinia, createPinia } from 'pinia'
import { useTerminalStore } from '@/stores/terminalStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useRxHub } from '@/stores/rxHub'

function mockSend(channelId: string, text: string, hex?: string) {
  const encoded = hex ?? Array.from(new TextEncoder().encode(text))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return {
    success: true,
    bytes_sent: encoded.length / 2,
    timestamp: '12:00:00.000',
    hex: encoded,
    text,
    channel_id: channelId,
    seq: Math.floor(Math.random() * 100000) + 1,
  }
}

async function readyTerminal() {
  const { invoke } = await import('@/api/tauri')
  vi.mocked(invoke).mockResolvedValue({ packets: [], total: 0 })
  const store = useTerminalStore()
  await store.init()
  return store
}

describe('terminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should initialize with empty state', async () => {
    const store = await readyTerminal()
    expect(store.lines).toEqual([])
    expect(store.encoding).toBe('utf-8')
    expect(store.activeChannelId).toBe('')
    expect(store.rxCount).toBe(0)
    expect(store.txCount).toBe(0)
  })

  it('should add lines via sendText', async () => {
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', 'hello'))

    await store.sendText('ch1', 'hello', 'none')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].channelId).toBe('ch1')
    expect(store.lines[0].text).toBe('hello')
  })

  it('should add lines via sendHex', async () => {
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', '', '010203'))

    await store.sendHex('ch1', '010203')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].hex).toBe('010203')
  })

  it('should filter by channel', async () => {
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSend('ch1', 'data1'))
      .mockResolvedValueOnce(mockSend('ch2', 'data2'))
      .mockResolvedValueOnce(mockSend('ch1', 'data3'))

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
    const store = await readyTerminal()
    const conn = useConnectionStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSend('tcp_server-0.0.0.0:5000', 'server'))
      .mockResolvedValueOnce(mockSend('tcp_client-192.168.1.5:12345', 'client1'))
      .mockResolvedValueOnce(mockSend('tcp_client-192.168.1.6:12345', 'client2'))
      .mockResolvedValueOnce(mockSend('serial-COM3', 'serial'))

    conn.channelList.push({
      channelId: 'tcp_server-0.0.0.0:5000',
      connected: true,
      transportType: 'tcp_server',
      portName: '0.0.0.0:5000',
      clients: [],
    })
    conn.channelList.push({
      channelId: 'tcp_client-192.168.1.5:12345',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '192.168.1.5:12345',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })
    conn.channelList.push({
      channelId: 'tcp_client-192.168.1.6:12345',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '192.168.1.6:12345',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })

    await store.sendText('tcp_server-0.0.0.0:5000', 'server')
    await store.sendText('tcp_client-192.168.1.5:12345', 'client1')
    await store.sendText('tcp_client-192.168.1.6:12345', 'client2')
    await store.sendText('serial-COM3', 'serial')

    store.activeChannelId = 'tcp_server-0.0.0.0:5000'
    expect(store.filteredLines).toHaveLength(3)

    store.activeChannelId = 'tcp_client-192.168.1.5:12345'
    expect(store.filteredLines).toHaveLength(1)

    store.activeChannelId = 'serial-COM3'
    expect(store.filteredLines).toHaveLength(1)
  })

  it('should count rx and tx correctly', async () => {
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke)
      .mockResolvedValueOnce(mockSend('ch1', 'rx1'))
      .mockResolvedValueOnce(mockSend('ch1', 'rx2'))
      .mockResolvedValueOnce(mockSend('ch1', 'tx1'))

    await store.sendText('ch1', 'rx1')
    await store.sendText('ch1', 'rx2')
    await store.sendText('ch1', 'tx1')

    expect(store.txCount).toBe(3)
  })

  it('should dedupe same packet via rxHub', async () => {
    const store = await readyTerminal()
    const hub = useRxHub()
    hub.pushRecord({
      direction: 'rx', channelId: 'ch1', hex: 'e4b8ad', text: '中',
      bytes: [0xe4, 0xb8, 0xad], timestamp: '12:00:00.001', seq: 7,
    })
    hub.pushRecord({
      direction: 'rx', channelId: 'ch1', hex: 'e4b8ad', text: '中',
      bytes: [0xe4, 0xb8, 0xad], timestamp: '12:00:00.001',
    })
    expect(store.lines).toHaveLength(1)
  })

  it('should dedupe by seq even when text differs', async () => {
    const store = await readyTerminal()
    const hub = useRxHub()
    hub.pushRecord({
      direction: 'rx', channelId: 'ch1', hex: 'e4b8ad', text: '中',
      bytes: [0xe4, 0xb8, 0xad], timestamp: '12:00:00.001', seq: 9,
    })
    hub.pushRecord({
      direction: 'rx', channelId: 'ch1', hex: 'e4b8ad', text: '�',
      bytes: [0xe4, 0xb8, 0xad], timestamp: '12:00:00.001', seq: 9,
    })
    expect(store.lines).toHaveLength(1)
  })

  it('should prefer event subscription', async () => {
    const store = await readyTerminal()
    expect(store.eventDriven).toBe(true)
    store.dispose()
  })

  it('should display text based on encoding', async () => {
    const store = await readyTerminal()
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
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValueOnce(mockSend('ch1', 'data'))
    await store.sendText('ch1', 'data')
    expect(store.lines).toHaveLength(1)

    vi.mocked(invoke).mockResolvedValueOnce(true)
    await store.clear()

    expect(store.lines).toEqual([])
  })

  it('should sendText with hex encoding', async () => {
    const store = await readyTerminal()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', '', '010203'))

    await store.sendText('ch1', '010203', 'none', 'hex')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].hex).toBe('010203')
  })

  it('should filter rx data by channel via hub', async () => {
    const store = await readyTerminal()
    const hub = useRxHub()

    hub.pushRecord({
      direction: 'rx', channelId: 'ch1', hex: '48656c6c6f', text: 'Hello',
      bytes: [72, 101, 108, 108, 111], timestamp: '12:00:00.001', seq: 1,
    })
    hub.pushRecord({
      direction: 'rx', channelId: 'ch2', hex: '576f726c64', text: 'World',
      bytes: [87, 111, 114, 108, 100], timestamp: '12:00:00.002', seq: 2,
    })
    hub.pushRecord({
      direction: 'tx', channelId: 'ch1', hex: '', text: 'tx-data',
      bytes: [], timestamp: '12:00:00.003', seq: 3,
    })

    store.activeChannelId = 'ch1'
    expect(store.filteredLines).toHaveLength(2)
    expect(store.rxCount).toBe(1)
    expect(store.txCount).toBe(1)
  })
})
