import { defineStore } from 'pinia'
import { ref } from 'vue'
import { matchAllRules } from '@/protocol/engine'
import type { ParsedRecord, ProtocolRule, RxRecord } from '@/protocol/types'
import { useRxHub } from './rxHub'
import { useValueBus } from './valueBus'
import { useWorkspaceStore } from './workspaceStore'

let parsedId = 0
let unsub: (() => void) | null = null

function normalizeRule(r: ProtocolRule): ProtocolRule {
  const { channelId: _ignored, ...rest } = r
  return { ...rest }
}

export const useProtocolStore = defineStore('protocol', () => {
  const rules = ref<ProtocolRule[]>([])
  const parsed = ref<ParsedRecord[]>([])
  const maxParsed = 5000

  function processRecord(record: RxRecord) {
    // 方案 B：只解析「当前工作区通道」的 RX
    const workspace = useWorkspaceStore()
    const active = workspace.activeChannelId
    if (!active || record.channelId !== active) return

    const hits = matchAllRules(rules.value, record)
    const valueBus = useValueBus()
    for (const hit of hits) {
      const entry: ParsedRecord = {
        id: `p-${++parsedId}`,
        timestamp: record.timestamp,
        channelId: record.channelId,
        ruleId: hit.rule.id,
        ruleName: hit.rule.name,
        content: record.text,
        fields: hit.fields,
        seq: record.seq,
      }
      parsed.value.push(entry)
      for (const f of hit.fields) {
        if (f.numberValue != null && f.valueId) {
          valueBus.push({
            channelId: record.channelId,
            valueId: f.valueId,
            timestamp: record.timestamp,
            value: f.numberValue,
            unit: f.unit,
            ruleId: hit.rule.id,
          })
        }
      }
    }
    if (parsed.value.length > maxParsed) {
      parsed.value.splice(0, parsed.value.length - maxParsed + 500)
    }
  }

  function init() {
    if (unsub) return
    const hub = useRxHub()
    for (const r of hub.records) {
      processRecord(r)
    }
    unsub = hub.subscribe(processRecord)
  }

  function dispose() {
    unsub?.()
    unsub = null
  }

  function addRule(rule: ProtocolRule) {
    rules.value.push(normalizeRule(rule))
  }

  function removeRule(id: string) {
    rules.value = rules.value.filter(r => r.id !== id)
  }

  function updateRule(id: string, patch: Partial<ProtocolRule>) {
    const i = rules.value.findIndex(r => r.id === id)
    if (i >= 0) {
      const { channelId: _c, ...rest } = { ...rules.value[i], ...patch }
      rules.value[i] = rest
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

  /** 规则全局共用，不按通道过滤（兼容旧调用名） */
  function rulesForChannel(_channelId?: string) {
    return rules.value
  }

  function setRules(next: ProtocolRule[]) {
    rules.value = next.map(normalizeRule)
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
