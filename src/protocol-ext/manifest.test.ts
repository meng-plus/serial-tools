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

  it('解析 ui.groups 分组与组内动作按钮', () => {
    const m = parseManifest(`
id: grouped-protocol
version: 1.0.0
role: master
ui:
  groups:
    - id: device_a
      label: 设备A
      buttons:
        - { id: read_all, label: 读取全部, kind: read, action: read_all }
        - { id: write_cfg, label: 写入配置, kind: write, action: write_cfg, args: { addr: "{addr}" } }
        - { id: bad, label: "" }
  dashboard:
    - id: d1
      type: register_grid
      group: device_a
      grid:
        label: 寄存器
`)
    expect(m.ui.groups).toHaveLength(1)
    const g = m.ui.groups![0]
    expect(g.id).toBe('device_a')
    expect(g.label).toBe('设备A')
    expect(g.buttons).toHaveLength(3)
    expect(g.buttons![0]).toEqual({ id: 'read_all', label: '读取全部', kind: 'read', action: 'read_all' })
    expect(g.buttons![1]).toEqual({
      id: 'write_cfg',
      label: '写入配置',
      kind: 'write',
      action: 'write_cfg',
      args: { addr: '{addr}' },
    })
    // 空 label 回退为按钮 id
    expect(g.buttons![2]).toEqual({ id: 'bad', label: 'bad' })
    expect(m.ui.dashboard?.[0].group).toBe('device_a')
  })

  it('解析 ui.queries 声明式绑定', () => {
    const m = parseManifest(`
id: q-demo
version: 1.0.0
ui:
  queries:
    - action: q4201
      info:
        - { from: upgrade.addr_start, key: upgrade_addr_start, label: APP, format: hex }
      setParam:
        firmware_start: { from: upgrade.addr_start, format: hex }
`)
    expect(m.ui.queries).toHaveLength(1)
    expect(m.ui.queries![0].action).toBe('q4201')
    expect(m.ui.queries![0].info?.[0]).toMatchObject({
      from: 'upgrade.addr_start',
      key: 'upgrade_addr_start',
      format: 'hex',
    })
    expect(m.ui.queries![0].setParam?.firmware_start).toEqual({
      from: 'upgrade.addr_start',
      format: 'hex',
    })
  })

  it('ui.groups 重复 id 去重', () => {
    const m = parseManifest(`
id: dup-group
version: 1.0.0
ui:
  groups:
    - { id: a, label: A }
    - { id: a, label: B }
`)
    expect(m.ui.groups).toHaveLength(1)
    expect(m.ui.groups![0].label).toBe('A')
  })

  it('解析 ui.presets 参数预设', () => {
    const m = parseManifest(`
id: preset-proto
version: 1.0.0
role: master
ui:
  presets:
    - id: hx711_50kg
      label: HX711 50kg 称重传感器
      params:
        gain: 128
        scale: 2100.5
    - id: hx711_5kg
      label: HX711 5kg 称重传感器
      params:
        gain: 128
        scale: 920.3
    - id: empty
      label: 空预设
`)
    expect(m.ui.presets).toHaveLength(3)
    expect(m.ui.presets![0]).toEqual({
      id: 'hx711_50kg',
      label: 'HX711 50kg 称重传感器',
      params: { gain: 128, scale: 2100.5 },
    })
    expect(m.ui.presets![1]).toEqual({
      id: 'hx711_5kg',
      label: 'HX711 5kg 称重传感器',
      params: { gain: 128, scale: 920.3 },
    })
    expect(m.ui.presets![2]).toEqual({ id: 'empty', label: '空预设' })
  })

  it('ui.presets 重复 id 去重', () => {
    const m = parseManifest(`
id: dup-preset
version: 1.0.0
ui:
  presets:
    - { id: a, label: A }
    - { id: a, label: B }
`)
    expect(m.ui.presets).toHaveLength(1)
    expect(m.ui.presets![0].label).toBe('A')
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

  it('file 参数支持 accept 且默认值为空元数据', () => {
    const m = parseManifest(`
id: ymodem
version: 1.0.0
role: master
ui:
  params:
    - key: file
      label: 固件文件
      type: file
      accept: ".bin,.hex"
`)
    const p = defaultParams(m)
    expect(m.ui.params?.[0].accept).toBe('.bin,.hex')
    expect(p.file).toEqual({ name: '', size: 0, token: '' })
  })
})
