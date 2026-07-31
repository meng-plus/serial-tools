import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@/api'
import { onConnectionChanged, type ConnectionEventPayload } from '@/api/events'

export interface ChannelInfo {
  channelId: string
  connected: boolean
  transportType: string
  portName: string
  clients: string[]
}

export interface PortInfo {
  name: string
  description: string
}

export const useConnectionStore = defineStore('connection', () => {
  const channels = ref<Map<string, ChannelInfo>>(new Map())
  const ports = ref<PortInfo[]>([])

  const connectedChannels = computed(() =>
    Array.from(channels.value.values()).filter(c => c.connected)
  )
  const hasConnection = computed(() => connectedChannels.value.length > 0)

  // TCP Server 列表（不含客户端子通道）
  const serverChannels = computed(() =>
    Array.from(channels.value.values()).filter(c => c.transportType === 'tcp_server')
  )

  // 获取某个 TCP Server 的客户端通道
  function getServerClients(_serverChannelId: string): ChannelInfo[] {
    const prefix = 'tcp_client-'
    return Array.from(channels.value.values()).filter(
      c => c.transportType === 'tcp_server_client' && c.channelId.startsWith(prefix)
    )
  }

  let unlisten: (() => void) | null = null
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  async function init() {
    await refreshStatus()
    await loadPorts()
    unlisten = await onConnectionChanged((payload: ConnectionEventPayload) => {
      if (payload.connected) {
        channels.value.set(payload.channel_id, {
          channelId: payload.channel_id,
          connected: true,
          transportType: payload.transport_type,
          portName: payload.port_name,
          clients: [],
        })
      } else {
        channels.value.delete(payload.channel_id)
      }
    })
    // 定期刷新状态，以获取新连接的 TCP Server 客户端
    refreshTimer = setInterval(refreshStatus, 3000)
  }

  function dispose() {
    unlisten?.()
    unlisten = null
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  async function connect(config: {
    conn_type: string
    port?: string
    baud_rate?: number
    host?: string
    tcp_port?: number
    half_duplex?: boolean
  }) {
    const result = await invoke<{ success: boolean; message: string; channel_id: string }>(
      'connect', { request: config }
    )
    if (result.success) {
      await refreshStatus()
    }
    return result
  }

  async function disconnect(channelId: string) {
    await invoke('disconnect', { channelId })
    channels.value.delete(channelId)
  }

  async function disconnectAll() {
    await invoke('disconnect_all')
    channels.value.clear()
  }

  async function refreshStatus() {
    const status = await invoke<Array<{
      connected: boolean
      channel_id: string
      transport_type: string
      port_name: string
      clients: string[]
    }>>('get_connection_status')
    // 合并而非清空：保留由 onConnectionChanged 实时更新的 tcp_server_client 条目
    const existingClientIds = new Set<string>()
    for (const s of status) {
      const existing = channels.value.get(s.channel_id)
      channels.value.set(s.channel_id, {
        channelId: s.channel_id,
        connected: s.connected,
        transportType: existing?.transportType || s.transport_type,
        portName: s.port_name,
        clients: s.clients || [],
      })
      existingClientIds.add(s.channel_id)
    }
    // 移除后端已不存在、且不是由 connection-changed 事件实时管理的客户端通道
    // （tcp_server_client 由事件管理，此处不删除）
    for (const [id, info] of channels.value) {
      if (!existingClientIds.has(id) && info.transportType !== 'tcp_server_client') {
        channels.value.delete(id)
      }
    }
  }

  async function loadPorts() {
    ports.value = await invoke<PortInfo[]>('list_ports')
  }

  return {
    channels, ports, connectedChannels, hasConnection, serverChannels,
    getServerClients,
    init, dispose, connect, disconnect, disconnectAll, refreshStatus, loadPorts,
  }
})
