import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkspaceStore } from './workspaceStore'

describe('workspaceStore.removeProtocolPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('删除实例面板并保留其他视图', () => {
    const ws = useWorkspaceStore()
    ws.ensureChannel('ch1')
    ws.addView('ch1', 'protocol_panel', { instanceId: 'inst-1' })
    ws.addView('ch1', 'chart', { valueIds: [] })

    expect(ws.viewsByChannel['ch1']).toHaveLength(3) // terminal + panel + chart
    ws.removeProtocolPanel('ch1', 'inst-1')
    const list = ws.viewsByChannel['ch1']
    expect(list).toHaveLength(2)
    expect(list.some(v => v.type === 'protocol_panel')).toBe(false)
  })

  it('删除全部视图后回填默认终端', () => {
    const ws = useWorkspaceStore()
    ws.ensureChannel('ch1')
    ws.addView('ch1', 'protocol_panel', { instanceId: 'inst-1' })
    // 仅剩面板，无其他视图
    ws.viewsByChannel['ch1'] = ws.viewsByChannel['ch1'].filter(v => v.type === 'protocol_panel')
    expect(ws.viewsByChannel['ch1']).toHaveLength(1)

    ws.removeProtocolPanel('ch1', 'inst-1')
    const list = ws.viewsByChannel['ch1']
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('terminal')
  })

  it('面板不可被 closeView 关闭，但可被 removeProtocolPanel 清理', () => {
    const ws = useWorkspaceStore()
    ws.ensureChannel('ch1')
    const view = ws.addView('ch1', 'protocol_panel', { instanceId: 'inst-1' })

    ws.closeView('ch1', view!.id)
    expect(ws.viewsByChannel['ch1'].some(v => v.id === view!.id)).toBe(true)

    ws.removeProtocolPanel('ch1', 'inst-1')
    expect(ws.viewsByChannel['ch1'].some(v => v.id === view!.id)).toBe(false)
  })

  it('moveProtocolPanel 从旧通道迁到新通道，不留孤儿面板', () => {
    const ws = useWorkspaceStore()
    ws.ensureChannel('ch1')
    ws.ensureChannel('ch2')
    ws.addView('ch1', 'protocol_panel', { instanceId: 'inst-1' })

    ws.moveProtocolPanel('ch1', 'ch2', 'inst-1')
    expect(ws.viewsByChannel['ch1'].some(v => v.type === 'protocol_panel')).toBe(false)
    expect(
      ws.viewsByChannel['ch2'].some(
        v => v.type === 'protocol_panel' && String(v.config?.instanceId) === 'inst-1',
      ),
    ).toBe(true)
  })
})
