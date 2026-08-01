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
}

let viewSeq = 0

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
      // 同步展示名（如 terminal → 收发日志）
      const list = viewsByChannel.value[channelId].map(v => ({
        ...v,
        title: VIEW_TITLES[v.type] || v.title,
      }))
      viewsByChannel.value = { ...viewsByChannel.value, [channelId]: list }
    }
  }

  function openChannel(channelId: string) {
    ensureChannel(channelId)
    if (activeChannelId.value !== channelId) exitViewImmersive()
    activeChannelId.value = channelId
  }

  function addView(channelId: string, type: ViewType, config: Record<string, unknown> = {}) {
    ensureChannel(channelId)
    const initialConfig =
      type === 'chart'
        ? { valueIds: [] as string[], maxPoints: 100, ...config }
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
    const list = (viewsByChannel.value[channelId] || []).filter(v => v.id !== viewId)
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

  function removeChannel(channelId: string) {
    const { [channelId]: _, ...rest } = viewsByChannel.value
    viewsByChannel.value = rest
    const { [channelId]: __, ...restActive } = activeViewIdByChannel.value
    activeViewIdByChannel.value = restActive
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
    const views: ViewInstance[] = (templates.length ? templates : [{ type: 'terminal' as ViewType }]).map(t => ({
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
    addView,
    closeView,
    removeChannel,
    updateViewConfig,
    replaceViewsFromTemplates,
    VIEW_TITLES,
  }
})
