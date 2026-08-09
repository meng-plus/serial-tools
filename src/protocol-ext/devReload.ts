/** Dev 协议热重载：mtime 变化判定（纯函数，便于单测） */

/** 是否应触发热重载：已有基线且 mtime 前进 */
export function shouldHotReload(prevMtime: number | undefined, nextMtime: number): boolean {
  if (prevMtime === undefined) return false
  if (nextMtime <= 0) return false
  return nextMtime !== prevMtime
}
