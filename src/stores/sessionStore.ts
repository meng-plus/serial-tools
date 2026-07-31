import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api'

export interface SessionInfo {
  name: string
  path: string
  modified: string
}

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<SessionInfo[]>([])
  const currentSession = ref<string>('')

  async function loadList() {
    try {
      sessions.value = await invoke<SessionInfo[]>('list_sessions')
    } catch {
      sessions.value = []
    }
  }

  async function load(name: string): Promise<string> {
    const content = await invoke<string>('load_session', { name })
    currentSession.value = name
    return content
  }

  async function save(name: string, content: string) {
    await invoke('save_session', { name, content })
    currentSession.value = name
    await loadList()
  }

  async function remove(name: string) {
    await invoke('delete_session', { name })
    if (currentSession.value === name) currentSession.value = ''
    await loadList()
  }

  return { sessions, currentSession, loadList, load, save, remove }
})
