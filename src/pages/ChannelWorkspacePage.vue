<template>
  <div class="channel-workspace">
    <div class="ws-header">
      <div class="ws-title">
        <span class="label">通道</span>
        <strong>{{ channelLabel }}</strong>
        <a-tag :color="channelMeta?.connected ? 'success' : 'default'" size="small">
          {{ channelMeta?.connected ? '已连接' : '未连接' }}
        </a-tag>
        <a-tag v-if="channelMeta" size="small">{{ channelMeta.transportType }}</a-tag>
      </div>
      <a-dropdown>
        <a-button type="primary" size="small">添加视图</a-button>
        <template #overlay>
          <a-menu @click="onAddView">
            <a-menu-item key="terminal">收发日志</a-menu-item>
            <a-menu-item key="parsed_log">解析日志</a-menu-item>
            <a-menu-item key="monitor">监控</a-menu-item>
            <a-menu-item key="chart">图表</a-menu-item>
            <a-menu-item key="tx_list">定时发送</a-menu-item>
            <a-menu-item key="chat" disabled>对话（后续）</a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </div>

    <a-tabs
      v-model:activeKey="workspace.activeViewId"
      type="editable-card"
      hide-add
      @edit="onEditTab"
    >
      <a-tab-pane
        v-for="v in workspace.activeViews"
        :key="v.id"
        :tab="v.title || v.type"
        :closable="workspace.activeViews.length > 1"
      >
        <div class="view-body">
          <TerminalView v-if="v.type === 'terminal'" :channel-id="channelId" />
          <ParsedLogView v-else-if="v.type === 'parsed_log'" :channel-id="channelId" />
          <MonitorView v-else-if="v.type === 'monitor'" :channel-id="channelId" />
          <ChartView v-else-if="v.type === 'chart'" :channel-id="channelId" :view-id="v.id" />
          <TxListView v-else-if="v.type === 'tx_list'" :channel-id="channelId" />
          <a-empty v-else description="该视图类型尚未实现" />
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useConnectionStore, useWorkspaceStore } from '@/stores'
import type { ViewType } from '@/protocol/types'
import TerminalView from '@/views/TerminalView.vue'
import ParsedLogView from '@/views/ParsedLogView.vue'
import MonitorView from '@/views/MonitorView.vue'
import ChartView from '@/views/ChartView.vue'
import TxListView from '@/views/TxListView.vue'

const route = useRoute()
const router = useRouter()
const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()

const channelId = computed(() => String(route.params.channelId || ''))

const channelMeta = computed(() =>
  connectionStore.channelList.find(c => c.channelId === channelId.value)
)

const channelLabel = computed(() =>
  channelMeta.value?.portName || channelId.value || '未选择通道'
)

watch(
  channelId,
  (id) => {
    if (!id) {
      router.replace({ name: 'connection' })
      return
    }
    workspace.openChannel(id)
  },
  { immediate: true }
)

function onAddView(info: { key: string }) {
  const type = info.key as ViewType
  workspace.addView(channelId.value, type)
}

function onEditTab(targetKey: string | MouseEvent | KeyboardEvent, action: string) {
  if (action !== 'remove' || typeof targetKey !== 'string') return
  workspace.closeView(channelId.value, targetKey)
}
</script>

<style scoped>
.channel-workspace { display: flex; flex-direction: column; height: calc(100vh - 180px); min-height: 420px; }
.ws-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 12px;
}
.ws-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.label { color: rgba(0,0,0,0.45); font-size: 12px; }
.view-body { height: calc(100vh - 260px); min-height: 360px; overflow: auto; }
</style>
