import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'

export const useConnectionStore = defineStore('connection', () => {
  const connected = ref(false)
  const transportType = ref('')
  const portName = ref('')
  const ports = ref<Array<{ name: string; description: string }>>([])

  async function connect(config: {
    conn_type: string
    port?: string
    baud_rate?: number
    host?: string
    tcp_port?: number
  }) {
    const result = await invoke<{ success: boolean; message: string }>('connect', { request: config })
    if (result.success) {
      connected.value = true
      await refreshStatus()
    }
    return result
  }

  async function disconnect() {
    await invoke('disconnect')
    connected.value = false
    transportType.value = ''
    portName.value = ''
  }

  async function refreshStatus() {
    const status = await invoke<{
      connected: boolean
      transport_type: string
      port_name: string
    }>('get_connection_status')
    connected.value = status.connected
    transportType.value = status.transport_type
    portName.value = status.port_name
  }

  async function loadPorts() {
    ports.value = await invoke<Array<{ name: string; description: string }>>('list_ports')
  }

  return { connected, transportType, portName, ports, connect, disconnect, refreshStatus, loadPorts }
})
