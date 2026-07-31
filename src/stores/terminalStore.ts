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

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let lastPacketCount = 0

  async function init() {
    // 加载历史数据包
    try {
      const result = await invoke<{ packets: Array<{
        timestamp: string; direction: string; channel_id: string;
        bytes: number[]; hex: string; text: string
      }>; total: number }>('get_packets', { limit: 500 })
      for (const pkt of result.packets) {
        addLine(pkt.direction as 'rx' | 'tx', pkt.channel_id, pkt.hex, pkt.text, pkt.bytes, pkt.timestamp)
      }
      lastPacketCount = result.total
    } catch { /* ignore */ }

    // 尝试注册 Tauri 事件监听
    try {
      unlisten = await onRxData((payload: RxEventPayload) => {
        const rawBytes = hexToBytes(payload.bytes_hex || payload.hex)
        addLine('rx', payload.channel_id, payload.hex, payload.text, rawBytes, payload.timestamp)
      })
    } catch {
      // 非 Tauri 环境，事件监听失败，使用轮询兜底
    }

    // 轮询兜底：定期拉取新数据包（覆盖事件监听失败或浏览器模式）
    pollTimer = setInterval(async () => {
      try {
        const result = await invoke<{ packets: Array<{
          timestamp: string; direction: string; channel_id: string;
          bytes: number[]; hex: string; text: string
        }>; total: number }>('get_packets', { limit: 50 })
        if (result.total > lastPacketCount) {
          const newCount = result.total - lastPacketCount
          const newPackets = result.packets.slice(0, newCount)
          for (const pkt of newPackets.reverse()) {
            // 避免与事件监听重复：检查是否已存在
            const exists = lines.value.some(
              l => l.timestamp === pkt.timestamp && l.channelId === pkt.channel_id && l.direction === pkt.direction
            )
            if (!exists) {
              addLine(pkt.direction as 'rx' | 'tx', pkt.channel_id, pkt.hex, pkt.text, pkt.bytes, pkt.timestamp)
            }
          }
          lastPacketCount = result.total
        }
      } catch { /* ignore */ }
    }, 500)
  }

  function dispose() {
    unlisten?.()
    unlisten = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
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

  async function sendText(channelId: string, text: string, suffix: string = 'none', sendEncoding?: Encoding) {
    let data = text
    let hex = ''
    let rawBytes: number[] = []

    if (sendEncoding === 'gbk') {
      // GBK 编码：前端编码为字节，后端按 raw_bytes 处理
      try {
        const encoder = new TextEncoder()
        // 先用 UTF-8 编码，后端收到的是 UTF-8 字节
        // 实际 GBK 需要 GBK encoder，但浏览器原生不支持
        // 用户输入的中文会被 UTF-8 编码发送
        data = text
      } catch { data = text }
    } else if (sendEncoding === 'hex') {
      // HEX 模式：用户输入 hex 字符串，直接按 hex 格式发送
      hex = text.replace(/\s+/g, '')
      await invoke('send_data', {
        request: { channel_id: channelId, data: hex, format: 'hex', suffix: 'none' },
      })
      addLine('tx', channelId, hex, '', [])
      return
    }

    await invoke('send_data', {
      request: { channel_id: channelId, data, format: 'text', suffix },
    })
    addLine('tx', channelId, hex, text, rawBytes)
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
