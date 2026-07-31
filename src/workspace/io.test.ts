import { describe, it, expect } from 'vitest'
import { buildWorkspacePackage, parseWorkspace, serializeWorkspace } from './io'

describe('workspace io', () => {
  it('roundtrips yaml package with per-item timers', () => {
    const pkg = buildWorkspacePackage({
      rules: [{
        id: 'r1',
        name: 't',
        type: 'regex',
        enabled: true,
        pattern: 'A(\\d+)',
        fields: [{ name: 'a', group: 1, as: 'number', valueId: 'a' }],
      }],
      views: [{
        id: 'v1',
        type: 'chart',
        channelId: 'serial-COM3',
        title: '图表',
        config: { valueIds: ['a'], maxPoints: 50 },
      }],
      txLists: [{
        id: 'tx1',
        name: '轮询',
        items: [{
          id: 'i1',
          format: 'hex',
          payload: '01 03 {{seq:u8}}',
          enabled: true,
          intervalMs: 500,
          loop: false,
          count: 3,
        }],
      }],
      frameProfiles: [{
        id: 'crc',
        name: 'CRC16',
        checksum: 'crc16_modbus',
        seqOffset: -1,
      }],
    })
    const yaml = serializeWorkspace(pkg, 'yaml')
    const back = parseWorkspace(yaml)
    expect(back.kind).toBe('workspace_package')
    expect(back.rules).toHaveLength(1)
    expect(back.rules[0]).not.toHaveProperty('channelId')
    expect(back.viewTemplates[0].type).toBe('chart')
    expect(back.viewTemplates[0].config?.valueIds).toEqual(['a'])
    expect(back.txLists[0].items[0].intervalMs).toBe(500)
    expect(back.txLists[0].items[0].count).toBe(3)
    expect(back.txLists[0]).not.toHaveProperty('intervalMs')
    expect(back.frameProfiles[0].checksum).toBe('crc16_modbus')
  })

  it('migrates legacy list-level interval/loop and drops suffix', () => {
    const raw = JSON.stringify({
      kind: 'workspace_package',
      version: 1,
      txLists: [{
        id: 'tx1',
        name: '旧',
        intervalMs: 2000,
        loop: false,
        items: [{
          id: 'i1',
          format: 'text',
          payload: 'hi',
          suffix: 'crlf',
        }],
      }],
    })
    const pkg = parseWorkspace(raw)
    const item = pkg.txLists[0].items[0]
    expect(item.intervalMs).toBe(2000)
    expect(item.loop).toBe(false)
    expect(item.enabled).toBe(true)
    expect(item.count).toBe(1)
    expect(item).not.toHaveProperty('suffix')
  })

  it('accepts legacy rules_session', () => {
    const raw = JSON.stringify({
      kind: 'rules_session',
      rules: [{ id: 'x', name: 'n', type: 'json', enabled: true, pattern: '', fields: [] }],
    })
    const pkg = parseWorkspace(raw)
    expect(pkg.rules).toHaveLength(1)
    expect(pkg.viewTemplates).toEqual([])
  })
})
