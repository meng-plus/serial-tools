import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ValueSample } from '@/protocol/types'

const MAX_PER_SERIES = 2000

function seriesKey(channelId: string, valueId: string) {
  return `${channelId}::${valueId}`
}

/** 按 (channelId, valueId) 缓冲时序样本 */
export const useValueBus = defineStore('valueBus', () => {
  const series = ref<Record<string, ValueSample[]>>({})
  const latest = ref<Record<string, ValueSample>>({})

  function push(sample: ValueSample) {
    const key = seriesKey(sample.channelId, sample.valueId)
    if (!series.value[key]) series.value[key] = []
    series.value[key].push(sample)
    if (series.value[key].length > MAX_PER_SERIES) {
      series.value[key].splice(0, series.value[key].length - MAX_PER_SERIES + 200)
    }
    latest.value[key] = sample
  }

  function getSeries(channelId: string, valueId: string): ValueSample[] {
    return series.value[seriesKey(channelId, valueId)] || []
  }

  function getLatest(channelId: string, valueId: string): ValueSample | undefined {
    return latest.value[seriesKey(channelId, valueId)]
  }

  function listValueIds(channelId: string): string[] {
    const prefix = `${channelId}::`
    const ids = new Set<string>()
    for (const key of Object.keys(series.value)) {
      if (key.startsWith(prefix)) ids.add(key.slice(prefix.length))
    }
    for (const key of Object.keys(latest.value)) {
      if (key.startsWith(prefix)) ids.add(key.slice(prefix.length))
    }
    return [...ids]
  }

  function clearChannel(channelId: string) {
    const prefix = `${channelId}::`
    for (const key of Object.keys(series.value)) {
      if (key.startsWith(prefix)) delete series.value[key]
    }
    for (const key of Object.keys(latest.value)) {
      if (key.startsWith(prefix)) delete latest.value[key]
    }
  }

  function clearSeries(channelId: string, valueId: string) {
    const key = seriesKey(channelId, valueId)
    delete series.value[key]
    delete latest.value[key]
  }

  return { series, latest, push, getSeries, getLatest, listValueIds, clearChannel, clearSeries }
})
