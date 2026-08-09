import { describe, it, expect } from 'vitest'
import { applyQueryBindings, formatQueryValue, getByPath } from './queryBindings'

describe('queryBindings', () => {
  it('getByPath / format', () => {
    expect(getByPath({ upgrade: { addr_start: 0x4000 } }, 'upgrade.addr_start')).toBe(0x4000)
    expect(formatQueryValue(0x4000, 'hex')).toBe('0x4000')
    expect(formatQueryValue(128, 'hex_size')).toBe('0x80（128 字节）')
    expect(formatQueryValue(true, 'bool_cn')).toBe('支持')
    expect(formatQueryValue(false, 'bool_cn')).toBe('不支持')
  })

  it('applyQueryBindings 写 info 与 setParam', () => {
    const infos: { key: string; text: string; level?: string }[] = []
    const patches: Record<string, unknown>[] = []
    const ok = applyQueryBindings(
      [
        {
          action: 'q4201',
          info: [
            { from: 'upgrade.supported', key: 'upgrade_supported', label: '升级支持', format: 'bool_cn' },
            { from: 'upgrade.addr_start', key: 'upgrade_addr_start', format: 'hex' },
          ],
          setParam: {
            firmware_start: { from: 'upgrade.addr_start', format: 'hex' },
          },
        },
      ],
      'q4201',
      { upgrade: { supported: true, addr_start: 0x4000 } },
      {
        emitInfo: s => infos.push(s),
        setParam: p => patches.push(p),
      },
    )
    expect(ok).toBe(true)
    expect(infos).toEqual([
      { key: 'upgrade_supported', text: '支持', label: '升级支持', level: 'info' },
      { key: 'upgrade_addr_start', text: '0x4000', label: undefined, level: undefined },
    ])
    expect(patches).toEqual([{ firmware_start: '0x4000' }])
  })

  it('未知 action 返回 false', () => {
    expect(applyQueryBindings([], 'x', {}, { emitInfo: () => {}, setParam: () => {} })).toBe(false)
  })
})
