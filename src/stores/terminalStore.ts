import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@/api'
import { onRxData, type RxEventPayload } from '@/api/events'
import { useConnectionStore } from './connectionStore'

export interface TerminalLine {
  id: number
  timestamp: string
  direction: 'rx' | 'tx'
  channelId: string
  hex: string
  text: string
  rawBytes: number[]
  seq?: number
}

export type Encoding = 'utf-8' | 'gbk' | 'gb2312' | 'hex'

export interface DisplayConfig {
  showTimestamp: boolean
  showDirection: boolean
  showChannel: boolean
}

interface SendResult {
  success: boolean
  bytes_sent: number
  timestamp: string
  hex: string
  text: string
  channel_id: string
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
  /** 内容指纹去重：事件 / 轮询 / 本地发送 共用 */
  const seenKeys = new Set<string>()
  let eventListening = false

  const activeChannelId = ref<string>('')

  const filteredLines = computed(() => {
    if (!activeChannelId.value) return lines.value
    const selected = activeChannelId.value
    if (selected.startsWith('tcp_server-')) {
      const conn = useConnectionStore()
      const clientIds = new Set(
        conn.getServerClients(selected).map(c => c.channelId)
      )
      return lines.value.filter(
        l => l.channelId === selected || clientIds.has(l.channelId)
      )
    }
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

  /** 统一内容键：同一包无论来自事件还是轮询都相同 */
  function contentKey(
    direction: string,
    channelId: string,
    timestamp: string,
    hex: string,
    text: string
  ) {
    return `${direction}|${channelId}|${timestamp}|${hex}|${text}`
  }

  function addLine(
    direction: 'rx' | 'tx',
    channelId: string,
    hex: string,
    text: string,
    rawBytes: number[],
    timestamp?: string,
    seq?: number
  ) {
    const ts = timestamp
      || (new Date().toLocaleTimeString('en-US', { hour12: false })
        + '.' + String(Date.now() % 1000).padStart(3, '0'))

    const ckey = contentKey(direction, channelId, ts, hex, text)
    if (seenKeys.has(ckey)) return

    if (seq != null && seq > 0) {
      const skey = `seq:${seq}`
      if (seenKeys.has(skey)) return
      seenKeys.add(skey)
    }
    seenKeys.add(ckey)

    lines.value.push({
      id: ++lineIdCounter,
      timestamp: ts,
      direction,
      channelId,
      hex,
      text,
      rawBytes,
      seq,
    })
    if (lines.value.length > maxLines.value) {
      const drop = lines.value.length - maxLines.value + 1000
      const removed = lines.value.splice(0, drop)
      for (const r of removed) {
        seenKeys.delete(contentKey(r.direction, r.channelId, r.timestamp, r.hex, r.text))
        if (r.seq != null && r.seq > 0) seenKeys.delete(`seq:${r.seq}`)
      }
    }
  }

  async function init() {
    // 防止重复 init 导致双订阅
    dispose()

    try {
      const result = await invoke<{ packets: Array<{
        timestamp: string; direction: string; channel_id: string;
        bytes: number[]; hex: string; text: string
      }>; total: number }>('get_packets', { limit: 500 })
      for (const pkt of [...result.packets].reverse()) {
        addLine(
          pkt.direction as 'rx' | 'tx',
          pkt.channel_id,
          pkt.hex,
          pkt.text,
          pkt.bytes || [],
          pkt.timestamp
        )
      }
    } catch { /* ignore */ }

    try {
      unlisten = await onRxData((payload: RxEventPayload) => {
        const rawBytes = hexToBytes(payload.bytes_hex || payload.hex)
        addLine(
          'rx',
          payload.channel_id,
          payload.hex,
          payload.text,
          rawBytes,
          payload.timestamp,
          payload.seq
        )
      })
      eventListening = true
    } catch (e) {
      console.warn('[terminal] onRxData failed, fallback to polling only', e)
      eventListening = false
    }

    // 有事件时放慢轮询；仅补漏，靠 contentKey 去重
    const interval = eventListening ? 1500 : 400
    pollTimer = setInterval(async () => {
      try {
        const result = await invoke<{ packets: Array<{
          timestamp: string; direction: string; channel_id: string;
          bytes: number[]; hex: string; text: string
        }>; total: number }>('get_packets', { limit: 100 })
        for (const pkt of [...result.packets].reverse()) {
          addLine(
            pkt.direction as 'rx' | 'tx',
            pkt.channel_id,
            pkt.hex,
            pkt.text,
            pkt.bytes || [],
            pkt.timestamp
          )
        }
      } catch { /* ignore */ }
    }, interval)
  }

  function dispose() {
    unlisten?.()
    unlisten = null
    eventListening = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function displayText(line: TerminalLine): string {
    switch (encoding.value) {
      case 'hex':
        return line.hex.replace(/(.{2})/g, '$1 ').trim()
      case 'gbk':
      case 'gb2312':
        try {
          const bytes = new Uint8Array(line.rawBytes)
          const label = encoding.value === 'gb2312' ? 'gb2312' : 'gbk'
          return new TextDecoder(label).decode(bytes)
        } catch {
          try {
            return new TextDecoder('gbk').decode(new Uint8Array(line.rawBytes))
          } catch {
            return line.text
          }
        }
      case 'utf-8':
      default:
        return line.text
    }
  }

  async function sendText(channelId: string, text: string, suffix: string = 'none', sendEncoding?: Encoding) {
    const format = sendEncoding === 'gbk' || sendEncoding === 'gb2312'
      ? sendEncoding
      : sendEncoding === 'hex'
        ? 'hex'
        : 'text'

    if (format === 'hex') {
      const hex = text.replace(/\s+/g, '')
      const result = await invoke<SendResult>('send_data', {
        request: { channel_id: channelId, data: hex, format: 'hex', suffix: 'none' },
      })
      addLine('tx', result.channel_id, result.hex, result.text, hexToBytes(result.hex), result.timestamp)
      return
    }

    const result = await invoke<SendResult>('send_data', {
      request: {
        channel_id: channelId,
        data: text,
        format: format === 'text' ? 'text' : format,
        suffix,
      },
    })
    // 只用后端回包入账一次；轮询看到同一 timestamp+hex 会被 contentKey 丢掉
    addLine(
      'tx',
      result.channel_id,
      result.hex,
      result.text,
      hexToBytes(result.hex),
      result.timestamp
    )
  }

  async function sendHex(channelId: string, hex: string) {
    const clean = hex.replace(/\s+/g, '')
    const result = await invoke<SendResult>('send_data', {
      request: { channel_id: channelId, data: clean, format: 'hex', suffix: 'none' },
    })
    addLine('tx', result.channel_id, result.hex, result.text, hexToBytes(result.hex), result.timestamp)
  }

  async function clear() {
    await invoke('clear_packets')
    lines.value = []
    seenKeys.clear()
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
    init, dispose, addLine, sendText, sendHex, clear, displayText,
  }
})
