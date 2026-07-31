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
  seq?: number
}

interface PacketRow {
  timestamp: string
  direction: string
  channel_id: string
  bytes: number[]
  hex: string
  text: string
  seq?: number
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
  /** seq 优先；无 seq 时用内容指纹 */
  const seenKeys = new Set<string>()
  const eventDriven = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let initPromise: Promise<void> | null = null

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

  function contentKey(
    direction: string,
    channelId: string,
    timestamp: string,
    hex: string,
  ) {
    // 不含 text：避免 UTF-8 替换字符等导致事件/历史键不一致
    return `${direction}|${channelId}|${timestamp}|${hex.toLowerCase()}`
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

    const normalizedHex = (hex || '').toLowerCase()

    if (seq != null && seq > 0) {
      const skey = `seq:${seq}`
      if (seenKeys.has(skey)) return
      seenKeys.add(skey)
    }

    const ckey = contentKey(direction, channelId, ts, normalizedHex)
    if (seenKeys.has(ckey)) return
    seenKeys.add(ckey)

    lines.value.push({
      id: ++lineIdCounter,
      timestamp: ts,
      direction,
      channelId,
      hex: normalizedHex,
      text,
      rawBytes,
      seq,
    })
    if (lines.value.length > maxLines.value) {
      const drop = lines.value.length - maxLines.value + 1000
      const removed = lines.value.splice(0, drop)
      for (const r of removed) {
        seenKeys.delete(contentKey(r.direction, r.channelId, r.timestamp, r.hex))
        if (r.seq != null && r.seq > 0) seenKeys.delete(`seq:${r.seq}`)
      }
    }
  }

  function ingestPacket(pkt: PacketRow) {
    addLine(
      pkt.direction as 'rx' | 'tx',
      pkt.channel_id,
      pkt.hex || '',
      pkt.text || '',
      pkt.bytes || hexToBytes(pkt.hex || ''),
      pkt.timestamp,
      pkt.seq && pkt.seq > 0 ? pkt.seq : undefined
    )
  }

  async function loadHistory(limit = 500) {
    try {
      const result = await invoke<{ packets: PacketRow[]; total: number }>(
        'get_packets',
        { limit }
      )
      for (const pkt of [...result.packets].reverse()) {
        ingestPacket(pkt)
      }
    } catch { /* ignore */ }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** 仅在事件订阅失败时作为兜底 */
  function startPollingFallback() {
    stopPolling()
    pollTimer = setInterval(async () => {
      try {
        const result = await invoke<{ packets: PacketRow[]; total: number }>(
          'get_packets',
          { limit: 100 }
        )
        for (const pkt of [...result.packets].reverse()) {
          ingestPacket(pkt)
        }
      } catch { /* ignore */ }
    }, 400)
  }

  async function init() {
    // 串行化，避免并发 init 双订阅
    if (initPromise) {
      await initPromise
      return
    }
    initPromise = (async () => {
      dispose()
      await loadHistory(500)

      try {
        unlisten = await onRxData((payload: RxEventPayload) => {
          const hex = payload.hex || payload.bytes_hex || ''
          const rawBytes = payload.bytes?.length
            ? payload.bytes
            : hexToBytes(hex)
          addLine(
            'rx',
            payload.channel_id,
            hex,
            payload.text || '',
            rawBytes,
            payload.timestamp,
            payload.seq
          )
        })
        eventDriven.value = true
      } catch (e) {
        console.warn('[terminal] onRxData failed, fallback to polling', e)
        eventDriven.value = false
        startPollingFallback()
      }
    })()

    try {
      await initPromise
    } finally {
      initPromise = null
    }
  }

  function dispose() {
    unlisten?.()
    unlisten = null
    eventDriven.value = false
    stopPolling()
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
      addLine('tx', result.channel_id, result.hex, result.text, hexToBytes(result.hex), result.timestamp, result.seq)
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
    // 仅用后端回包入账；无轮询时不会二次插入
    addLine(
      'tx',
      result.channel_id,
      result.hex,
      result.text,
      hexToBytes(result.hex),
      result.timestamp,
      result.seq
    )
  }

  async function sendHex(channelId: string, hex: string) {
    const clean = hex.replace(/\s+/g, '')
    const result = await invoke<SendResult>('send_data', {
      request: { channel_id: channelId, data: clean, format: 'hex', suffix: 'none' },
    })
    addLine('tx', result.channel_id, result.hex, result.text, hexToBytes(result.hex), result.timestamp, result.seq)
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
    eventDriven,
    init, dispose, addLine, sendText, sendHex, clear, displayText,
  }
})
