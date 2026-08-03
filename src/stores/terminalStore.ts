import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { invoke } from '@/api'
import { useConnectionStore } from './connectionStore'
import { useRxHub } from './rxHub'
import type { RxRecord } from '@/protocol/types'

export interface TerminalLine {
  id: number
  timestamp: string
  timestampEnd?: string
  durationMs?: number
  direction: 'rx' | 'tx'
  channelId: string
  hex: string
  text: string
  rawBytes: number[]
  seq?: number
}

export type Encoding = 'utf-8' | 'gbk' | 'hex'

export interface DisplayConfig {
  showTimestamp: boolean
  showDuration: boolean
  showDirection: boolean
  showChannel: boolean
  showTx: boolean
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

/**
 * 终端视图状态：展示与发送；RX 数据来自 rxHub，不再独自订 rx-data。
 */
export const useTerminalStore = defineStore('terminal', () => {
  const encoding = ref<Encoding>('utf-8')
  const maxLines = ref(10000)
  const displayConfig = ref<DisplayConfig>({
    showTimestamp: true,
    showDuration: false,
    showDirection: true,
    showChannel: true,
    showTx: true,
  })
  let lineIdCounter = 0
  let unsub: (() => void) | null = null

  /** 工作区绑定的通道（一视图一通道；空=兼容旧页「全部」） */
  const activeChannelId = ref<string>('')

  const lines = ref<TerminalLine[]>([])

  const filteredLines = computed(() => {
    const showTxSend = displayConfig.value.showTx
    const pool = lines.value
    if (!activeChannelId.value) return showTxSend ? pool : pool.filter(l => l.direction === 'rx')
    const selected = activeChannelId.value
    if (selected.startsWith('tcp_server-')) {
      const conn = useConnectionStore()
      const clientIds = new Set(
        conn.getServerClients(selected).map(c => c.channelId)
      )
      return pool.filter(
        l =>
          (showTxSend || l.direction === 'rx') &&
          (l.channelId === selected || clientIds.has(l.channelId)),
      )
    }
    return pool.filter(l => (showTxSend || l.direction === 'rx') && l.channelId === selected)
  })

  const rxCount = computed(() =>
    filteredLines.value.filter(l => l.direction === 'rx').length
  )
  const txCount = computed(() =>
    filteredLines.value.filter(l => l.direction === 'tx').length
  )

  const eventDriven = computed(() => useRxHub().eventDriven)

  function recordToLine(r: RxRecord): TerminalLine {
    return {
      id: ++lineIdCounter,
      timestamp: r.timestamp,
      timestampEnd: r.timestampEnd,
      durationMs: r.durationMs,
      direction: r.direction,
      channelId: r.channelId,
      hex: r.hex,
      text: r.text,
      rawBytes: r.bytes,
      seq: r.seq,
    }
  }

  function onHubRecord(r: RxRecord) {
    lines.value.push(recordToLine(r))
    if (lines.value.length > maxLines.value) {
      lines.value.splice(0, lines.value.length - maxLines.value + 1000)
    }
  }

  async function init() {
    const hub = useRxHub()
    await hub.init()
    if (!unsub) {
      // 回放已有记录
      lines.value = []
      lineIdCounter = 0
      for (const r of hub.records) {
        lines.value.push(recordToLine(r))
      }
      unsub = hub.subscribe(onHubRecord)
    }
  }

  function dispose() {
    unsub?.()
    unsub = null
  }

  function displayText(line: TerminalLine, enc?: Encoding): string {
    switch (enc ?? encoding.value) {
      case 'hex':
        return line.hex.replace(/(.{2})/g, '$1 ').trim()
      case 'gbk':
        try {
          return new TextDecoder('gbk').decode(new Uint8Array(line.rawBytes))
        } catch {
          return line.text
        }
      case 'utf-8':
      default:
        return line.text
    }
  }

  async function sendText(channelId: string, text: string, suffix: string = 'none', sendEncoding?: Encoding) {
    const hub = useRxHub()
    const format = sendEncoding === 'gbk'
      ? 'gbk'
      : sendEncoding === 'hex'
        ? 'hex'
        : 'text'

    const result = await invoke<SendResult>('send_data', {
      request: {
        channel_id: channelId,
        data: format === 'hex' ? text.replace(/\s+/g, '') : text,
        format: format === 'hex' ? 'hex' : format === 'gbk' ? 'gbk' : 'text',
        suffix: format === 'hex' ? 'none' : suffix,
      },
    })
    hub.pushTx({
      channelId: result.channel_id,
      hex: result.hex,
      text: result.text,
      bytes: hub.hexToBytes(result.hex),
      timestamp: result.timestamp,
      seq: result.seq,
    })
  }

  async function sendHex(channelId: string, hex: string) {
    await sendText(channelId, hex, 'none', 'hex')
  }

  async function clear() {
    await useRxHub().clear()
    lines.value = []
  }

  return {
    lines, encoding, maxLines, displayConfig, activeChannelId, filteredLines, rxCount, txCount,
    eventDriven,
    init, dispose, sendText, sendHex, clear, displayText,
  }
})
