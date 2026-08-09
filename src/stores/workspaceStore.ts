import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ViewInstance, ViewType } from '@/protocol/types'

const VIEW_TITLES: Record<ViewType, string> = {
  terminal: '收发日志',
  parsed_log: '解析日志',
  monitor: '监控',
  chart: '图表',
  tx_list: '定时发送',
  chat: '对话',
  vt100: 'VT100',
  protocol_panel: '协议实例',
}

let viewSeq = 0

/** 定时发送面板：浮动抽屉 / 右侧停靠；宽度可拖拽 */
export interface TxPanelState {
  open: boolean
  docked: boolean
  width: number
}

export const TX_PANEL_WIDTH_MIN = 360
export const TX_PANEL_WIDTH_MAX = 900
export const TX_PANEL_WIDTH_DEFAULT = 560

function clampTxWidth(w: number): number {
  return Math.min(TX_PANEL_WIDTH_MAX, Math.max(TX_PANEL_WIDTH_MIN, Math.round(w)))
}

function defaultViews(channelId: string): ViewInstance[] {
  return [
    {
      id: `view-${++viewSeq}`,
      type: 'terminal',
      channelId,
      title: VIEW_TITLES.terminal,
      config: {},
    },
  ]
}

/** 通道工作区：活动通道 + 每通道视图 Tab（视图固定 channelId） */
export const useWorkspaceStore = defineStore('workspace', () => {
  const activeChannelId = ref<string>('')
  const viewsByChannel = ref<Record<string, ViewInstance[]>>({})
  const activeViewIdByChannel = ref<Record<string, string>>({})
  /** 当前活动视图沉浸铺满窗口（F11） */
  const viewImmersive = ref(false)

  /** 定时发送面板：浮动抽屉 / 右侧停靠；宽度可拖拽 */
  const txPanelByChannel = ref<Record<string, TxPanelState>>({})

  function ensureTxPanel(channelId: string): TxPanelState {
    const cur = txPanelByChannel.value[channelId]
    if (cur) return cur
    const fresh: TxPanelState = {
      open: false,
      docked: false,
      width: TX_PANEL_WIDTH_DEFAULT,
    }
    txPanelByChannel.value = { ...txPanelByChannel.value, [channelId]: fresh }
    return fresh
  }

  function getTxPanel(channelId: string): TxPanelState {
    return (
      txPanelByChannel.value[channelId] || {
        open: false,
        docked: false,
        width: TX_PANEL_WIDTH_DEFAULT,
      }
    )
  }

  function isTxPanelOpen(channelId: string): boolean {
    return !!txPanelByChannel.value[channelId]?.open
  }

  function patchTxPanel(channelId: string, patch: Partial<TxPanelState>) {
    if (!channelId) return
    const cur = ensureTxPanel(channelId)
    const next: TxPanelState = {
      open: patch.open ?? cur.open,
      docked: patch.docked ?? cur.docked,
      width: clampTxWidth(patch.width ?? cur.width),
    }
    txPanelByChannel.value = { ...txPanelByChannel.value, [channelId]: next }
  }

  function openTxPanel(channelId: string) {
    patchTxPanel(channelId, { open: true })
  }

  function closeTxPanel(channelId: string) {
    patchTxPanel(channelId, { open: false })
  }

  function toggleTxPanel(channelId: string) {
    if (isTxPanelOpen(channelId)) closeTxPanel(channelId)
    else openTxPanel(channelId)
  }

  function setTxPanelDocked(channelId: string, docked: boolean) {
    patchTxPanel(channelId, { docked, open: true })
  }

  function setTxPanelWidth(channelId: string, width: number) {
    patchTxPanel(channelId, { width })
  }

  function setViewImmersive(on: boolean) {
    viewImmersive.value = on
    document.body.classList.toggle('view-immersive', on)
  }

  function toggleViewImmersive() {
    setViewImmersive(!viewImmersive.value)
  }

  function exitViewImmersive() {
    if (viewImmersive.value) setViewImmersive(false)
  }

  const activeViews = computed(() => {
    const id = activeChannelId.value
    if (!id) return [] as ViewInstance[]
    return viewsByChannel.value[id] || []
  })

  const activeViewId = computed({
    get: () => activeViewIdByChannel.value[activeChannelId.value] || '',
    set: (vid: string) => {
      if (!activeChannelId.value) return
      activeViewIdByChannel.value = {
        ...activeViewIdByChannel.value,
        [activeChannelId.value]: vid,
      }
    },
  })

  function ensureChannel(channelId: string) {
    if (!viewsByChannel.value[channelId]) {
      const views = defaultViews(channelId)
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: views }
      activeViewIdByChannel.value = {
        ...activeViewIdByChannel.value,
        [channelId]: views[0].id,
      }
    } else {
      // 同步展示名；旧 tx_list Tab 迁移为右侧抽屉
      const prev = viewsByChannel.value[channelId]
      const hadTxList = prev.some(v => v.type === 'tx_list')
      let list: ViewInstance[] = prev
        .filter(v => v.type !== 'tx_list')
        .map(v => ({
          ...v,
          title: VIEW_TITLES[v.type] || v.title,
        }))
      if (list.length === 0) list = defaultViews(channelId)
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: list }
      const curActive = activeViewIdByChannel.value[channelId]
      if (!list.some(v => v.id === curActive)) {
        activeViewIdByChannel.value = {
          ...activeViewIdByChannel.value,
          [channelId]: list[0].id,
        }
      }
      if (hadTxList) openTxPanel(channelId)
    }
  }

  function openChannel(channelId: string) {
    ensureChannel(channelId)
    if (activeChannelId.value !== channelId) exitViewImmersive()
    activeChannelId.value = channelId
  }

  function addView(channelId: string, type: ViewType, config: Record<string, unknown> = {}) {
    // 定时发送已改为右侧抽屉，不再作为视图 Tab
    if (type === 'tx_list') {
      openTxPanel(channelId)
      return null
    }
    ensureChannel(channelId)
    // 协议实例面板为唯一视图：同一实例只允许一个面板，且应经 addView 幂等创建
    if (type === 'protocol_panel') {
      const instanceId = String(config.instanceId || '')
      const existing = (viewsByChannel.value[channelId] || []).find(
        v => v.type === 'protocol_panel' && String(v.config?.instanceId || '') === instanceId,
      )
      if (existing) {
        activeViewIdByChannel.value = {
          ...activeViewIdByChannel.value,
          [channelId]: existing.id,
        }
        return existing
      }
    }
    const initialConfig =
      type === 'chart'
        ? { valueIds: [] as string[], maxPoints: 100, ...config }
        : type === 'protocol_panel'
          ? { instanceId: String(config.instanceId || ''), ...config }
          : { ...config }
    const view: ViewInstance = {
      id: `view-${++viewSeq}`,
      type,
      channelId,
      title: VIEW_TITLES[type],
      config: initialConfig,
    }
    const list = [...(viewsByChannel.value[channelId] || []), view]
    viewsByChannel.value = { ...viewsByChannel.value, [channelId]: list }
    activeViewIdByChannel.value = {
      ...activeViewIdByChannel.value,
      [channelId]: view.id,
    }
    return view
  }

  function closeView(channelId: string, viewId: string) {
    const list = (viewsByChannel.value[channelId] || []).filter(v => {
      // 协议实例面板为唯一视图：不可关闭
      if (v.id === viewId && v.type === 'protocol_panel') return true
      return v.id !== viewId
    })
    if (list.length === 0) {
      // 至少保留一个终端
      const fallback = defaultViews(channelId)
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: fallback }
      activeViewIdByChannel.value = {
        ...activeViewIdByChannel.value,
        [channelId]: fallback[0].id,
      }
      return
    }
    viewsByChannel.value = { ...viewsByChannel.value, [channelId]: list }
    if (activeViewIdByChannel.value[channelId] === viewId) {
      activeViewIdByChannel.value = {
        ...activeViewIdByChannel.value,
        [channelId]: list[0].id,
      }
    }
  }

  /** 删除协议实例时清理其面板视图（不受「不可关闭」限制；至少保留一个终端） */
  function removeProtocolPanel(channelId: string, instanceId: string) {
    const list = (viewsByChannel.value[channelId] || []).filter(
      v => !(v.type === 'protocol_panel' && String(v.config?.instanceId || '') === instanceId),
    )
    if (list.length === 0) {
      const fallback = defaultViews(channelId)
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: fallback }
      activeViewIdByChannel.value = {
        ...activeViewIdByChannel.value,
        [channelId]: fallback[0].id,
      }
      return
    }
    viewsByChannel.value = { ...viewsByChannel.value, [channelId]: list }
  }

  /** 实例换通道：旧通道移除面板，新通道补齐（避免遗留不可关闭的孤儿标签） */
  function moveProtocolPanel(fromChannelId: string, toChannelId: string, instanceId: string) {
    if (!instanceId || fromChannelId === toChannelId) return
    if (fromChannelId) removeProtocolPanel(fromChannelId, instanceId)
    if (toChannelId) ensureProtocolPanels(toChannelId, [instanceId])
  }

  function removeChannel(channelId: string) {
    const { [channelId]: _, ...rest } = viewsByChannel.value
    viewsByChannel.value = rest
    const { [channelId]: __, ...restActive } = activeViewIdByChannel.value
    activeViewIdByChannel.value = restActive
    const { [channelId]: ___, ...restPanel } = txPanelByChannel.value
    txPanelByChannel.value = restPanel
    if (activeChannelId.value === channelId) {
      activeChannelId.value = ''
      exitViewImmersive()
    }
  }

  function updateViewConfig(
    channelId: string,
    viewId: string,
    config: Record<string, unknown>,
  ) {
    const list = viewsByChannel.value[channelId]
    if (!list) return
    const idx = list.findIndex(v => v.id === viewId)
    if (idx < 0) return
    const next = [...list]
    next[idx] = {
      ...next[idx],
      config: { ...next[idx].config, ...config },
    }
    viewsByChannel.value = { ...viewsByChannel.value, [channelId]: next }
  }

  /** 用模板替换某通道视图（导入 Workspace 用） */
  function replaceViewsFromTemplates(
    channelId: string,
    templates: { type: ViewType; title?: string; config?: Record<string, unknown> }[],
  ) {
    const hadTxList = templates.some(t => t.type === 'tx_list')
    const cleaned = templates.filter(t => t.type !== 'tx_list')
    const views: ViewInstance[] = (cleaned.length ? cleaned : [{ type: 'terminal' as ViewType }]).map(t => ({
      id: `view-${++viewSeq}`,
      type: t.type,
      channelId,
      title: t.title || VIEW_TITLES[t.type],
      config: { ...(t.config || {}) },
    }))
    viewsByChannel.value = { ...viewsByChannel.value, [channelId]: views }
    activeViewIdByChannel.value = {
      ...activeViewIdByChannel.value,
      [channelId]: views[0].id,
    }
    if (hadTxList) openTxPanel(channelId)
  }

  /**
   * 为通道中尚无面板的协议实例自动补齐 protocol_panel 视图（升级/建实例后自动出面板）。
   * instanceIds 为当前通道存在实例的 id 列表。
   */
  function ensureProtocolPanels(channelId: string, instanceIds: string[]) {
    if (!channelId || instanceIds.length === 0) return
    let list = viewsByChannel.value[channelId]
    if (!list) {
      ensureChannel(channelId)
      list = viewsByChannel.value[channelId]
    }
    const existing = new Set(
      (list || [])
        .filter(v => v.type === 'protocol_panel')
        .map(v => String(v.config?.instanceId || '')),
    )
    let changed = false
    let next = [...(list || [])]
    for (const instanceId of instanceIds) {
      if (existing.has(instanceId)) continue
      const view: ViewInstance = {
        id: `view-${++viewSeq}`,
        type: 'protocol_panel',
        channelId,
        title: VIEW_TITLES.protocol_panel,
        config: { instanceId },
      }
      next.push(view)
      changed = true
    }
    if (changed) {
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: next }
    }
  }

  return {
    activeChannelId,
    viewsByChannel,
    activeViews,
    activeViewId,
    viewImmersive,
    setViewImmersive,
    toggleViewImmersive,
    exitViewImmersive,
    openChannel,
    ensureChannel,
    ensureProtocolPanels,
    addView,
    closeView,
    removeProtocolPanel,
    moveProtocolPanel,
    removeChannel,
    updateViewConfig,
    replaceViewsFromTemplates,
    VIEW_TITLES,
    openTxPanel,
    closeTxPanel,
    toggleTxPanel,
    isTxPanelOpen,
    getTxPanel,
    setTxPanelDocked,
    setTxPanelWidth,
  }
})
