/** file 参数的真实字节瞬态缓存：只存运行时，不写工作区，重启后需重新选择 */

let seq = 0
const cache = new Map<string, { name: string; bytes: number[] }>()

/** 存入文件字节并返回 token（file 参数值引用它取回） */
export function cacheFileBytes(name: string, bytes: number[]): string {
  const token = `f-${Date.now()}-${++seq}`
  cache.set(token, { name, bytes })
  return token
}

/** 按 token 取回文件；不存在（未选择 / 已失效）返回 null */
export function getCachedFile(token: string): { name: string; bytes: number[] } | null {
  return cache.get(token) ?? null
}

/** 清理某个 token 的缓存（参数被清除时调用） */
export function dropCachedFile(token: string): void {
  cache.delete(token)
}
