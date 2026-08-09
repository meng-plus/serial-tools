import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createContext } from './ctx'
import { upsertInstanceInfo, type ProtocolInfoEntry } from './infoMap'

describe('upsertInstanceInfo', () => {
  it('写入并覆盖同 key', () => {
    let map: Record<string, ProtocolInfoEntry> = {}
    map = upsertInstanceInfo(map, { key: 'product_name', text: 'A', label: '产品名' })
    expect(map.product_name.text).toBe('A')
    map = upsertInstanceInfo(map, { key: 'product_name', text: 'B' })
    expect(map.product_name.text).toBe('B')
    expect(map.product_name.label).toBe('产品名') // 未传 label 时保留旧 label
  })

  it('支持 level', () => {
    const map = upsertInstanceInfo({}, { key: 'upgrade', text: '不支持', level: 'warn' })
    expect(map.upgrade.level).toBe('warn')
  })
})

describe('selectInfoEntries', () => {
  it('按 keys 顺序过滤；无 keys 返回全部', async () => {
    const { selectInfoEntries } = await import('./infoMap')
    let map: Record<string, ProtocolInfoEntry> = {}
    map = upsertInstanceInfo(map, { key: 'b', text: '2', label: 'B' })
    map = upsertInstanceInfo(map, { key: 'a', text: '1', label: 'A' })
    expect(selectInfoEntries(map, ['a']).map(e => e.key)).toEqual(['a'])
    expect(selectInfoEntries(map).map(e => e.key)).toEqual(['a', 'b'])
  })
})

describe('createContext emitInfo/setParam', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('emitInfo / setParam 转发到 opts', () => {
    const infos: unknown[] = []
    const patches: Record<string, unknown>[] = []
    const progresses: unknown[] = []
    const ctx = createContext({
      instanceId: 'pi-1',
      protocolId: 'doi-master',
      channelId: 'ch-1',
      getParam: () => undefined,
      pushLog: () => {},
      registerTimer: () => 1,
      emitInfo: s => infos.push(s),
      emitProgress: s => progresses.push(s),
      setParam: p => patches.push(p),
      getQueries: () => undefined,
    })
    ctx.emitInfo({ key: 'product_name', text: 'DOI-X', label: '产品名称' })
    ctx.setParam({ firmware_start: '0x4000' })
    ctx.emitProgress({ id: 'ota', current: 1, total: 10, label: '下载' })
    expect(infos).toEqual([{ key: 'product_name', text: 'DOI-X', label: '产品名称' }])
    expect(patches).toEqual([{ firmware_start: '0x4000' }])
    expect(progresses).toEqual([{ id: 'ota', current: 1, total: 10, label: '下载' }])
  })
})
