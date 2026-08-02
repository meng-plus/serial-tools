import { describe, it, expect } from 'vitest'
import { parseManifest, defaultParams, ManifestError } from './manifest'

const VALID = `
id: modbus-rtu-master
name: Modbus RTU 主站
version: 1.0.0
apiVersion: 1
role: master
entry: main.js
channelTypes: [serial]
capabilities: [send, chart]
ui:
  params:
    - key: cycle_ms
      label: 轮询周期
      type: number
      default: 500
    - key: poll
      label: 轮询表
      type: table
      columns:
        - { key: addr, label: 地址, type: number, default: 1 }
    - key: byte_order
      label: 字节序
      type: select
      default: be
      options:
        - { value: be, label: 大端 }
  actions:
    - id: read_all
      label: 立即读取
  variables:
    - { key: temp, label: 温度, unit: ℃ }
`

describe('parseManifest', () => {
  it('解析合法 YAML', () => {
    const m = parseManifest(VALID)
    expect(m.id).toBe('modbus-rtu-master')
    expect(m.role).toBe('master')
    expect(m.apiVersion).toBe(1)
    expect(m.ui.params).toHaveLength(3)
    expect(m.ui.actions?.[0].id).toBe('read_all')
    expect(m.ui.variables?.[0].key).toBe('temp')
  })

  it('JSON 形式同样可解析', () => {
    const m = parseManifest(JSON.stringify({ id: 'a-b_1', role: 'slave', apiVersion: 1 }))
    expect(m.id).toBe('a-b_1')
    expect(m.role).toBe('slave')
    expect(m.entry).toBe('main.js')
    expect(m.ui.params).toEqual([])
  })

  it('非法 id 抛错', () => {
    expect(() => parseManifest('id: a/b\n')).toThrow(ManifestError)
    expect(() => parseManifest('id: ""\n')).toThrow(ManifestError)
  })

  it('非法 role 抛错', () => {
    expect(() => parseManifest('id: x\nrole: hacker\n')).toThrow(ManifestError)
  })

  it('apiVersion 超出版本抛错', () => {
    expect(() => parseManifest('id: x\napiVersion: 99\n')).toThrow(ManifestError)
  })

  it('非对象抛错', () => {
    expect(() => parseManifest('[]')).toThrow(ManifestError)
    expect(() => parseManifest('')).toThrow(ManifestError)
  })
})

describe('defaultParams', () => {
  it('按 default 与类型生成默认值', () => {
    const m = parseManifest(VALID)
    const p = defaultParams(m)
    expect(p.cycle_ms).toBe(500)
    expect(p.byte_order).toBe('be')
    expect(p.poll).toEqual([])
  })
})
