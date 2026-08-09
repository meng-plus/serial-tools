import { describe, expect, it } from 'vitest'
import {
  BAUD_RATE_PRESETS,
  baudRateSelectOptions,
  parseBaudRate,
} from './baudRate'

describe('parseBaudRate', () => {
  it('接受正整数与纯数字字符串', () => {
    expect(parseBaudRate(115200)).toBe(115200)
    expect(parseBaudRate('3000000')).toBe(3_000_000)
    expect(parseBaudRate(' 14400 ')).toBe(14400)
  })

  it('拒绝非法值', () => {
    expect(parseBaudRate(0)).toBeNull()
    expect(parseBaudRate(-1)).toBeNull()
    expect(parseBaudRate(115200.5)).toBeNull()
    expect(parseBaudRate('abc')).toBeNull()
    expect(parseBaudRate('115200x')).toBeNull()
    expect(parseBaudRate('')).toBeNull()
    expect(parseBaudRate(0x1_0000_0000)).toBeNull()
  })
})

describe('baudRateSelectOptions', () => {
  it('预设含 2000000，并合并自定义值升序', () => {
    expect(BAUD_RATE_PRESETS).toContain(2_000_000)
    const opts = baudRateSelectOptions(14400, 3_000_000)
    const values = opts.map((o) => o.value)
    expect(values).toContain(14400)
    expect(values).toContain(3_000_000)
    expect(values).toContain(2_000_000)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })
})
