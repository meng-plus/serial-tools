import { defineStore } from 'pinia'
import { ref } from 'vue'
import { matchAllRules } from '@/protocol/engine'
import { decodeBinaryFields } from '@/protocol/binaryDecode'
import { BinaryFramer, DEFAULT_FRAME_CONFIG } from '@/protocol/binaryFramer'
import { bytesToHex } from '@/protocol/frame'
import type { ParsedRecord, ProtocolRule, RxRecord } from '@/protocol/types'
import { useRxHub } from './rxHub'
import { useValueBus } from './valueBus'
import { useWorkspaceStore } from './workspaceStore'

let parsedId = 0
let unsub: (() => void) | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null

function normalizeRule(r: ProtocolRule): ProtocolRule {
  const { channelId: _ignored, ...rest } = r
  return { ...rest }
}

function framerKey(channelId: string, ruleId: string) {
  return `${channelId}::${ruleId}`
}

export const useProtocolStore = defineStore('protocol', () => {
  const rules = ref<ProtocolRule[]>([])
  const parsed = ref<ParsedRecord[]>([])
  const maxParsed = 5000
  const framers = new Map<string, BinaryFramer>()

  function ensureFramer(channelId: string, rule: ProtocolRule): BinaryFramer {
    const key = framerKey(channelId, rule.id)
    const cfg = { ...DEFAULT_FRAME_CONFIG, ...(rule.frame || {}) }
    let f = framers.get(key)
    if (!f) {
      f = new BinaryFramer(cfg)
      framers.set(key, f)
    } else {
      f.updateConfig(cfg)
    }
    return f
  }

  function pushParsed(
    channelId: string,
    timestamp: string,
    rule: ProtocolRule,
    content: string,
    fields: ParsedRecord['fields'],
    seq?: number,
  ) {
    const entry: ParsedRecord = {
      id: `p-${++parsedId}`,
      timestamp,
      channelId,
      ruleId: rule.id,
      ruleName: rule.name,
      content,
      fields,
      seq,
    }
    parsed.value.push(entry)
    const valueBus = useValueBus()
    for (const f of fields) {
      if (f.numberValue != null && f.valueId) {
        valueBus.push({
          channelId,
          valueId: f.valueId,
          timestamp,
          value: f.numberValue,
          unit: f.unit,
          ruleId: rule.id,
        })
      }
    }
    if (parsed.value.length > maxParsed) {
      parsed.value.splice(0, parsed.value.length - maxParsed + 500)
    }
  }

  function handleBinaryFrames(
    channelId: string,
    rule: ProtocolRule,
    frames: { bytes: number[]; ok: boolean; reason?: string }[],
    timestamp: string,
    seq?: number,
  ) {
    for (const frame of frames) {
      if (!frame.ok) continue
      const fields = decodeBinaryFields(frame.bytes, rule.binaryFields || [])
      if (fields.length === 0 && (rule.binaryFields || []).length > 0) continue
      pushParsed(channelId, timestamp, rule, bytesToHex(frame.bytes), fields, seq)
    }
  }

  function processRecord(record: RxRecord) {
    const workspace = useWorkspaceStore()
    const active = workspace.activeChannelId
    if (!active || record.channelId !== active) return
    if (record.direction !== 'rx') return

    // 文本规则
    const hits = matchAllRules(rules.value, record)
    for (const hit of hits) {
      pushParsed(
        record.channelId,
        record.timestamp,
        hit.rule,
        record.text,
        hit.fields,
        record.seq,
      )
    }

    // 二进制规则：喂字节
    const bytes = record.bytes?.length
      ? record.bytes
      : []
    if (!bytes.length) return
    for (const rule of rules.value) {
      if (!rule.enabled || rule.type !== 'binary') continue
      const framer = ensureFramer(record.channelId, rule)
      const frames = framer.push(bytes)
      handleBinaryFrames(record.channelId, rule, frames, record.timestamp, record.seq)
    }
  }

  function tickIdle() {
    const workspace = useWorkspaceStore()
    const active = workspace.activeChannelId
    if (!active) return
    const now = Date.now()
    for (const rule of rules.value) {
      if (!rule.enabled || rule.type !== 'binary') continue
      const key = framerKey(active, rule.id)
      const framer = framers.get(key)
      if (!framer) continue
      const frames = framer.tick(now)
      if (frames.length) {
        handleBinaryFrames(active, rule, frames, new Date().toISOString())
      }
    }
  }

  function init() {
    if (unsub) return
    const hub = useRxHub()
    for (const r of hub.records) {
      processRecord(r)
    }
    unsub = hub.subscribe(processRecord)
    if (!idleTimer) {
      idleTimer = setInterval(() => tickIdle(), 20)
    }
  }

  function dispose() {
    unsub?.()
    unsub = null
    if (idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
    framers.clear()
  }

  function addRule(rule: ProtocolRule) {
    rules.value.push(normalizeRule(rule))
  }

  function removeRule(id: string) {
    rules.value = rules.value.filter(r => r.id !== id)
    for (const key of [...framers.keys()]) {
      if (key.endsWith(`::${id}`)) framers.delete(key)
    }
  }

  function updateRule(id: string, patch: Partial<ProtocolRule>) {
    const i = rules.value.findIndex(r => r.id === id)
    if (i >= 0) {
      const { channelId: _c, ...rest } = { ...rules.value[i], ...patch }
      rules.value[i] = rest
      for (const key of [...framers.keys()]) {
        if (key.endsWith(`::${id}`)) framers.delete(key)
      }
    }
  }

  function parsedForChannel(channelId: string) {
    return parsed.value.filter(p => p.channelId === channelId)
  }

  function clearParsed(channelId?: string) {
    if (!channelId) {
      parsed.value = []
      return
    }
    parsed.value = parsed.value.filter(p => p.channelId !== channelId)
  }

  function rulesForChannel(_channelId?: string) {
    return rules.value
  }

  function setRules(next: ProtocolRule[]) {
    rules.value = next.map(normalizeRule)
    framers.clear()
  }

  return {
    rules,
    parsed,
    init,
    dispose,
    addRule,
    removeRule,
    updateRule,
    setRules,
    processRecord,
    parsedForChannel,
    clearParsed,
    rulesForChannel,
  }
})
