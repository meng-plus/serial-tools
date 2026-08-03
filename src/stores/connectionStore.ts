import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'
import { onConnectionChanged, type ConnectionEventPayload } from '@/api/events'

export interface ChannelInfo {
  channelId: string
  connected: boolean
  transportType: string
  portName: string
  clients: string[]
  parentChannelId?: string
  /** 用户自定义别名；空则回退到 portName / channelId */
  alias?: string
}

const ALIAS_STORAGE_KEY = 'serial-tools-channel-aliases'

function loadAliasMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALIAS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

function saveAliasMap(map: Record<string, string>) {
  localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(map))
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
  const aliasByChannelId = ref<Record<string, string>>(loadAliasMap())

  const channels = computed(() => toChannelMap(channelList.value))
  const connectedChannels = computed(() => channelList.value.filter(c => c.connected))
  const hasConnection = computed(() => connectedChannels.value.length > 0)
  const serverChannels = computed(() =>
    channelList.value.filter(c => c.transportType === 'tcp_server')
  )
  const topLevelChannels = computed(() =>
    channelList.value.filter(c => c.transportType !== 'tcp_server_client')
  )

  function attachAlias(info: ChannelInfo): ChannelInfo {
    const alias = aliasByChannelId.value[info.channelId]
    return alias ? { ...info, alias } : { ...info, alias: undefined }
  }

  /** 无别名时的默认显示名 */
  function channelBaseName(ch: ChannelInfo): string {
    if (ch.transportType === 'tcp_server_client') return `Client ${ch.portName}`
    if (ch.transportType === 'serial') return ch.portName || ch.channelId
    return ch.portName || ch.channelId
  }

  /** 侧栏/标题用显示名：别名优先 */
  function channelDisplayName(ch: ChannelInfo): string {
    if (ch.alias?.trim()) return ch.alias.trim()
    return channelBaseName(ch)
  }

  function setChannelAlias(channelId: string, alias: string) {
    const trimmed = alias.trim()
    const next = { ...aliasByChannelId.value }
    if (trimmed) next[channelId] = trimmed
    else delete next[channelId]
    aliasByChannelId.value = next
    saveAliasMap(next)
    const idx = channelList.value.findIndex(c => c.channelId === channelId)
    if (idx >= 0) {
      const cur = channelList.value[idx]
      channelList.value.splice(idx, 1, {
        ...cur,
        alias: trimmed || undefined,
      })
    }
  }

  function upsertChannel(info: ChannelInfo) {
    const merged = attachAlias(info)
    const idx = channelList.value.findIndex(c => c.channelId === merged.channelId)
    if (idx >= 0) {
      const prev = channelList.value[idx]
      channelList.value.splice(idx, 1, {
        ...prev,
        ...merged,
        clients: merged.clients?.length ? merged.clients : (merged.clients === undefined ? prev.clients : merged.clients),
        parentChannelId: merged.parentChannelId ?? prev.parentChannelId,
        alias: merged.alias ?? prev.alias,
      })
    } else {
      channelList.value.push(merged)
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
        channelList.value.push(attachAlias({
          channelId: id,
          connected: true,
          transportType: 'tcp_server_client',
          portName: addr,
          clients: [],
          parentChannelId: serverChannelId,
        }))
      } else {
        const cidx = channelList.value.findIndex(c => c.channelId === id)
        if (cidx >= 0) {
          const c = channelList.value[cidx]
          channelList.value.splice(cidx, 1, attachAlias({
            ...c,
            connected: true,
            parentChannelId: c.parentChannelId || serverChannelId,
          }))
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

      // 对端发起的断开：区分优雅 / 异常（本端主动由按钮 handler 提示，避免重复）
      if (payload.reason === 'remote') {
        message.info(`${payload.port_name || payload.channel_id} 已断开`)
      } else if (payload.reason === 'error') {
        message.error(`${payload.port_name || payload.channel_id} 服务异常`)
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
    byte_timeout_ms?: number
    frame_timeout_ms?: number
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
      return attachAlias({
        channelId: s.channel_id,
        connected: s.connected,
        transportType: s.transport_type || existing?.transportType || '',
        portName: s.port_name,
        clients: s.clients || [],
        parentChannelId: s.parent_channel_id || existing?.parentChannelId,
      })
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
    getServerClients, channelBaseName, channelDisplayName, setChannelAlias,
    init, dispose, connect, disconnect, disconnectClient, disconnectAll,
    listServerClients, refreshStatus, loadPorts,
  }
})
