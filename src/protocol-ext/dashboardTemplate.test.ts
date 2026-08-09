import { describe, it, expect } from 'vitest'
import { buildPanelControls } from './dashboardTemplate'
import type { ProtocolManifest } from './types'

function manifest(partial: Partial<ProtocolManifest>): ProtocolManifest {
  return {
    id: 'test',
    name: '测试协议',
    version: '1.0.0',
    apiVersion: 1,
    role: 'master',
    entry: 'main.js',
    channelTypes: ['serial'],
    capabilities: ['send'],
    ui: {},
    ...partial,
  }
}

describe('buildPanelControls', () => {
  it('ui.dashboard 模板优先，透传 group', () => {
    const m = manifest({
      ui: {
        groups: [{ id: 'dev', label: '设备A', buttons: [] }],
        dashboard: [
          {
            id: 'd1',
            type: 'register_grid',
            row: 0,
            col: 0,
            w: 12,
            h: 8,
            group: 'dev',
            grid: { label: '寄存器', paramKey: 'poll', editable: true },
          },
        ],
      },
    })
    const controls = buildPanelControls(m)
    expect(controls).toHaveLength(1)
    expect(controls[0].group).toBe('dev')
  })

  it('无 dashboard 模板时默认网格归属第一个分组', () => {
    const m = manifest({
      ui: {
        groups: [{ id: 'dev', label: '设备A' }],
        params: [
          { key: 'poll', label: '轮询表', type: 'table', columns: [{ key: 'addr', label: '地址' }] },
        ],
        actions: [{ id: 'read_all', label: '读取' }],
      },
    })
    const controls = buildPanelControls(m)
    const grids = controls.filter(c => c.type === 'register_grid')
    const buttons = controls.filter(c => c.type === 'button')
    expect(grids).toHaveLength(1)
    expect(grids[0].group).toBe('dev')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].group).toBe('dev')
  })

  it('无 groups 声明时默认网格无归属', () => {
    const m = manifest({ ui: {} })
    const controls = buildPanelControls(m)
    expect(controls).toHaveLength(1)
    expect(controls[0].group).toBeUndefined()
  })

  it('dashboard 模板支持 value / chart 控件并透传 maxPoints', () => {
    const m = manifest({
      ui: {
        dashboard: [
          { id: 'c1', type: 'value', row: 0, col: 0, w: 4, h: 3, title: '温度', valueIds: ['temp'] },
          {
            id: 'ch1',
            type: 'chart',
            row: 0,
            col: 4,
            w: 8,
            h: 6,
            title: '温度波形',
            valueIds: ['temp'],
            maxPoints: 200,
          },
        ],
      },
    })
    const controls = buildPanelControls(m)
    expect(controls).toHaveLength(2)
    expect(controls[0].type).toBe('value')
    expect(controls[0].valueIds).toEqual(['temp'])
    expect(controls[1].type).toBe('chart')
    expect(controls[1].maxPoints).toBe(200)
  })
})
