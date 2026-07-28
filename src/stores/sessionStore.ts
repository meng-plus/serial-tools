import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'

export interface Packet {
  timestamp: string
  direction: string
  source: string
  bytes: number[]
  hex: string
  text: string
}

export const useSessionStore = defineStore('session', () => {
  const packets = ref<Packet[]>([])
  const totalPackets = ref(0)

  async function fetchPackets(limit = 500) {
    const result = await invoke<{ packets: Packet[]; total: number }>('get_packets', { limit })
    packets.value = result.packets
    totalPackets.value = result.total
  }

  async function sendText(text: string, suffix = 'none') {
    await invoke('send_data', { request: { data: text, format: 'text', suffix } })
  }

  async function sendHex(hex: string) {
    await invoke('send_data', { request: { data: hex, format: 'hex', suffix: 'none' } })
  }

  async function clearPackets() {
    await invoke('clear_packets')
    packets.value = []
    totalPackets.value = 0
  }

  return { packets, totalPackets, fetchPackets, sendText, sendHex, clearPackets }
})
