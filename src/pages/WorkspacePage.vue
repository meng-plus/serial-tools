<template>
  <div class="workspace-page">
    <a-row :gutter="16">
      <a-col :span="14">
        <a-card title="规则会话" size="small" :bordered="false">
          <template #extra>
            <a-button size="small" type="primary" @click="showSaveModal = true">保存规则会话</a-button>
          </template>
          <p class="hint">
            轻量会话只保存<strong>解析规则</strong>与可选全局偏好；不保存 TCP/串口连接。
          </p>
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            message="规则不绑死通道 ID：加载后对「当前工作区通道」的接收数据生效。"
          />
          <a-list :data-source="sessionStore.sessions" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>{{ item.name }}</template>
                  <template #description>修改: {{ item.modified }}</template>
                </a-list-item-meta>
                <template #actions>
                  <a-button size="small" @click="handleLoadSession(item.name)">加载</a-button>
                  <a-popconfirm title="确认删除?" @confirm="sessionStore.remove(item.name)">
                    <a-button size="small" danger>删除</a-button>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-if="sessionStore.sessions.length === 0" description="暂无会话" />
        </a-card>

        <a-card title="工作区整包" size="small" :bordered="false" style="margin-top: 16px">
          <p class="hint">
            导出/导入规则 + 当前通道视图模板 + 定时发送列表 + 帧配置（YAML/JSON）。仍不保存易变连接。
          </p>
          <a-space wrap>
            <a-button type="primary" @click="exportPackage('yaml')">导出 YAML</a-button>
            <a-button @click="exportPackage('json')">导出 JSON</a-button>
            <a-button @click="triggerImport">导入文件</a-button>
            <input
              ref="fileInput"
              type="file"
              accept=".yaml,.yml,.json,text/yaml,application/json"
              style="display: none"
              @change="onImportFile"
            />
          </a-space>
          <a-divider style="margin: 12px 0" />
          <a-checkbox v-model:checked="applyViewsOnImport">导入时应用到当前工作区通道的视图</a-checkbox>
          <div class="hint" style="margin-top: 8px">
            当前工作区通道：{{ workspace.activeChannelId || '（未打开通道，导入将只恢复规则/发送模板）' }}
          </div>
        </a-card>
      </a-col>
      <a-col :span="10">
        <a-card title="当前概览" size="small" :bordered="false">
          <a-statistic title="规则条数" :value="protocolStore.rules.length" />
          <a-divider />
          <ul class="bullets">
            <li v-for="r in protocolStore.rules.slice(0, 12)" :key="r.id">
              {{ r.name }} · {{ r.type }} · {{ r.enabled ? '启用' : '停用' }}
            </li>
          </ul>
          <a-empty v-if="protocolStore.rules.length === 0" description="尚未配置解析规则" />
          <a-divider />
          <p class="hint">数据目录：sessions/ · exports/ · channel-logs/（用户目录 serial-tools-data）</p>
          <a-button size="small" @click="openDataRoot">打开数据目录</a-button>
        </a-card>
      </a-col>
    </a-row>

    <a-modal v-model:open="showSaveModal" title="保存会话（规则）" @ok="handleSaveSession">
      <a-form layout="vertical">
        <a-form-item label="会话名称">
          <a-input v-model:value="saveName" placeholder="例: 温湿度解析规则" />
        </a-form-item>
        <a-form-item>
          <a-checkbox v-model:checked="includeSettings">同时写入全局偏好（编码等）</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { errorMessage } from '@/utils/error'
import { message } from 'ant-design-vue'
import { invoke, isTauri } from '@/api'
import {
  useSessionStore,
  useTerminalStore,
  useProtocolStore,
  useWorkspaceStore,
  useTxPlannerStore,
} from '@/stores'
import type { Encoding } from '@/stores/terminalStore'
import { buildWorkspacePackage, parseWorkspace, serializeWorkspace } from '@/workspace/io'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'

const sessionStore = useSessionStore()
const terminalStore = useTerminalStore()
const protocolStore = useProtocolStore()
const workspace = useWorkspaceStore()
const txPlanner = useTxPlannerStore()

const showSaveModal = ref(false)
const saveName = ref('')
const includeSettings = ref(true)
const applyViewsOnImport = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)

function readSettings(): Record<string, unknown> | undefined {
  const settingsRaw = localStorage.getItem('serial-tools-settings')
  try {
    return settingsRaw ? JSON.parse(settingsRaw) : undefined
  } catch {
    return undefined
  }
}

function applySettings(settings: Record<string, unknown>) {
  localStorage.setItem('serial-tools-settings', JSON.stringify(settings))
  if (settings.encoding) {
    let enc = settings.encoding as string
    if (enc === 'gb2312') enc = 'gbk'
    terminalStore.encoding = enc as Encoding
  }
  if (typeof settings.maxLines === 'number') terminalStore.maxLines = settings.maxLines
}

async function handleSaveSession() {
  if (!saveName.value.trim()) {
    message.warning('请输入会话名称')
    return
  }
  const sessionData = {
    version: 1,
    kind: 'rules_session',
    savedAt: new Date().toISOString(),
    settings: includeSettings.value ? readSettings() : undefined,
    rules: protocolStore.rules.map(({ channelId: _c, ...r }) => r),
  }
  await sessionStore.save(saveName.value.trim(), JSON.stringify(sessionData, null, 2))
  showSaveModal.value = false
  saveName.value = ''
  message.success(`已保存 ${sessionData.rules.length} 条规则`)
}

async function handleLoadSession(name: string) {
  try {
    const content = await sessionStore.load(name)
    const data = parseWorkspace(content)
    protocolStore.setRules(data.rules)
    if (data.settings) applySettings(data.settings)
    message.success(`已加载会话「${name}」：${data.rules.length} 条规则（连接请手动建立）`)
  } catch (e: unknown) {
    message.error(errorMessage(e))
  }
}

async function exportPackage(format: 'yaml' | 'json') {
  const channelId = workspace.activeChannelId
  const views = channelId ? (workspace.viewsByChannel[channelId] || []) : []
  const lists = channelId
    ? (txPlanner.listsByChannel[channelId] ? [txPlanner.listsByChannel[channelId]] : [])
    : Object.entries(txPlanner.listsByChannel)
      .filter(([k]) => k !== '__template__')
      .map(([, v]) => v)

  const pkg = buildWorkspacePackage({
    rules: protocolStore.rules,
    views,
    txLists: lists,
    frameProfiles: txPlanner.frameProfiles,
    settings: readSettings(),
  })
  const content = serializeWorkspace(pkg, format)
  try {
    const { path, via } = await exportTextToDisk({
      feature: '工作区整包',
      channelId: channelId || 'workspace',
      channelLabel: channelId || 'workspace',
      ext: format === 'yaml' ? 'yaml' : 'json',
      content,
    })
    message.success(via === 'appdir' ? `已导出：${path}` : `已触发下载：${path}`)
    if (via === 'appdir') await revealPath(path)
  } catch (e: unknown) {
    message.error(errorMessage(e))
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const raw = await file.text()
    const pkg = parseWorkspace(raw)
    protocolStore.setRules(pkg.rules)
    if (pkg.settings) applySettings(pkg.settings)
    if (pkg.frameProfiles.length) txPlanner.setFrameProfiles(pkg.frameProfiles)
    if (pkg.txLists.length) {
      txPlanner.importTemplates(pkg.txLists, pkg.frameProfiles)
      const cid = workspace.activeChannelId
      if (cid) txPlanner.applyTemplateToChannel(cid)
    }
    const cid = workspace.activeChannelId
    if (applyViewsOnImport.value && cid && pkg.viewTemplates.length) {
      workspace.replaceViewsFromTemplates(cid, pkg.viewTemplates)
    }
    message.success(
      `已导入：${pkg.rules.length} 条规则` +
        (cid && applyViewsOnImport.value ? `，视图已应用到 ${cid}` : '') +
        (pkg.txLists.length && cid ? '，定时发送已应用' : ''),
    )
  } catch (e: unknown) {
    message.error(errorMessage(e))
  }
}

async function openDataRoot() {
  if (!isTauri()) {
    message.info('请在桌面应用中打开数据目录')
    return
  }
  try {
    const dirs = await invoke<{ root: string }>('get_data_dirs')
    await invoke('reveal_in_folder', { path: dirs.root })
  } catch (e: unknown) {
    message.error(errorMessage(e))
  }
}

onMounted(async () => {
  await sessionStore.loadList()
})
</script>

<style scoped>
.hint { color: rgba(0,0,0,0.45); font-size: 13px; margin-bottom: 12px; }
.bullets { padding-left: 18px; color: rgba(0,0,0,0.75); line-height: 1.7; max-height: 240px; overflow: auto; margin: 0; }
</style>
