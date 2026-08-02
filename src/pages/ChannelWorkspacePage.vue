<template>
  <div class="channel-workspace" :class="{ 'is-immersive': workspace.viewImmersive }">
    <div class="ws-header">
      <div class="ws-title">
        <span class="label">通道</span>
        <strong>{{ channelLabel }}</strong>
        <a-tag :color="channelMeta?.connected ? 'success' : 'default'" size="small">
          {{ channelMeta?.connected ? '已连接' : '未连接' }}
        </a-tag>
        <a-tag v-if="channelMeta" size="small">{{ channelMeta.transportType }}</a-tag>
        <template v-if="isSerial">
          <span class="label">断包</span>
          <a-input-number
            v-model:value="byteTimeoutMs"
            :min="5"
            :max="5000"
            :step="10"
            size="small"
            addon-after="ms"
            style="width: 120px"
            @change="applyTimeout"
          />
          <a-input-number
            v-model:value="frameTimeoutMs"
            :min="20"
            :max="10000"
            :step="10"
            size="small"
            addon-before="帧"
            addon-after="ms"
            style="width: 140px"
            @change="applyTimeout"
          />
        </template>
      </div>
      <a-space>
        <a-button size="small" @click="workspace.toggleViewImmersive()">
          {{ workspace.viewImmersive ? '退出全屏' : '全屏视图' }}
        </a-button>
        <a-dropdown>
          <a-button type="primary" size="small">添加视图</a-button>
          <template #overlay>
            <a-menu @click="onAddView">
              <a-menu-item key="terminal">收发日志</a-menu-item>
              <a-menu-item key="parsed_log">解析日志</a-menu-item>
              <a-menu-item key="monitor">监控</a-menu-item>
              <a-menu-item key="chart">图表</a-menu-item>
              <a-menu-item key="tx_list">定时发送</a-menu-item>
              <a-menu-item key="chat">对话</a-menu-item>
              <a-menu-item key="vt100">VT100 终端</a-menu-item>
              <a-menu-item key="protocol_dashboard">协议仪表盘</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
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
        <div
          class="view-body"
          :class="{ immersive: workspace.viewImmersive && v.id === workspace.activeViewId }"
        >
          <div v-if="workspace.viewImmersive && v.id === workspace.activeViewId" class="immersive-bar">
            <span>{{ v.title || v.type }} · {{ channelLabel }}</span>
            <span class="immersive-hint">F11 / Esc 退出</span>
            <a-button size="small" type="primary" ghost @click="workspace.exitViewImmersive()">
              退出全屏
            </a-button>
          </div>
          <div class="view-content">
            <TerminalView v-if="v.type === 'terminal'" :channel-id="channelId" />
            <ParsedLogView v-else-if="v.type === 'parsed_log'" :channel-id="channelId" />
            <MonitorView v-else-if="v.type === 'monitor'" :channel-id="channelId" />
            <ChartView v-else-if="v.type === 'chart'" :channel-id="channelId" :view-id="v.id" />
            <TxListView v-else-if="v.type === 'tx_list'" :channel-id="channelId" />
            <ChatView v-else-if="v.type === 'chat'" :channel-id="channelId" />
            <Vt100View v-else-if="v.type === 'vt100'" :channel-id="channelId" :view-id="v.id" />
            <ProtocolDashboardView
              v-else-if="v.type === 'protocol_dashboard'"
              :channel-id="channelId"
              :view-id="v.id"
            />
            <a-empty v-else description="该视图类型尚未实现" />
          </div>
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'
import { useConnectionStore, useWorkspaceStore } from '@/stores'
import { errorMessage } from '@/utils/error'
import type { ViewType } from '@/protocol/types'
import {
  loadAppSettings,
  loadChannelTimeouts,
  saveChannelTimeout,
} from '@/utils/appSettings'
import TerminalView from '@/views/TerminalView.vue'
import ParsedLogView from '@/views/ParsedLogView.vue'
import MonitorView from '@/views/MonitorView.vue'
import ChartView from '@/views/ChartView.vue'
import TxListView from '@/views/TxListView.vue'
import ChatView from '@/views/ChatView.vue'
import Vt100View from '@/views/Vt100View.vue'
import ProtocolDashboardView from '@/views/ProtocolDashboardView.vue'

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

const isSerial = computed(() => channelMeta.value?.transportType === 'serial')

const byteTimeoutMs = ref(50)
const frameTimeoutMs = ref(200)
let applyTimer: ReturnType<typeof setTimeout> | null = null

function loadTimeoutForChannel(id: string) {
  const defaults = loadAppSettings()
  const saved = loadChannelTimeouts()[id]
  byteTimeoutMs.value = saved?.byte ?? defaults.serialByteTimeoutMs
  frameTimeoutMs.value = saved?.frame ?? defaults.serialFrameTimeoutMs
}

function applyTimeout() {
  if (!isSerial.value || !channelId.value) return
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(async () => {
    try {
      await invoke('set_serial_rx_timeout', {
        channelId: channelId.value,
        byteTimeoutMs: byteTimeoutMs.value,
        frameTimeoutMs: frameTimeoutMs.value,
      })
      saveChannelTimeout(channelId.value, byteTimeoutMs.value, frameTimeoutMs.value)
    } catch (e: unknown) {
      message.error(errorMessage(e))
    }
  }, 300)
}

watch(
  channelId,
  (id) => {
    if (!id) {
      router.replace({ name: 'connection' })
      return
    }
    workspace.openChannel(id)
    loadTimeoutForChannel(id)
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

function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'F11') {
    e.preventDefault()
    e.stopPropagation()
    workspace.toggleViewImmersive()
    return
  }
  if (e.key === 'Escape' && workspace.viewImmersive) {
    e.preventDefault()
    workspace.exitViewImmersive()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  workspace.exitViewImmersive()
})
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
.view-body { height: calc(100vh - 260px); min-height: 360px; overflow: auto; display: flex; flex-direction: column; }
.view-content { flex: 1; min-height: 0; overflow: auto; }
.view-body.immersive {
  position: fixed;
  inset: 0;
  z-index: 1100;
  height: 100vh !important;
  min-height: 100vh;
  margin: 0;
  padding: 0;
  background: #fff;
  border-radius: 0;
  overflow: hidden;
}
.immersive-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: #141414;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
}
.immersive-hint { margin-left: auto; color: rgba(255, 255, 255, 0.45); }
</style>
