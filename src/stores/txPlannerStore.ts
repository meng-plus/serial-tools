import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createDefaultTxItem,
  normalizeTxList,
  type FrameProfile,
  type TxListItem,
  type TxListTemplate,
} from '@/workspace/schema'

export function itemTimerKey(channelId: string, itemId: string) {
  return `${channelId}::${itemId}`
}

/** 定时发送；frameProfiles 仅兼容旧 workspace 导入导出 */
export const useTxPlannerStore = defineStore('txPlanner', () => {
  const frameProfiles = ref<FrameProfile[]>([])
  const listsByChannel = ref<Record<string, TxListTemplate>>({})
  /** @deprecated 旧帧配置序号，发送路径已不用 */
  const seqByProfile = ref<Record<string, number>>({})
  /** 条目序号 {{seq}} */
  const seqByItem = ref<Record<string, number>>({})
  /** 通道序号 {{channel.seq}} */
  const seqByChannel = ref<Record<string, number>>({})
  const running = ref<Record<string, boolean>>({})
  const sentCount = ref<Record<string, number>>({})
  const timers = new Map<string, ReturnType<typeof setInterval>>()

  function ensureList(channelId: string): TxListTemplate {
    if (!listsByChannel.value[channelId]) {
      listsByChannel.value = {
        ...listsByChannel.value,
        [channelId]: {
          id: `tx-${channelId}`,
          name: '定时发送',
          items: [],
        },
      }
    }
    return listsByChannel.value[channelId]
  }

  function setList(channelId: string, list: TxListTemplate) {
    listsByChannel.value = {
      ...listsByChannel.value,
      [channelId]: normalizeTxList(list as unknown as Record<string, unknown>),
    }
  }

  function updateItem(channelId: string, itemId: string, patch: Partial<TxListItem>) {
    const list = ensureList(channelId)
    const items = list.items.map(i => (i.id === itemId ? { ...i, ...patch } : i))
    setList(channelId, { ...list, items })
  }

  function setFrameProfiles(list: FrameProfile[]) {
    frameProfiles.value = list.map(p => ({ ...p }))
  }

  function getProfileSeq(profileId: string): number {
    return seqByProfile.value[profileId] ?? 0
  }

  function setProfileSeq(profileId: string, seq: number) {
    seqByProfile.value = { ...seqByProfile.value, [profileId]: seq }
  }

  function getItemSeq(channelId: string, itemId: string): number {
    return seqByItem.value[itemTimerKey(channelId, itemId)] ?? 0
  }

  function setItemSeq(channelId: string, itemId: string, seq: number) {
    const key = itemTimerKey(channelId, itemId)
    seqByItem.value = { ...seqByItem.value, [key]: seq }
  }

  function getChannelSeq(channelId: string): number {
    return seqByChannel.value[channelId] ?? 0
  }

  function setChannelSeq(channelId: string, seq: number) {
    seqByChannel.value = { ...seqByChannel.value, [channelId]: seq }
  }

  function bumpSeqs(channelId: string, itemId: string, usedItem: boolean, usedChannel: boolean) {
    if (usedItem) {
      setItemSeq(channelId, itemId, (getItemSeq(channelId, itemId) + 1) >>> 0)
    }
    if (usedChannel) {
      setChannelSeq(channelId, (getChannelSeq(channelId) + 1) >>> 0)
    }
  }

  function isItemRunning(channelId: string, itemId: string) {
    return !!running.value[itemTimerKey(channelId, itemId)]
  }

  function getSentCount(channelId: string, itemId: string) {
    return sentCount.value[itemTimerKey(channelId, itemId)] ?? 0
  }

  function stopItem(channelId: string, itemId: string) {
    const key = itemTimerKey(channelId, itemId)
    const t = timers.get(key)
    if (t) clearInterval(t)
    timers.delete(key)
    running.value = { ...running.value, [key]: false }
  }

  function stopChannel(channelId: string) {
    const prefix = `${channelId}::`
    for (const key of [...timers.keys()]) {
      if (key.startsWith(prefix)) {
        const itemId = key.slice(prefix.length)
        stopItem(channelId, itemId)
      }
    }
  }

  function stopAll() {
    for (const key of [...timers.keys()]) {
      const idx = key.indexOf('::')
      if (idx < 0) continue
      stopItem(key.slice(0, idx), key.slice(idx + 2))
    }
  }

  /**
   * 启动单条。sendFn 由视图注入。
   * 返回 false 表示条目不存在。
   */
  function startItem(
    channelId: string,
    itemId: string,
    sendFn: (channelId: string, itemId: string) => Promise<void>,
  ): boolean {
    const list = ensureList(channelId)
    const item = list.items.find(i => i.id === itemId)
    if (!item) return false

    stopItem(channelId, itemId)
    const key = itemTimerKey(channelId, itemId)
    sentCount.value = { ...sentCount.value, [key]: 0 }
    running.value = { ...running.value, [key]: true }

    const tick = async () => {
      if (!running.value[key]) return
      const curList = listsByChannel.value[channelId]
      const cur = curList?.items.find(i => i.id === itemId)
      if (!cur) {
        stopItem(channelId, itemId)
        return
      }
      const already = sentCount.value[key] ?? 0
      if (!cur.loop && already >= cur.count) {
        stopItem(channelId, itemId)
        return
      }
      try {
        await sendFn(channelId, itemId)
        const next = (sentCount.value[key] ?? 0) + 1
        sentCount.value = { ...sentCount.value, [key]: next }
        if (!cur.loop && next >= cur.count) {
          stopItem(channelId, itemId)
        }
      } catch (e) {
        console.warn('[txPlanner] send failed', e)
        stopItem(channelId, itemId)
      }
    }

    void tick()
    const handle = setInterval(() => { void tick() }, Math.max(50, item.intervalMs))
    timers.set(key, handle)
    return true
  }

  function startEnabled(
    channelId: string,
    sendFn: (channelId: string, itemId: string) => Promise<void>,
  ): number {
    const list = ensureList(channelId)
    let n = 0
    for (const item of list.items) {
      if (!item.enabled) continue
      if (startItem(channelId, item.id, sendFn)) n += 1
    }
    return n
  }

  function importTemplates(lists: TxListTemplate[], profiles?: FrameProfile[]) {
    if (profiles?.length) setFrameProfiles(profiles)
    if (lists.length) {
      listsByChannel.value = {
        ...listsByChannel.value,
        __template__: normalizeTxList(lists[0] as unknown as Record<string, unknown>),
      }
    }
  }

  function applyTemplateToChannel(channelId: string) {
    const tpl = listsByChannel.value.__template__
    if (!tpl) return
    setList(channelId, {
      ...tpl,
      id: `tx-${channelId}`,
      items: tpl.items.map(i => ({ ...i, id: i.id || createDefaultTxItem().id })),
    })
  }

  // 兼容旧 API 名
  function stop(channelId: string) {
    stopChannel(channelId)
  }

  return {
    frameProfiles,
    listsByChannel,
    running,
    sentCount,
    seqByItem,
    seqByChannel,
    ensureList,
    setList,
    updateItem,
    setFrameProfiles,
    getProfileSeq,
    setProfileSeq,
    getItemSeq,
    setItemSeq,
    getChannelSeq,
    setChannelSeq,
    bumpSeqs,
    isItemRunning,
    getSentCount,
    startItem,
    startEnabled,
    stopItem,
    stopChannel,
    stop,
    stopAll,
    importTemplates,
    applyTemplateToChannel,
    itemTimerKey,
  }
})
