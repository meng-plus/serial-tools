import { describe, it, expect } from 'vitest'
import { cacheFileBytes, getCachedFile, dropCachedFile } from './fileCache'

describe('fileCache', () => {
  it('存入并取回文件字节', () => {
    const token = cacheFileBytes('fw.bin', [1, 2, 3, 255])
    const f = getCachedFile(token)
    expect(f).toEqual({ name: 'fw.bin', bytes: [1, 2, 3, 255] })
  })

  it('token 各不相同', () => {
    const a = cacheFileBytes('a', [1])
    const b = cacheFileBytes('b', [2])
    expect(a).not.toBe(b)
  })

  it('drop 后取回 null；未知 token 返回 null', () => {
    const token = cacheFileBytes('c', [9])
    dropCachedFile(token)
    expect(getCachedFile(token)).toBeNull()
    expect(getCachedFile('no-such-token')).toBeNull()
  })
})
