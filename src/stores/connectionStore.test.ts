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

import { setActivePinia, createPinia } from 'pinia'
import { useConnectionStore } from '@/stores/connectionStore'
import { invoke } from '@/api/tauri'

describe('connectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should initialize with empty state', () => {
    const store = useConnectionStore()
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

    expect(store.channels.size).toBe(1)
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

  it('should disconnect channel', async () => {
    const store = useConnectionStore()
    store.channels.set('ch1', { channelId: 'ch1', connected: true, transportType: 'serial', portName: 'COM3', clients: [] })
    vi.mocked(invoke).mockResolvedValue({ success: true, message: 'ok', channel_id: 'ch1' })

    await store.disconnect('ch1')

    expect(store.channels.has('ch1')).toBe(false)
    expect(invoke).toHaveBeenCalledWith('disconnect', { channelId: 'ch1' })
  })

  it('should disconnect all', async () => {
    const store = useConnectionStore()
    store.channels.set('ch1', { channelId: 'ch1', connected: true, transportType: 'serial', portName: 'COM3', clients: [] })
    store.channels.set('ch2', { channelId: 'ch2', connected: true, transportType: 'tcp_client', portName: '192.168.1.1:5000', clients: [] })
    vi.mocked(invoke).mockResolvedValue({ success: true, message: 'ok', channel_id: '' })

    await store.disconnectAll()

    expect(store.channels.size).toBe(0)
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
})
