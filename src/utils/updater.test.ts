import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from './updater'

describe('parseVersion', () => {
  it('去掉 v 前缀', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0])
  })

  it('忽略 prerelease 后缀', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3])
  })

  it('缺省段按 0 补全', () => {
    expect(parseVersion('v2.0')).toEqual([2, 0, 0])
  })

  it('异常输入不抛错', () => {
    expect(parseVersion('')).toEqual([0, 0, 0])
    expect(parseVersion('abc')).toEqual([0, 0, 0])
  })
})

describe('compareVersions', () => {
  it('按主 / 次 / 补丁比较', () => {
    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1)
    expect(compareVersions('0.1.0', 'v0.1.1')).toBe(-1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
  })

  it('主版本优先于次 / 补丁', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1)
  })

  it('与 prerelease 后缀版本比较只看三段号', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(0)
  })
})
