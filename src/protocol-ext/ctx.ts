/** ProtocolContext 实现：桥接 send_data / valueBus / 日志 / 定时器 */

import { invoke, isTauri } from '@/api'
import { useRxHub } from '@/stores/rxHub'
import { useValueBus } from '@/stores/valueBus'
import { hexToBytes } from '@/protocol/frame'
import { getCachedFile } from './fileCache'
import type { ValueSample } from '@/protocol/types'
import type { ProtocolContext } from './types'
import { buildProtocolUtils } from './utils'
import { runProtocolRequest } from './request'
import { applyQueryBindings } from './queryBindings'
import type { QueryBindingDef } from './types'

export interface RuntimeLogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  instanceId: string
  protocolId: string
  msg: string
}

export interface CreateContextOptions {
  instanceId: string
  protocolId: string
  channelId: string
  getParam(key: string): unknown
  pushLog(entry: Omit<RuntimeLogEntry, 'ts'>): void
  registerTimer(
    kind: 'timeout' | 'interval',
    cb: () => void,
    ms: number,
  ): number
  /** 文本/状态查询结果 → 面板 info_panel */
  emitInfo(sample: { key: string; text: string; label?: string; level?: 'info' | 'warn' | 'error' }): void
  /** 长事务进度 → 面板 progress */
  emitProgress(sample: { id: string; current: number; total: number; label?: string; done?: boolean }): void
  /** 合并回写实例参数 */
  setParam(patch: Record<string, unknown>): void
  /** manifest.ui.queries */
  getQueries(): QueryBindingDef[] | undefined
}

export type ProtocolContextHandle = ProtocolContext & { _dispose(): void }

export function createContext(opts: CreateContextOptions): ProtocolContextHandle {
  const valueBus = useValueBus()
  const rxHub = useRxHub()
  const abort = new AbortController()

  const timestamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')

  const sendHex = async (hex: string) => {
    const resp = await invoke<{ success: boolean; bytes_sent: number; seq: number; hex: string; text: string; timestamp: string }>(
      'send_data',
      { request: { channel_id: opts.channelId, data: hex, format: 'hex', suffix: null } },
    )
    rxHub.pushTx({
      direction: 'tx',
      channelId: opts.channelId,
      bytes: hexToBytes(hex),
      hex: resp.hex || hex,
      text: resp.text || '',
      timestamp: resp.timestamp || timestamp(),
      seq: resp.seq,
    })
    return { bytesSent: resp.bytes_sent, seq: resp.seq }
  }

  return {
    channelId: opts.channelId,
    instanceId: opts.instanceId,
    sendHex,
    emitVar(sample) {
      const v: ValueSample = {
        channelId: opts.channelId,
        valueId: sample.valueId,
        timestamp: sample.timestamp || timestamp(),
        value: sample.value,
        unit: sample.unit || '',
        ruleId: opts.protocolId,
      }
      valueBus.push(v)
    },
    log(level, msg) {
      opts.pushLog({ level, instanceId: opts.instanceId, protocolId: opts.protocolId, msg })
      if (level === 'error') console.error(`[protocol:${opts.protocolId}]`, msg)
      else console.warn(`[protocol:${opts.protocolId}]`, msg)
    },
    getParam: (key: string) => opts.getParam(key),
    setParam(patch) {
      opts.setParam(patch)
    },
    emitInfo(sample) {
      opts.emitInfo(sample)
    },
    emitProgress(sample) {
      opts.emitProgress(sample)
    },
    applyQuery(actionId, data) {
      return applyQueryBindings(opts.getQueries(), actionId, data, {
        emitInfo: s => opts.emitInfo(s),
        setParam: p => opts.setParam(p),
      })
    },
    request(reqOpts) {
      return runProtocolRequest(
        {
          channelId: opts.channelId,
          sendHex,
          subscribeRx: fn => rxHub.subscribe(fn, { direction: 'rx', channelId: opts.channelId }),
          signal: abort.signal,
        },
        reqOpts,
      )
    },
    getFile(key: string) {
      const v = opts.getParam(key) as { token?: string } | null | undefined
      const token = v && typeof v === 'object' ? v.token : undefined
      if (!token) return null
      const f = getCachedFile(token)
      return f ? { name: f.name, bytes: f.bytes } : null
    },
    async saveFile(name: string, bytes: number[]) {
      if (isTauri()) {
        return invoke<string>('write_binary_export_file', { filename: name, data: bytes })
      }
      const blob = new Blob([Uint8Array.from(bytes)])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      return `浏览器默认下载目录 / ${name}`
    },
    timer: {
      setTimeout: (cb, ms) => opts.registerTimer('timeout', cb, ms),
      setInterval: (cb, ms) => opts.registerTimer('interval', cb, ms),
      clearTimeout: id => window.clearTimeout(id),
      clearInterval: id => window.clearInterval(id),
    },
    utils: buildProtocolUtils(),
    _dispose() {
      abort.abort()
    },
  }
}
