import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@/api'
import { onRxData, type RxEventPayload } from '@/api/events'

export interface TerminalLine {
  id: number
  timestamp: string
  direction: 'rx' | 'tx'
  channelId: string
  hex: string
  text: string
  rawBytes: number[]
}

export type Encoding = 'utf-8' | 'gbk' | 'hex'

export interface DisplayConfig {
  showTimestamp: boolean
  showDirection: boolean
  showChannel: boolean
}

export const useTerminalStore = defineStore('terminal', () => {
  const lines = ref<TerminalLine[]>([])
  const encoding = ref<Encoding>('utf-8')
  const maxLines = ref(10000)
  const displayConfig = ref<DisplayConfig>({
    showTimestamp: true,
    showDirection: true,
    showChannel: true,
  })
  let lineIdCounter = 0
  let unlisten: (() => void) | null = null

  const activeChannelId = ref<string>('')

  const filteredLines = computed(() => {
    if (!activeChannelId.value) return lines.value
    const selected = activeChannelId.value
    // TCP Server 通道过滤：显示 server 自身及其所有 client 的数据
    if (selected.startsWith('tcp_server-')) {
      const prefix = 'tcp_client-'
      return lines.value.filter(l =>
        l.channelId === selected || l.channelId.startsWith(prefix)
      )
    }
    // 选中具体 TCP Server 客户端：只显示该客户端数据
    if (selected.startsWith('tcp_client-')) {
      return lines.value.filter(l => l.channelId === selected)
    }
    return lines.value.filter(l => l.channelId === selected)
  })

  const rxCount = computed(() =>
    filteredLines.value.filter(l => l.direction === 'rx').length
  )
  const txCount = computed(() =>
    filteredLines.value.filter(l => l.direction === 'tx').length
  )

  async function init() {
    try {
      const result = await invoke<{ packets: Array<{
        timestamp: string; direction: string; channel_id: string;
        bytes: number[]; hex: string; text: string
      }>; total: number }>('get_packets', { limit: 500 })
      for (const pkt of result.packets) {
        addLine(pkt.direction as 'rx' | 'tx', pkt.channel_id, pkt.hex, pkt.text, pkt.bytes, pkt.timestamp)
      }
    } catch { /* ignore */ }

    unlisten = await onRxData((payload: RxEventPayload) => {
      // 从 bytes_hex 解析原始字节（后端发送 hex 字符串，避免序列化歧义）
      const rawBytes = hexToBytes(payload.bytes_hex || payload.hex)
      addLine('rx', payload.channel_id, payload.hex, payload.text, rawBytes, payload.timestamp)
    })
  }

  function dispose() {
    unlisten?.()
    unlisten = null
  }

  function addLine(
    direction: 'rx' | 'tx',
    channelId: string,
    hex: string,
    text: string,
    rawBytes: number[],
    timestamp?: string
  ) {
    lines.value.push({
      id: ++lineIdCounter,
      timestamp: timestamp || new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
      direction,
      channelId,
      hex,
      text,
      rawBytes,
    })
    if (lines.value.length > maxLines.value) {
      lines.value.splice(0, lines.value.length - maxLines.value + 1000)
    }
  }

  function displayText(line: TerminalLine): string {
    switch (encoding.value) {
      case 'hex':
        return line.hex.replace(/(.{2})/g, '$1 ').trim()
      case 'gbk':
        try {
          const bytes = new Uint8Array(line.rawBytes)
          return new TextDecoder('gbk').decode(bytes)
        } catch {
          return line.text
        }
      case 'utf-8':
      default:
        return line.text
    }
  }

  async function sendText(channelId: string, text: string, suffix: string = 'none') {
    await invoke('send_data', {
      request: { channel_id: channelId, data: text, format: 'text', suffix },
    })
    addLine('tx', channelId, '', text, [])
  }

  async function sendHex(channelId: string, hex: string) {
    await invoke('send_data', {
      request: { channel_id: channelId, data: hex, format: 'hex', suffix: 'none' },
    })
    addLine('tx', channelId, hex, '', [])
  }

  async function clear() {
    await invoke('clear_packets')
    lines.value = []
  }

  function hexToBytes(hex: string): number[] {
    const clean = hex.replace(/\s+/g, '')
    const bytes: number[] = []
    for (let i = 0; i < clean.length; i += 2) {
      bytes.push(parseInt(clean.substring(i, i + 2), 16))
    }
    return bytes
  }

  return {
    lines, encoding, maxLines, displayConfig, activeChannelId, filteredLines, rxCount, txCount,
    init, dispose, sendText, sendHex, clear, displayText,
  }
})
