export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Not in Tauri environment')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(cmd, args)
}
