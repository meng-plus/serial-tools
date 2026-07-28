import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'

export interface LogEntry {
  timestamp: string
  level: string
  source: string
  message: string
}

export const useLogStore = defineStore('log', () => {
  const logs = ref<LogEntry[]>([])

  async function fetchLogs(limit = 200, level?: string) {
    logs.value = await invoke<LogEntry[]>('get_logs', { limit, level })
  }

  async function clearLogs() {
    await invoke('clear_logs')
    logs.value = []
  }

  return { logs, fetchLogs, clearLogs }
})
