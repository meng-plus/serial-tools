/**
 * 后端命令错误解析 — 统一 `{ code, message }` 契约（见 src-tauri/src/error.rs）
 */

export interface CommandErrorPayload {
  code: string
  message: string
}

/** 未知/未结构化错误 */
export const UNKNOWN_ERROR: CommandErrorPayload = { code: 'unknown', message: '未知错误' }

/**
 * 解析 invoke 抛出的错误：后端 CommandError 序列化为 `{ code, message }`，
 * 其余类型（字符串 / Error / 其它）兜底为 unknown。
 */
export function parseCommandError(e: unknown): CommandErrorPayload {
  if (e && typeof e === 'object') {
    const obj = e as { code?: unknown; message?: unknown }
    if (typeof obj.code === 'string') {
      return {
        code: obj.code,
        message: typeof obj.message === 'string' ? obj.message : String(e),
      }
    }
  }
  if (e instanceof Error) {
    return { code: 'unknown', message: e.message }
  }
  if (typeof e === 'string') {
    return { code: 'unknown', message: e }
  }
  return UNKNOWN_ERROR
}

/** 取错误展示文案（后端中文消息优先） */
export function errorMessage(e: unknown): string {
  return parseCommandError(e).message
}
