<template>
  <a-config-provider :locale="zhCN">
    <a-layout class="app-layout" :class="{ 'chrome-hidden': workspaceStore.viewImmersive }">
      <a-layout-sider
        v-show="!workspaceStore.viewImmersive"
        v-model:collapsed="collapsed"
        :trigger="null"
        collapsible
        theme="dark"
        :width="220"
      >
        <div class="logo">
          <img v-if="collapsed" src="/app-icon.png" alt="" class="logo-img" />
          <template v-else>
            <img src="/app-icon.png" alt="" class="logo-img-inline" />
            <div class="logo-copy">
              <div class="logo-text">Serial Tools</div>
              <div class="logo-sub">通信集成调试平台</div>
            </div>
          </template>
        </div>
        <a-menu
          :selectedKeys="selectedKeys"
          theme="dark"
          mode="inline"
          @click="handleMenuClick"
        >
          <a-menu-item-group v-if="!collapsed" title="通道" />
          <a-menu-item
            v-for="ch in connectedChannels"
            :key="'ch:' + ch.channelId"
          >
            <template #icon><ApiOutlined /></template>
            <input
              v-if="renamingChannelId === ch.channelId"
              ref="renameInputRef"
              class="channel-rename-input"
              :value="renamingDraft"
              @click.stop
              @dblclick.stop
              @mousedown.stop
              @input="renamingDraft = ($event.target as HTMLInputElement).value"
              @keydown.enter.prevent="commitRename(ch)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(ch)"
            />
            <span
              v-else
              class="channel-menu-label"
              :title="channelTitle(ch)"
              @dblclick.stop.prevent="startRename(ch)"
            >{{ connectionStore.channelDisplayName(ch) }}</span>
          </a-menu-item>
          <a-menu-item v-if="connectedChannels.length === 0" key="connection" disabled>
            <span style="opacity:0.55">暂无连接</span>
          </a-menu-item>
          <a-menu-divider />
          <a-menu-item-group v-if="!collapsed" title="全局" />
          <a-menu-item v-for="item in globalMenuItems" :key="item.key">
            <template #icon><component :is="item.icon" /></template>
            <span>{{ item.label }}</span>
          </a-menu-item>
        </a-menu>
      </a-layout-sider>

      <a-layout>
        <a-layout-header v-show="!workspaceStore.viewImmersive" class="header">
          <div class="header-left">
            <component :is="collapsed ? MenuUnfoldOutlined : MenuFoldOutlined" class="trigger" @click="collapsed = !collapsed" />
            <div class="page-title">{{ pageTitle }}</div>
          </div>
          <div class="header-right">
            <a-space>
              <a-tag v-for="ch in connectedChannels" :key="ch.channelId" color="success" closable @close="handleDisconnectChannel(ch.channelId)">
                {{ connectionStore.channelDisplayName(ch) }}
              </a-tag>
              <a-tag v-if="connectedChannels.length === 0" color="default">未连接</a-tag>
            </a-space>
          </div>
        </a-layout-header>

        <a-layout-content class="content" :class="{ immersive: workspaceStore.viewImmersive }">
          <a-alert v-if="!isTauriEnv && !workspaceStore.viewImmersive" type="warning" show-icon message="浏览器预览模式" description="请使用 npm run tauri dev 启动桌面窗口。" style="margin-bottom: 16px" />
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </a-layout-content>

        <a-layout-footer v-show="!workspaceStore.viewImmersive" class="footer">
          <a-space split>
            <span>Serial Tools {{ APP_VERSION_LABEL }}</span>
            <span>RX: {{ terminalStore.rxCount }} | TX: {{ terminalStore.txCount }}</span>
          </a-space>
        </a-layout-footer>
      </a-layout>
    </a-layout>
    <AppContextMenu />
  </a-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import {
  LinkOutlined, SwapOutlined,
  FileTextOutlined, SettingOutlined, MenuUnfoldOutlined,
  MenuFoldOutlined, InfoCircleOutlined, ApiOutlined, FolderOutlined, AppstoreOutlined,
} from '@ant-design/icons-vue'
import {
  useConnectionStore, useTerminalStore, useLogStore,
  useRxHub, useProtocolStore, useWorkspaceStore, useProtocolRuntime,
} from './stores'
import { isTauri } from './api/tauri'
import AppContextMenu from './components/AppContextMenu.vue'
import type { ChannelInfo } from './stores/connectionStore'
import { APP_VERSION_LABEL } from './buildInfo'

const isTauriEnv = isTauri()
const router = useRouter()
const route = useRoute()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()
const logStore = useLogStore()
const rxHub = useRxHub()
const protocolStore = useProtocolStore()
const workspaceStore = useWorkspaceStore()
const protocolRuntime = useProtocolRuntime()

const collapsed = ref(false)
const renamingChannelId = ref('')
const renamingDraft = ref('')
const renameInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

const globalMenuItems = [
  { key: 'connection', label: '连接管理', icon: LinkOutlined },
  { key: 'forward', label: '端口转发', icon: SwapOutlined },
  { key: 'protocol', label: '协议扩展', icon: AppstoreOutlined },
  { key: 'workspace-config', label: '工作区', icon: FolderOutlined },
  { key: 'log', label: '系统日志', icon: FileTextOutlined },
  { key: 'settings', label: '设置', icon: SettingOutlined },
  { key: 'about', label: '关于', icon: InfoCircleOutlined },
]

const selectedKeys = computed(() => {
  if (route.name === 'workspace') {
    return ['ch:' + String(route.params.channelId || '')]
  }
  return [route.name as string]
})

const pageTitle = computed(() => {
  if (route.name === 'workspace') {
    const id = String(route.params.channelId || '')
    const ch = connectionStore.channelList.find(c => c.channelId === id)
    return ch ? `通道 · ${connectionStore.channelDisplayName(ch)}` : '通道工作区'
  }
  return (route.meta?.title as string) || ''
})

const connectedChannels = computed(() => connectionStore.connectedChannels)

function channelTitle(ch: ChannelInfo) {
  const base = ch.portName || ch.channelId
  return ch.alias?.trim() ? `${ch.alias.trim()}（${base}）` : base
}

function focusRenameInput() {
  nextTick(() => {
    const el = renameInputRef.value
    const input = Array.isArray(el) ? el[0] : el
    input?.focus()
    input?.select()
  })
}

function startRename(ch: ChannelInfo) {
  renamingChannelId.value = ch.channelId
  renamingDraft.value = connectionStore.channelDisplayName(ch)
  focusRenameInput()
}

function cancelRename() {
  renamingChannelId.value = ''
  renamingDraft.value = ''
}

function commitRename(ch: ChannelInfo) {
  if (renamingChannelId.value !== ch.channelId) return
  const draft = renamingDraft.value.trim()
  const defaultName = connectionStore.channelBaseName(ch)
  // 清空或与默认名相同 → 清除别名
  connectionStore.setChannelAlias(ch.channelId, draft === defaultName ? '' : draft)
  cancelRename()
}

function handleMenuClick(info: { key: string }) {
  if (renamingChannelId.value) return
  const key = String(info.key)
  if (key.startsWith('ch:')) {
    const channelId = key.slice(3)
    workspaceStore.openChannel(channelId)
    router.push({ name: 'workspace', params: { channelId } })
    return
  }
  router.push({ name: key })
}

async function handleDisconnectChannel(channelId: string) {
  await connectionStore.disconnect(channelId)
  workspaceStore.removeChannel(channelId)
  if (route.name === 'workspace' && route.params.channelId === channelId) {
    router.push({ name: 'connection' })
  }
}

onMounted(async () => {
  await connectionStore.init()
  await rxHub.init()
  protocolStore.init()
  protocolRuntime.init()
  await terminalStore.init()
  await logStore.init()
})

onUnmounted(() => {
  connectionStore.dispose()
  terminalStore.dispose()
  protocolStore.dispose()
  protocolRuntime.dispose()
  rxHub.dispose()
  logStore.dispose()
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
}

.logo {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  min-height: 64px;
}

.logo-img {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.logo-img-inline {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
}

.logo-copy {
  text-align: left;
  min-width: 0;
}

.logo-text {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}

.logo-sub {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  margin-top: 2px;
  line-height: 1.2;
}

.header {
  background: #fff;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  min-height: 64px;
  height: auto;
  color: rgba(0, 0, 0, 0.88);
  line-height: 1.4;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.trigger {
  font-size: 18px;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.65);
}

.trigger:hover {
  color: #1677ff;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.content {
  margin: 16px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  min-height: calc(100vh - 64px - 70px - 32px);
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.06);
}

.content.immersive {
  margin: 0;
  padding: 0;
  border-radius: 0;
  min-height: 100vh;
  box-shadow: none;
}

.footer {
  text-align: center;
  background: transparent;
  padding: 8px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.channel-menu-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 140px;
  vertical-align: bottom;
}

.channel-rename-input {
  width: min(160px, 100%);
  max-width: 160px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid #1677ff;
  border-radius: 4px;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  font-size: 13px;
  outline: none;
  vertical-align: middle;
}
</style>

<style>
.ant-layout-sider .ant-menu-dark .ant-menu-item {
  color: rgba(255, 255, 255, 0.85) !important;
}

.ant-layout-sider .ant-menu-dark .ant-menu-item-selected {
  background-color: #1677ff !important;
}
</style>
