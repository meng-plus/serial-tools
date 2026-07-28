<template>
  <a-config-provider :locale="zhCN">
    <a-layout class="app-layout">
      <a-layout-sider v-model:collapsed="collapsed" :trigger="null" collapsible theme="dark" width="220">
        <div class="logo">
          <ApiOutlined v-if="collapsed" class="logo-icon" />
          <template v-else>
            <div class="logo-text">Serial Tools</div>
            <div class="logo-sub">通信集成调试平台</div>
          </template>
        </div>
        <a-menu
          v-model:selectedKeys="selectedKeys"
          theme="dark"
          mode="inline"
          @click="handleMenuClick"
        >
          <a-menu-item v-for="item in menuItems" :key="item.key">
            <template #icon><component :is="item.icon" /></template>
            <span>{{ item.label }}</span>
          </a-menu-item>
        </a-menu>
      </a-layout-sider>

      <a-layout>
        <a-layout-header class="header">
          <div class="header-left">
            <component
              :is="collapsed ? MenuUnfoldOutlined : MenuFoldOutlined"
              class="trigger"
              @click="collapsed = !collapsed"
            />
            <div>
              <div class="page-title">{{ pageTitle }}</div>
            </div>
          </div>
          <div class="header-right">
            <span :class="['status-dot', connected ? 'connected' : 'disconnected']" />
            <a-tag :color="connected ? 'success' : 'default'">
              {{ connected ? connectionStore.portName || '已连接' : '未连接' }}
            </a-tag>
          </div>
        </a-layout-header>

        <a-layout-content class="content">
          <a-alert
            v-if="!isTauriEnv"
            type="warning"
            show-icon
            message="浏览器预览模式"
            description="请使用 npm run tauri dev 启动桌面窗口。"
            style="margin-bottom: 16px"
          />
          <ConnectionPage v-if="currentPage === 'connection'" />
          <TerminalPage v-else-if="currentPage === 'terminal'" />
          <ProtocolPage v-else-if="currentPage === 'protocol'" />
          <ForwardPage v-else-if="currentPage === 'forward'" />
          <LogPage v-else-if="currentPage === 'log'" />
          <SettingsPage v-else-if="currentPage === 'settings'" />
        </a-layout-content>

        <a-layout-footer class="footer">
          <a-space split>
            <span>Serial Tools v0.1.0</span>
          </a-space>
        </a-layout-footer>
      </a-layout>
    </a-layout>
  </a-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import {
  LinkOutlined,
  CodeOutlined,
  BugOutlined,
  SwapOutlined,
  FileTextOutlined,
  SettingOutlined,
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue'
import { useConnectionStore } from './stores'
import ConnectionPage from './pages/ConnectionPage.vue'
import TerminalPage from './pages/TerminalPage.vue'
import ProtocolPage from './pages/ProtocolPage.vue'
import ForwardPage from './pages/ForwardPage.vue'
import LogPage from './pages/LogPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import { isTauri } from './api/tauri'

const isTauriEnv = isTauri()

const collapsed = ref(false)
const selectedKeys = ref<string[]>(['connection'])
const currentPage = ref('connection')

const connectionStore = useConnectionStore()

const connected = computed(() => connectionStore.connected)

const menuItems = [
  { key: 'connection', label: '连接管理', icon: LinkOutlined },
  { key: 'terminal', label: '终端', icon: CodeOutlined },
  { key: 'protocol', label: '协议解析', icon: BugOutlined },
  { key: 'forward', label: '端口转发', icon: SwapOutlined },
  { key: 'log', label: '系统日志', icon: FileTextOutlined },
  { key: 'settings', label: '设置', icon: SettingOutlined },
]

const pageTitles: Record<string, string> = Object.fromEntries(
  menuItems.map(i => [i.key, i.label]),
)

const pageTitle = computed(() => pageTitles[currentPage.value] ?? '')

function handleMenuClick(info: { key: string }) {
  currentPage.value = info.key
}

onMounted(async () => {
  await connectionStore.refreshStatus()
  await connectionStore.loadPorts()
})
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
}

.logo {
  padding: 16px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-icon {
  font-size: 24px;
  color: #1677ff;
}

.logo-text {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}

.logo-sub {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  margin-top: 2px;
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

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.connected {
  background: #52c41a;
}

.status-dot.disconnected {
  background: #d9d9d9;
}

.content {
  margin: 16px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  min-height: calc(100vh - 64px - 70px - 32px);
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.06);
}

.footer {
  text-align: center;
  background: transparent;
  padding: 8px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
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
