import { isTauri } from './tauri'

export interface RxEventPayload {
  channel_id: string
  bytes_hex: string
  hex: string
  text: string
  timestamp: string
  seq?: number
  bytes?: number[]
}

export interface ConnectionEventPayload {
  channel_id: string
  connected: boolean
  transport_type: string
  port_name: string
  parent_channel_id?: string | null
  server_clients?: string[] | null
  /** local=本端主动 / remote=对端优雅关闭 / error=异常断开 */
  reason?: string | null
}

export interface LogEventPayload {
  timestamp: string
  level: string
  source: string
  message: string
}

type UnlistenFn = () => void

let listenFn: typeof import('@tauri-apps/api/event').listen | null = null

async function getListen() {
  if (!isTauri()) return null
  if (!listenFn) {
    const mod = await import('@tauri-apps/api/event')
    listenFn = mod.listen
  }
  return listenFn
}

export async function onRxData(handler: (payload: RxEventPayload) => void): Promise<UnlistenFn> {
  const listen = await getListen()
  if (!listen) return () => {}
  return listen<RxEventPayload>('rx-data', (event) => handler(event.payload))
}

export async function onConnectionChanged(handler: (payload: ConnectionEventPayload) => void): Promise<UnlistenFn> {
  const listen = await getListen()
  if (!listen) return () => {}
  return listen<ConnectionEventPayload>('connection-changed', (event) => handler(event.payload))
}

export async function onLogEntry(handler: (payload: LogEventPayload) => void): Promise<UnlistenFn> {
  const listen = await getListen()
  if (!listen) return () => {}
  return listen<LogEventPayload>('log-entry', (event) => handler(event.payload))
}
