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
  parentChannelId?: string
}

export interface PortInfo {
  name: string
  description: string
}

export interface ServerClientInfo {
  addr: string
  channelId: string
  connected: boolean
}

function toChannelMap(list: ChannelInfo[]): Map<string, ChannelInfo> {
  return new Map(list.map(c => [c.channelId, c]))
}

export const useConnectionStore = defineStore('connection', () => {
  const channelList = ref<ChannelInfo[]>([])
  const ports = ref<PortInfo[]>([])

  const channels = computed(() => toChannelMap(channelList.value))
  const connectedChannels = computed(() => channelList.value.filter(c => c.connected))
  const hasConnection = computed(() => connectedChannels.value.length > 0)
  const serverChannels = computed(() =>
    channelList.value.filter(c => c.transportType === 'tcp_server')
  )
  const topLevelChannels = computed(() =>
    channelList.value.filter(c => c.transportType !== 'tcp_server_client')
  )

  function upsertChannel(info: ChannelInfo) {
    const idx = channelList.value.findIndex(c => c.channelId === info.channelId)
    if (idx >= 0) {
      const prev = channelList.value[idx]
      channelList.value.splice(idx, 1, {
        ...prev,
        ...info,
        clients: info.clients?.length ? info.clients : (info.clients === undefined ? prev.clients : info.clients),
        parentChannelId: info.parentChannelId ?? prev.parentChannelId,
      })
    } else {
      channelList.value.push(info)
    }
  }

  function removeChannelLocal(channelId: string) {
    channelList.value = channelList.value.filter(c => {
      if (c.channelId === channelId) return false
      if (c.parentChannelId === channelId) return false
      return true
    })
  }

  function applyServerClients(serverChannelId: string, clients: string[]) {
    const idx = channelList.value.findIndex(c => c.channelId === serverChannelId)
    if (idx >= 0) {
      const cur = channelList.value[idx]
      channelList.value.splice(idx, 1, { ...cur, clients: [...clients] })
    }
    // 确保每个地址都有可见的子通道条目（事件驱动，不等轮询）
    for (const addr of clients) {
      const id = `tcp_client-${addr}`
      if (!channelList.value.some(c => c.channelId === id)) {
        channelList.value.push({
          channelId: id,
          connected: true,
          transportType: 'tcp_server_client',
          portName: addr,
          clients: [],
          parentChannelId: serverChannelId,
        })
      } else {
        const cidx = channelList.value.findIndex(c => c.channelId === id)
        if (cidx >= 0) {
          const c = channelList.value[cidx]
          channelList.value.splice(cidx, 1, {
            ...c,
            connected: true,
            parentChannelId: c.parentChannelId || serverChannelId,
          })
        }
      }
    }
    // 移除不在清单中的幽灵客户端
    channelList.value = channelList.value.filter(c => {
      if (c.parentChannelId !== serverChannelId) return true
      return clients.includes(c.portName) || clients.some(a => c.channelId === `tcp_client-${a}`)
    })
  }

  function getServerClients(serverChannelId: string): ChannelInfo[] {
    const nested = channelList.value.filter(
      c => c.transportType === 'tcp_server_client' && c.parentChannelId === serverChannelId
    )
    if (nested.length > 0) return nested

    const server = channelList.value.find(c => c.channelId === serverChannelId)
    if (!server?.clients?.length) return []

    return server.clients.map(addr => {
      const id = `tcp_client-${addr}`
      const existing = channelList.value.find(c => c.channelId === id)
      if (existing) {
        return { ...existing, parentChannelId: existing.parentChannelId || serverChannelId }
      }
      return {
        channelId: id,
        connected: true,
        transportType: 'tcp_server_client',
        portName: addr,
        clients: [],
        parentChannelId: serverChannelId,
      }
    })
  }

  let unlisten: (() => void) | null = null

  function handleConnectionEvent(payload: ConnectionEventPayload) {
    const parentId = payload.parent_channel_id || undefined
    if (payload.connected) {
      upsertChannel({
        channelId: payload.channel_id,
        connected: true,
        transportType: payload.transport_type || 'unknown',
        portName: payload.port_name,
        clients: payload.server_clients || [],
        parentChannelId: parentId,
      })
    } else {
      removeChannelLocal(payload.channel_id)
      // 从父 Server 的 clients 移除
      if (parentId && payload.port_name) {
        const parent = channelList.value.find(c => c.channelId === parentId)
        if (parent) {
          applyServerClients(
            parentId,
            parent.clients.filter(a => a !== payload.port_name)
          )
        }
      }
    }

    // 事件携带的 Server 客户端清单 — 主动刷新 UI，不依赖轮询
    if (payload.server_clients) {
      const serverId =
        payload.transport_type === 'tcp_server'
          ? payload.channel_id
          : parentId
      if (serverId) {
        applyServerClients(serverId, payload.server_clients)
      }
    }
  }

  async function init() {
    await refreshStatus()
    await loadPorts()
    unlisten = await onConnectionChanged(handleConnectionEvent)
  }

  function dispose() {
    unlisten?.()
    unlisten = null
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
    removeChannelLocal(channelId)
    try {
      await invoke('disconnect', { channelId })
    } finally {
      await refreshStatus()
    }
  }

  async function disconnectClient(channelId: string) {
    removeChannelLocal(channelId)
    try {
      await invoke('disconnect_client', { channelId })
    } finally {
      await refreshStatus()
    }
  }

  async function listServerClients(serverChannelId: string): Promise<ServerClientInfo[]> {
    const list = await invoke<Array<{ addr: string; channel_id: string; connected: boolean }>>(
      'list_server_clients',
      { serverChannelId }
    )
    return list.map(c => ({
      addr: c.addr,
      channelId: c.channel_id,
      connected: c.connected,
    }))
  }

  async function disconnectAll() {
    channelList.value = []
    try {
      await invoke('disconnect_all')
    } finally {
      await refreshStatus()
    }
  }

  async function refreshStatus() {
    const status = await invoke<Array<{
      connected: boolean
      channel_id: string
      transport_type: string
      port_name: string
      clients: string[]
      parent_channel_id?: string | null
    }>>('get_connection_status')

    const prev = toChannelMap(channelList.value)
    const next: ChannelInfo[] = status.map(s => {
      const existing = prev.get(s.channel_id)
      return {
        channelId: s.channel_id,
        connected: s.connected,
        transportType: s.transport_type || existing?.transportType || '',
        portName: s.port_name,
        clients: s.clients || [],
        parentChannelId: s.parent_channel_id || existing?.parentChannelId,
      }
    })

    for (const ch of next) {
      if (ch.transportType !== 'tcp_server' || !ch.clients?.length) continue
      for (const addr of ch.clients) {
        const clientId = `tcp_client-${addr}`
        const client = next.find(c => c.channelId === clientId)
        if (client && !client.parentChannelId) {
          client.parentChannelId = ch.channelId
        }
      }
    }

    channelList.value = next
  }

  async function loadPorts() {
    ports.value = await invoke<PortInfo[]>('list_ports')
  }

  return {
    channels, channelList, ports, connectedChannels, hasConnection, serverChannels, topLevelChannels,
    getServerClients,
    init, dispose, connect, disconnect, disconnectClient, disconnectAll,
    listServerClients, refreshStatus, loadPorts,
  }
})
