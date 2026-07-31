import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/tauri', () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}))

vi.mock('@/api/events', () => ({
  onConnectionChanged: vi.fn(() => Promise.resolve(() => {})),
  onRxData: vi.fn(() => Promise.resolve(() => {})),
  onLogEntry: vi.fn(() => Promise.resolve(() => {})),
}))

const messageInfo = vi.fn()
const messageError = vi.fn()
vi.mock('ant-design-vue', () => ({
  message: {
    info: (...args: unknown[]) => messageInfo(...args),
    error: (...args: unknown[]) => messageError(...args),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

import { setActivePinia, createPinia } from 'pinia'
import { useConnectionStore } from '@/stores/connectionStore'
import { invoke } from '@/api/tauri'
import { onConnectionChanged } from '@/api/events'

describe('connectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should initialize with empty state', () => {
    const store = useConnectionStore()
    expect(store.channelList).toEqual([])
    expect(store.channels.size).toBe(0)
    expect(store.ports).toEqual([])
    expect(store.hasConnection).toBe(false)
  })

  it('should add channel on refreshStatus', async () => {
    const store = useConnectionStore()
    vi.mocked(invoke).mockResolvedValue([
      { connected: true, channel_id: 'serial-COM3', transport_type: 'serial', port_name: 'COM3', clients: [] },
    ])

    await store.refreshStatus()

    expect(store.channelList).toHaveLength(1)
    expect(store.channels.get('serial-COM3')).toBeDefined()
    expect(store.channels.get('serial-COM3')?.transportType).toBe('serial')
    expect(store.hasConnection).toBe(true)
  })

  it('should load ports', async () => {
    const store = useConnectionStore()
    vi.mocked(invoke).mockResolvedValue([
      { name: 'COM1', description: 'USB Serial' },
      { name: 'COM3', description: 'Bluetooth' },
    ])

    await store.loadPorts()

    expect(store.ports).toHaveLength(2)
    expect(store.ports[0].name).toBe('COM1')
  })

  it('should connect and refresh', async () => {
    const store = useConnectionStore()
    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true, message: 'ok', channel_id: 'serial-COM3' })
      .mockResolvedValueOnce([
        { connected: true, channel_id: 'serial-COM3', transport_type: 'serial', port_name: 'COM3', clients: [] },
      ])

    const result = await store.connect({ conn_type: 'serial', port: 'COM3', baud_rate: 115200 })

    expect(result.success).toBe(true)
    expect(invoke).toHaveBeenCalledWith('connect', { request: { conn_type: 'serial', port: 'COM3', baud_rate: 115200 } })
  })

  it('should disconnect channel and clear local list', async () => {
    const store = useConnectionStore()
    store.channelList.push({
      channelId: 'tcp_server-0.0.0.0:5000',
      connected: true,
      transportType: 'tcp_server',
      portName: '0.0.0.0:5000',
      clients: ['127.0.0.1:1'],
    })
    store.channelList.push({
      channelId: 'tcp_client-127.0.0.1:1',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:1',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })
    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true, message: 'ok', channel_id: 'tcp_server-0.0.0.0:5000' })
      .mockResolvedValueOnce([])

    await store.disconnect('tcp_server-0.0.0.0:5000')

    expect(store.channelList).toHaveLength(0)
    expect(invoke).toHaveBeenCalledWith('disconnect', { channelId: 'tcp_server-0.0.0.0:5000' })
  })

  it('should disconnect all', async () => {
    const store = useConnectionStore()
    store.channelList.push({ channelId: 'ch1', connected: true, transportType: 'serial', portName: 'COM3', clients: [] })
    store.channelList.push({ channelId: 'ch2', connected: true, transportType: 'tcp_client', portName: '192.168.1.1:5000', clients: [] })
    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true, message: 'ok', channel_id: '' })
      .mockResolvedValueOnce([])

    await store.disconnectAll()

    expect(store.channelList).toHaveLength(0)
  })

  it('should compute connectedChannels correctly', async () => {
    const store = useConnectionStore()
    vi.mocked(invoke).mockResolvedValue([
      { connected: true, channel_id: 'ch1', transport_type: 'serial', port_name: 'COM3', clients: [] },
      { connected: false, channel_id: 'ch2', transport_type: 'tcp_client', port_name: '10.0.0.1:5000', clients: [] },
    ])

    await store.refreshStatus()

    expect(store.connectedChannels).toHaveLength(1)
    expect(store.connectedChannels[0].channelId).toBe('ch1')
  })

  it('should filter server clients by parent', () => {
    const store = useConnectionStore()
    store.channelList.push({
      channelId: 'tcp_server-0.0.0.0:5000',
      connected: true,
      transportType: 'tcp_server',
      portName: '0.0.0.0:5000',
      clients: ['127.0.0.1:12345'],
    })
    store.channelList.push({
      channelId: 'tcp_client-127.0.0.1:12345',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:12345',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })
    store.channelList.push({
      channelId: 'tcp_client-127.0.0.1:9999',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:9999',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:6000',
    })

    const clients = store.getServerClients('tcp_server-0.0.0.0:5000')
    expect(clients).toHaveLength(1)
    expect(clients[0].channelId).toBe('tcp_client-127.0.0.1:12345')
    expect(store.topLevelChannels).toHaveLength(1)
  })

  it('should fallback to server.clients when nested channel missing', () => {
    const store = useConnectionStore()
    store.channelList.push({
      channelId: 'tcp_server-0.0.0.0:5000',
      connected: true,
      transportType: 'tcp_server',
      portName: '0.0.0.0:5000',
      clients: ['10.0.0.2:4000', '10.0.0.3:4001'],
    })

    const clients = store.getServerClients('tcp_server-0.0.0.0:5000')
    expect(clients).toHaveLength(2)
    expect(clients[0].channelId).toBe('tcp_client-10.0.0.2:4000')
    expect(clients[0].parentChannelId).toBe('tcp_server-0.0.0.0:5000')
  })

  it('should disconnect client via disconnect_client', async () => {
    const store = useConnectionStore()
    store.channelList.push({
      channelId: 'tcp_client-127.0.0.1:1',
      connected: true,
      transportType: 'tcp_server_client',
      portName: '127.0.0.1:1',
      clients: [],
      parentChannelId: 'tcp_server-0.0.0.0:5000',
    })
    vi.mocked(invoke)
      .mockResolvedValueOnce({ success: true, message: 'ok', channel_id: 'tcp_client-127.0.0.1:1' })
      .mockResolvedValueOnce([])

    await store.disconnectClient('tcp_client-127.0.0.1:1')
    expect(invoke).toHaveBeenCalledWith('disconnect_client', { channelId: 'tcp_client-127.0.0.1:1' })
    expect(store.channelList.find(c => c.channelId === 'tcp_client-127.0.0.1:1')).toBeUndefined()
  })

  it('should toast 已断开 on remote disconnect and 服务异常 on error', async () => {
    const store = useConnectionStore()
    let handler: ((p: any) => void) | null = null
    vi.mocked(onConnectionChanged).mockImplementation(async (h) => {
      handler = h
      return () => {}
    })
    vi.mocked(invoke).mockResolvedValue([])
    await store.init()

    store.channelList.push({
      channelId: 'tcp-127.0.0.1:5000',
      connected: true,
      transportType: 'tcp_client',
      portName: '127.0.0.1:5000',
      clients: [],
    })

    handler!({
      channel_id: 'tcp-127.0.0.1:5000',
      connected: false,
      transport_type: 'tcp_client',
      port_name: '127.0.0.1:5000',
      reason: 'remote',
    })
    expect(messageInfo).toHaveBeenCalledWith('127.0.0.1:5000 已断开')

    store.channelList.push({
      channelId: 'tcp-127.0.0.1:5001',
      connected: true,
      transportType: 'tcp_client',
      portName: '127.0.0.1:5001',
      clients: [],
    })
    handler!({
      channel_id: 'tcp-127.0.0.1:5001',
      connected: false,
      transport_type: 'tcp_client',
      port_name: '127.0.0.1:5001',
      reason: 'error',
    })
    expect(messageError).toHaveBeenCalledWith('127.0.0.1:5001 服务异常')

    // 本端主动断开不弹对端提示
    messageInfo.mockClear()
    messageError.mockClear()
    handler!({
      channel_id: 'tcp-x',
      connected: false,
      transport_type: 'tcp_client',
      port_name: 'x',
      reason: 'local',
    })
    expect(messageInfo).not.toHaveBeenCalled()
    expect(messageError).not.toHaveBeenCalled()
  })
})
