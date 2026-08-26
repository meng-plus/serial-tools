import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'
import { onRxData, onRxGap, type RxEventPayload } from '@/api/events'
import type { RxRecord } from '@/protocol/types'
import { loadAppSettings, saveAppSettings } from '@/utils/appSettings'

type Listener = (record: RxRecord) => void

/** 订阅过滤器：direction 默认 all（rx+tx），channelId 为空表示全部通道 */
export interface RxSubscribeOptions {
  direction?: 'rx' | 'tx' | 'all'
  channelId?: string
  /** 防抖毫秒数：覆盖全局配置，0 表示即时分发（不防抖）。缺省时用全局默认值 */
  debounceMs?: number
}

interface PacketRow {
  timestamp: string
  timestamp_end?: string | null
  duration_ms?: number | null
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
  /** 全局默认防抖毫秒数（0 = 不防抖），来自全局设置 localStorage */
  const defaultDebounceMs = ref(loadAppSettings().rxDebounceMs)

  function setGlobalDebounceMs(ms: number) {
    defaultDebounceMs.value = ms
    const s = loadAppSettings()
    s.rxDebounceMs = ms
    saveAppSettings(s)
  }

  function getGlobalDebounceMs() {
    return defaultDebounceMs.value
  }

  let unlisten: (() => void) | null = null
  let unlistenGap: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let initPromise: Promise<void> | null = null

  function subscribe(fn: Listener, opts?: RxSubscribeOptions): () => void {
    const dir = opts?.direction ?? 'all'
    const cid = opts?.channelId
    // 订阅级 debounceMs 覆盖全局默认；0 表示即时分发；缺省用全局默认
    const effectiveDebounceMs = opts?.debounceMs ?? defaultDebounceMs.value

    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined
    // 节流式累积：窗口内累积所有 record，窗口到期一次性批量下发；
    // 不重置定时器（区别于防抖），持续高频时每窗口 flush 一次，不丢数据、不积压
    let pending: RxRecord[] = []

    const flush = () => {
      timeoutId = undefined
      const batch = pending
      pending = []
      for (const r of batch) fn(r)
    }

    const wrapped: Listener = (record) => {
      if (dir !== 'all' && record.direction !== dir) return
      if (cid && record.channelId !== cid) return

      // 仅当有效防抖值 > 0 时才节流批量分发，避免高频数据唤醒 UI 卡死
      if (effectiveDebounceMs > 0) {
        pending.push(record)
        if (!timeoutId) {
          timeoutId = setTimeout(flush, effectiveDebounceMs)
        }
      } else {
        fn(record)
      }
    }

    listeners.add(wrapped)
    const cleanup = () => {
      listeners.delete(wrapped)
      if (timeoutId) clearTimeout(timeoutId)
      pending = []
    }
    return () => {
      cleanup()
    }
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
      timestampEnd: pkt.timestamp_end || undefined,
      durationMs: pkt.duration_ms ?? undefined,
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
            timestampEnd: payload.timestamp_end,
            durationMs: payload.duration_ms,
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
    defaultDebounceMs,
    setGlobalDebounceMs,
    getGlobalDebounceMs,
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
