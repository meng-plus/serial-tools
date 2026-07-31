import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'
import { onLogEntry, type LogEventPayload } from '@/api/events'

export interface LogEntry {
  timestamp: string
  level: string
  source: string
  message: string
}

export const useLogStore = defineStore('log', () => {
  const logs = ref<LogEntry[]>([])
  const filterLevel = ref<string | undefined>(undefined)
  let unlisten: (() => void) | null = null

  async function init() {
    await fetchLogs()
    unlisten = await onLogEntry((payload: LogEventPayload) => {
      logs.value.push(payload)
      if (logs.value.length > 5000) {
        logs.value.splice(0, logs.value.length - 4000)
      }
    })
  }

  function dispose() {
    unlisten?.()
    unlisten = null
  }

  async function fetchLogs(limit = 200, level?: string) {
    logs.value = await invoke<LogEntry[]>('get_logs', { limit, level })
  }

  async function clearLogs() {
    await invoke('clear_logs')
    logs.value = []
  }

  return { logs, filterLevel, init, dispose, fetchLogs, clearLogs }
})
