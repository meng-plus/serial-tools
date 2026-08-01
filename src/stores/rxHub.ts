import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'
import { onRxData, onRxGap, type RxEventPayload } from '@/api/events'
import type { RxRecord } from '@/protocol/types'

type Listener = (record: RxRecord) => void

interface PacketRow {
  timestamp: string
  direction: string
  channel_id: string
  bytes: number[]
  hex: string
  text: string
  seq?: number
}

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s+/g, '')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16))
  }
  return bytes
}

function contentKey(direction: string, channelId: string, timestamp: string, hex: string) {
  return `${direction}|${channelId}|${timestamp}|${hex.toLowerCase()}`
}

/**
 * 全局 RX/TX 扇出中心：唯一订阅 rx-data；视图经 subscribe 或读 records。
 */
export const useRxHub = defineStore('rxHub', () => {
  const records = ref<RxRecord[]>([])
  const eventDriven = ref(false)
  const maxRecords = 10000
  const seenKeys = new Set<string>()
  const listeners = new Set<Listener>()

  let unlisten: (() => void) | null = null
  let unlistenGap: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let initPromise: Promise<void> | null = null

  function subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function emit(record: RxRecord) {
    for (const fn of listeners) {
      try {
        fn(record)
      } catch (e) {
        console.warn('[rxHub] listener error', e)
      }
    }
  }

  function pushRecord(record: RxRecord) {
    const hex = (record.hex || '').toLowerCase()
    const normalized: RxRecord = { ...record, hex }

    if (normalized.seq != null && normalized.seq > 0) {
      const skey = `seq:${normalized.seq}`
      if (seenKeys.has(skey)) return
      seenKeys.add(skey)
    }

    const ckey = contentKey(
      normalized.direction,
      normalized.channelId,
      normalized.timestamp,
      hex,
    )
    if (seenKeys.has(ckey)) return
    seenKeys.add(ckey)

    records.value.push(normalized)
    if (records.value.length > maxRecords) {
      const drop = records.value.length - maxRecords + 1000
      const removed = records.value.splice(0, drop)
      for (const r of removed) {
        seenKeys.delete(contentKey(r.direction, r.channelId, r.timestamp, r.hex))
        if (r.seq != null && r.seq > 0) seenKeys.delete(`seq:${r.seq}`)
      }
    }
    emit(normalized)
  }

  function ingestPacket(pkt: PacketRow) {
    pushRecord({
      direction: pkt.direction as 'rx' | 'tx',
      channelId: pkt.channel_id,
      hex: pkt.hex || '',
      text: pkt.text || '',
      bytes: pkt.bytes || hexToBytes(pkt.hex || ''),
      timestamp: pkt.timestamp,
      seq: pkt.seq && pkt.seq > 0 ? pkt.seq : undefined,
    })
  }

  async function loadHistory(limit = 500) {
    try {
      const result = await invoke<{ packets: PacketRow[]; total: number }>(
        'get_packets',
        { limit },
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

  function startPollingFallback() {
    stopPolling()
    pollTimer = setInterval(async () => {
      try {
        const result = await invoke<{ packets: PacketRow[]; total: number }>(
          'get_packets',
          { limit: 100 },
        )
        for (const pkt of [...result.packets].reverse()) {
          ingestPacket(pkt)
        }
      } catch { /* ignore */ }
    }, 400)
  }

  async function init() {
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
          pushRecord({
            direction: 'rx',
            channelId: payload.channel_id,
            hex,
            text: payload.text || '',
            bytes: payload.bytes?.length ? payload.bytes : hexToBytes(hex),
            timestamp: payload.timestamp,
            seq: payload.seq,
          })
        })
        eventDriven.value = true
        // 桥接层丢帧（broadcast lagged）时补拉后端缓冲；seq/contentKey 去重保证幂等
        unlistenGap = await onRxGap(() => {
          void loadHistory(2000)
        })
      } catch (e) {
        console.warn('[rxHub] onRxData failed, fallback to polling', e)
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
    unlistenGap?.()
    unlistenGap = null
    eventDriven.value = false
    stopPolling()
  }

  /** TX 由发送回包入账 */
  function pushTx(record: Omit<RxRecord, 'direction'> & { direction?: 'tx' }) {
    pushRecord({ ...record, direction: 'tx' })
  }

  async function clear() {
    await invoke('clear_packets')
    records.value = []
    seenKeys.clear()
  }

  function recordsForChannel(channelId: string): RxRecord[] {
    return records.value.filter(r => r.channelId === channelId)
  }

  return {
    records,
    eventDriven,
    init,
    dispose,
    subscribe,
    pushRecord,
    pushTx,
    clear,
    recordsForChannel,
    hexToBytes,
  }
})
