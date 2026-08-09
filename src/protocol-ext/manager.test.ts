import { describe, it, expect } from 'vitest'
import { parseCsvTable } from './manager'
import { shouldHotReload } from './devReload'

describe('shouldHotReload', () => {
  it('首次采样不触发', () => {
    expect(shouldHotReload(undefined, 100)).toBe(false)
  })
  it('mtime 变化时触发', () => {
    expect(shouldHotReload(100, 200)).toBe(true)
  })
  it('mtime 相同不触发', () => {
    expect(shouldHotReload(100, 100)).toBe(false)
  })
})

describe('parseCsvTable', () => {
  it('解析表头 + 数据行', () => {
    const rows = parseCsvTable('name,addr,count\ndev1,1,10\ndev2,2,5\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'dev1', addr: 1, count: 10 })
    expect(rows[1].addr).toBe(2)
  })

  it('数字自动转 number，非数字保留字符串', () => {
    const rows = parseCsvTable('name,note\na,x\na,')
    expect(rows[1]).toEqual({ name: 'a', note: undefined })
  })

  it('支持引号包裹的逗号', () => {
    const rows = parseCsvTable('a,b\n"x,y",z')
    expect(rows[0].a).toBe('x,y')
  })

  it('少于两行返回空', () => {
    expect(parseCsvTable('a,b')).toEqual([])
    expect(parseCsvTable('')).toEqual([])
  })
})
