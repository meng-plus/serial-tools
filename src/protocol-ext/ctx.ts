/** ProtocolContext 实现：桥接 send_data / valueBus / 日志 / 定时器 */

import { invoke, isTauri } from '@/api'
import { useRxHub } from '@/stores/rxHub'
import { useValueBus } from '@/stores/valueBus'
import { hexToBytes } from '@/protocol/frame'
import { getCachedFile } from './fileCache'
import type { ValueSample } from '@/protocol/types'
import type { ProtocolContext } from './types'
import { buildProtocolUtils } from './utils'

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
}

export function createContext(opts: CreateContextOptions): ProtocolContext {
  const valueBus = useValueBus()
  const rxHub = useRxHub()

  const timestamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0')

  return {
    channelId: opts.channelId,
    instanceId: opts.instanceId,
    async sendHex(hex: string) {
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
    },
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
  }
}
