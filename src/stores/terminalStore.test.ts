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
import { useConnectionStore } from '@/stores/connectionStore'

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
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', 'hello'))

    await store.sendText('ch1', 'hello', 'none')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].channelId).toBe('ch1')
    expect(store.lines[0].text).toBe('hello')
  })

  it('should add lines via sendHex', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', '', '010203'))

    await store.sendHex('ch1', '010203')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].hex).toBe('010203')
  })

  it('should filter by channel', async () => {
    const store = useTerminalStore()
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
    const store = useTerminalStore()
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
    const store = useTerminalStore()
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

  it('should dedupe same packet from event and poll', () => {
    const store = useTerminalStore()
    store.addLine('rx', 'ch1', 'e4b8ad', '中', [0xe4, 0xb8, 0xad], '12:00:00.001', 7)
    store.addLine('rx', 'ch1', 'e4b8ad', '中', [0xe4, 0xb8, 0xad], '12:00:00.001')
    expect(store.lines).toHaveLength(1)
  })

  it('should dedupe by seq even when text differs', () => {
    const store = useTerminalStore()
    store.addLine('rx', 'ch1', 'e4b8ad', '中', [0xe4, 0xb8, 0xad], '12:00:00.001', 9)
    store.addLine('rx', 'ch1', 'e4b8ad', '�', [0xe4, 0xb8, 0xad], '12:00:00.001', 9)
    expect(store.lines).toHaveLength(1)
  })

  it('should prefer event subscription and skip polling', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    const { onRxData } = await import('@/api/events')
    vi.mocked(invoke).mockResolvedValue({ packets: [], total: 0 })
    vi.mocked(onRxData).mockResolvedValue(() => {})

    await store.init()
    expect(store.eventDriven).toBe(true)
    store.dispose()
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
    vi.mocked(invoke).mockResolvedValueOnce(mockSend('ch1', 'data'))
    await store.sendText('ch1', 'data')
    expect(store.lines).toHaveLength(1)

    vi.mocked(invoke).mockResolvedValueOnce(true)
    await store.clear()

    expect(store.lines).toEqual([])
  })

  it('should sendText with hex encoding', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', '', '010203'))

    await store.sendText('ch1', '010203', 'none', 'hex')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].direction).toBe('tx')
    expect(store.lines[0].hex).toBe('010203')
    expect(invoke).toHaveBeenCalledWith('send_data', {
      request: { channel_id: 'ch1', data: '010203', format: 'hex', suffix: 'none' },
    })
  })

  it('should sendText with utf-8 encoding', async () => {
    const store = useTerminalStore()
    const { invoke } = await import('@/api/tauri')
    vi.mocked(invoke).mockResolvedValue(mockSend('ch1', 'hello'))

    await store.sendText('ch1', 'hello', 'lf', 'utf-8')

    expect(store.lines).toHaveLength(1)
    expect(store.lines[0].text).toBe('hello')
    expect(invoke).toHaveBeenCalledWith('send_data', {
      request: { channel_id: 'ch1', data: 'hello', format: 'text', suffix: 'lf' },
    })
  })

  it('should filter rx data by channel', () => {
    const store = useTerminalStore()

    store.addLine('rx', 'ch1', '48656c6c6f', 'Hello', [72, 101, 108, 108, 111])
    store.addLine('rx', 'ch2', '576f726c64', 'World', [87, 111, 114, 108, 100])
    store.addLine('tx', 'ch1', '', 'tx-data', [])

    store.activeChannelId = 'ch1'
    expect(store.filteredLines).toHaveLength(2)
    expect(store.rxCount).toBe(1)
    expect(store.txCount).toBe(1)

    store.activeChannelId = ''
    expect(store.filteredLines).toHaveLength(3)
    expect(store.rxCount).toBe(2)
    expect(store.txCount).toBe(1)
  })

  it('should filter tcp server clients by parent', () => {
    const conn = useConnectionStore()
    const store = useTerminalStore()

    conn.channelList.push({
      channelId: 'tcp_server-0.0.0.0:5000',
      connected: true,
      transportType: 'tcp_server',
      portName: '0.0.0.0:5000',
      clients: [],
    })
    conn.channelList.push({
      channelId: 'tcp_client-127.0.0.1:1',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:1',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })
    conn.channelList.push({
      channelId: 'tcp_client-127.0.0.1:2',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:2',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:6000',
    })

    store.addLine('rx', 'tcp_client-127.0.0.1:1', 'aa', 'a', [0xaa])
    store.addLine('rx', 'tcp_client-127.0.0.1:2', 'bb', 'b', [0xbb])

    store.activeChannelId = 'tcp_server-0.0.0.0:5000'
    expect(store.filteredLines).toHaveLength(1)
    expect(store.filteredLines[0].channelId).toBe('tcp_client-127.0.0.1:1')

    store.activeChannelId = 'tcp_client-127.0.0.1:1'
    expect(store.filteredLines).toHaveLength(1)
  })

  it('should convert hex string to bytes', () => {
    const store = useTerminalStore()
    // 测试 hexToBytes 通过 displayText 的 hex 模式
    const line = {
      id: 1,
      timestamp: '12:00:00.000',
      direction: 'rx' as const,
      channelId: 'ch1',
      hex: 'deadbeef',
      text: '',
      rawBytes: [0xde, 0xad, 0xbe, 0xef],
    }

    store.encoding = 'hex'
    expect(store.displayText(line)).toBe('de ad be ef')

    store.encoding = 'utf-8'
    // rawBytes 不是有效 UTF-8，但 text 为空所以返回空
    expect(store.displayText(line)).toBe('')
  })
})
