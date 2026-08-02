import { describe, it, expect } from 'vitest'
import { parseCsvTable } from './manager'

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
