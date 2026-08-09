<template>
  <div class="protocol-page">
    <a-alert
      v-if="runtime.lastError"
      type="warning"
      show-icon
      :message="runtime.lastError"
      style="margin-bottom: 8px"
      closable
      @close="runtime.lastError = ''"
    />

    <!-- 顶栏：操作 + 创建实例（主路径） -->
    <div class="page-toolbar">
      <div class="page-toolbar-title">协议扩展</div>
      <a-space wrap size="small">
        <a-button size="small" :loading="runtime.loading" @click="runtime.refreshPackages()">刷新</a-button>
        <a-button size="small" @click="triggerInstall">安装 zip</a-button>
        <a-button v-if="isTauri()" size="small" @click="openDevLink">Dev 文件夹</a-button>
        <a-button size="small" type="primary" @click="openCreateWizard">创建实例</a-button>
      </a-space>
    </div>

    <!-- 主区：实例优先 -->
    <a-card size="small" class="inst-card" :bordered="false">
      <template #title>
        <span>运行实例</span>
        <a-tag v-if="instances.length" style="margin-left: 8px">{{ instances.length }}</a-tag>
      </template>
      <a-tabs v-if="instances.length > 0" type="card" size="small" class="inst-tabs">
        <a-tab-pane v-for="inst in instances" :key="inst.instanceId" :tab="instTitle(inst)">
          <div class="inst-head">
            <a-space wrap size="small">
              <a-tag color="blue">{{ inst.manifest.role }}</a-tag>
              <a-tag :color="statusColor(inst.status)">{{ statusText(inst) }}</a-tag>
              <a-tag v-if="!channelExists(inst.channelId)" color="error">通道不存在</a-tag>
              <span class="muted">通道：{{ channelLabel(inst.channelId) }}</span>
              <span v-if="inst.lastRxAt" class="muted">最近收包 {{ inst.lastRxAt }}</span>
            </a-space>
            <a-space wrap size="small">
              <template v-for="a in inst.manifest.ui.actions || []" :key="a.id">
                <a-button size="small" :disabled="!inst.enabled" @click="runtime.runAction(inst.instanceId, a.id, {})">
                  {{ a.label }}
                </a-button>
              </template>
              <a-button size="small" @click="openSwitchChannel(inst)">切换通道</a-button>
              <a-button size="small" :type="inst.enabled ? 'default' : 'primary'" @click="handleToggle(inst)">
                {{ inst.enabled ? '停止' : '启动' }}
              </a-button>
              <a-dropdown>
                <a-button size="small">参数 / 数据</a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item key="export-params" @click="handleExportParams(inst)">导出参数 (YAML)</a-menu-item>
                    <a-menu-item key="import-params" @click="pickImport(inst)">导入参数 (JSON/YAML)</a-menu-item>
                    <a-menu-item key="import-csv" @click="pickImportCsv(inst)">导入 CSV（表格参数）</a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="export-data" @click="handleExportData(inst)">导出读取数据 (CSV+JSON)</a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="remove" danger @click="handleRemove(inst)">移除实例</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </div>

          <a-alert
            v-if="inst.status === 'error' && inst.error"
            type="error"
            show-icon
            :message="inst.error"
            style="margin: 8px 0"
          />

          <a-collapse style="margin-top: 8px" :default-active-key="['params']" size="small">
            <a-collapse-panel key="params" header="参数配置">
              <ParamForm
                :params="inst.manifest.ui.params || []"
                :model-value="inst.params"
                @update:model-value="v => runtime.setParams(inst.instanceId, diff(inst.params, v))"
              />
            </a-collapse-panel>
          </a-collapse>
        </a-tab-pane>
      </a-tabs>
      <a-empty v-else description="尚未创建协议实例，点击右上角「创建实例」开始">
        <a-button type="primary" size="small" @click="openCreateWizard">创建实例</a-button>
      </a-empty>
    </a-card>

    <!-- 次要：可用协议合并为一行标签流，默认可折叠 -->
    <a-collapse
      v-model:activeKey="pkgCollapseKeys"
      ghost
      class="pkg-collapse"
    >
      <a-collapse-panel key="pkgs" :header="pkgPanelHeader">
        <div v-if="runtime.packages.length === 0" class="muted">
          暂无可用协议（内置缺失或加载失败）。可安装 zip 或链接 Dev 文件夹。
        </div>
        <div v-else class="pkg-flow">
          <template v-if="builtinPackages.length">
            <span class="pkg-group">内置</span>
            <a-tag
              v-for="p in builtinPackages"
              :key="p.manifest.id"
              color="blue"
              class="pkg-tag"
              @click="openDoc(p)"
            >
              {{ p.manifest.name }}
              <span class="pkg-ver">v{{ p.manifest.version }}</span>
            </a-tag>
          </template>
          <template v-if="userPackages.length">
            <span class="pkg-group">已安装</span>
            <a-tag
              v-for="p in userPackages"
              :key="p.manifest.id"
              color="geekblue"
              closable
              class="pkg-tag"
              @close="handleUninstall(p.manifest.id)"
              @click="openDoc(p)"
            >
              {{ p.manifest.name }}
              <span class="pkg-ver">v{{ p.manifest.version }}</span>
            </a-tag>
            <a-button
              v-if="isTauri()"
              type="link"
              size="small"
              class="pkg-dir-btn"
              @click="openProtocolsDir"
            >
              目录
            </a-button>
          </template>
          <template v-if="devPackages.length">
            <span class="pkg-group">Dev</span>
            <a-tag
              v-for="p in devPackages"
              :key="p.manifest.id"
              color="orange"
              closable
              class="pkg-tag"
              :title="p.dir || '源文件变更自动热重载'"
              @close="handleUninstall(p.manifest.id)"
              @click="openDoc(p)"
            >
              {{ p.manifest.name }}
              <span class="pkg-ver">v{{ p.manifest.version }}</span>
            </a-tag>
          </template>
        </div>
        <div v-if="protocolsDir" class="muted pkg-hint">点击标签查看说明；Dev 监视源目录热重载</div>
      </a-collapse-panel>
    </a-collapse>

    <!-- 日志默认折叠 -->
    <a-collapse v-model:activeKey="logCollapseKeys" ghost class="log-collapse">
      <a-collapse-panel key="logs" :header="logPanelHeader">
        <div class="log-box">
          <div v-if="runtime.logs.length === 0" class="muted">暂无日志</div>
          <div
            v-for="(l, i) in runtime.logs.slice().reverse()"
            :key="i"
            class="log-line"
            :class="'lv-' + l.level"
          >
            <span class="log-ts">{{ l.ts }}</span>
            <span class="log-proto">{{ l.protocolId }}</span>
            <span>{{ l.msg }}</span>
          </div>
        </div>
        <a-button v-if="runtime.logs.length" size="small" style="margin-top: 8px" @click="runtime.clearLogs()">
          清空日志
        </a-button>
      </a-collapse-panel>
    </a-collapse>

    <input ref="installInput" type="file" accept=".zip" style="display: none" @change="onInstallFile" />
    <input ref="importInput" type="file" accept=".yaml,.yml,.json,.txt,.csv,text/*" style="display: none" @change="onImportFile" />

    <a-modal
      v-model:open="wizardOpen"
      title="创建协议实例"
      width="620px"
      :confirm-loading="creating"
      @ok="handleWizardOk"
    >
      <a-steps :current="wizardStep" size="small" style="margin-bottom: 16px">
        <a-step title="选择协议" />
        <a-step title="选择通道" />
        <a-step title="参数配置" />
      </a-steps>

      <!-- 步骤 1：选择协议 -->
      <div v-if="wizardStep === 0">
        <a-empty v-if="runtime.packages.length === 0" description="暂无可用协议，请先安装扩展包" />
        <div v-else class="wizard-list">
          <div
            v-for="p in runtime.packages"
            :key="p.manifest.id"
            class="wizard-item"
            :class="{ active: wizard.protocolId === p.manifest.id }"
            @click="wizard.protocolId = p.manifest.id"
          >
            <div class="wizard-item-head">
              <b>{{ p.manifest.name }}</b>
              <a-tag color="blue" size="small">{{ roleLabel(p.manifest.role) }}</a-tag>
              <a-tag size="small">v{{ p.manifest.version }}</a-tag>
              <a-button size="small" type="link" @click.stop="openDoc(p)">说明</a-button>
            </div>
            <div class="muted">{{ p.manifest.description || p.manifest.id }}</div>
            <div class="muted">
              支持通道：{{ (p.manifest.channelTypes || []).map(channelTypeLabel).join('、') || '未声明' }}
            </div>
          </div>
        </div>
      </div>

      <!-- 步骤 2：选择通道（展示全部；推荐与类型匹配） -->
      <div v-else-if="wizardStep === 1">
        <a-empty
          v-if="channels.length === 0"
          description="当前无任何通道，请先在「连接」页建立连接。"
        />
        <template v-else>
          <div v-if="mismatchCount > 0" class="muted" style="margin-bottom: 8px">
            {{ mismatchCount }} 个通道类型与协议声明的 {{ (selectedManifest?.channelTypes || []).map(channelTypeLabel).join(' / ') || '任意' }} 不完全匹配（如串口转网口场景也可使用，仍可创建）。
          </div>
          <div class="wizard-list">
            <div
              v-for="ch in sortedChannels"
              :key="ch.channelId"
              class="wizard-item"
              :class="{ active: wizard.channelId === ch.channelId }"
              @click="wizard.channelId = ch.channelId"
            >
              <div class="wizard-item-head">
                <b>{{ ch.portName || ch.channelId }}</b>
                <a-tag :color="channelStrictMatch(ch) ? 'geekblue' : 'default'" size="small">
                  {{ channelTypeLabel(ch.transportType) }}{{ channelStrictMatch(ch) ? '' : '（类型不同）' }}
                </a-tag>
                <a-tag :color="ch.connected ? 'success' : 'default'" size="small">
                  {{ ch.connected ? '已连接' : '未连接' }}
                </a-tag>
              </div>
              <div class="muted">{{ ch.channelId }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- 步骤 3：参数配置 -->
      <div v-else>
        <a-alert
          v-if="wizardChannel && !wizardChannel.connected"
          type="warning"
          show-icon
          message="所选通道未连接：实例可创建，但需通道连接后才能收发数据。"
          style="margin-bottom: 12px"
        />
        <div v-if="(selectedManifest?.ui.presets || []).length > 0" class="preset-row">
          <span class="preset-label">传感器型号 / 预设</span>
          <a-select
            v-model:value="wizard.presetId"
            placeholder="选择预设（可选）"
            allow-clear
            style="width: 280px"
            size="small"
            :options="presetOptions"
            @change="applyPreset"
          />
        </div>
        <ParamForm
          :params="selectedManifest?.ui.params || []"
          :model-value="wizard.params"
          @update:model-value="v => (wizard.params = v)"
        />
      </div>
    </a-modal>

    <a-modal
      v-model:open="switchOpen"
      title="切换实例通道"
      width="560px"
      :confirm-loading="switching"
      @ok="handleSwitchOk"
    >
      <a-alert
        v-if="switchInst && switchOpen"
        type="info"
        show-icon
        message="绑定通道不存在时实例无法收发数据，请选择新的通道。切换后若实例正在运行会自动重启。"
        style="margin-bottom: 12px"
      />
      <a-empty
        v-if="channels.length === 0"
        description="当前无任何通道，请先在「连接」页建立连接。"
      />
      <template v-else>
        <div class="wizard-list">
          <div
            v-for="ch in switchChannels"
            :key="ch.channelId"
            class="wizard-item"
            :class="{ active: switchChannelId === ch.channelId }"
            @click="switchChannelId = ch.channelId"
          >
            <div class="wizard-item-head">
              <b>{{ ch.portName || ch.channelId }}</b>
              <a-tag :color="switchStrictMatch(ch) ? 'geekblue' : 'default'" size="small">
                {{ channelTypeLabel(ch.transportType) }}{{ switchStrictMatch(ch) ? '' : '（类型不同）' }}
              </a-tag>
              <a-tag :color="ch.connected ? 'success' : 'default'" size="small">
                {{ ch.connected ? '已连接' : '未连接' }}
              </a-tag>
            </div>
            <div class="muted">{{ ch.channelId }}</div>
          </div>
        </div>
      </template>
    </a-modal>

    <a-modal
      v-model:open="devLinkOpen"
      title="从文件夹加载协议 (Dev)"
      ok-text="链接"
      :confirm-loading="devLinking"
      @ok="submitDevLink"
    >
      <p class="muted" style="margin-bottom: 12px">
        填写协议包目录的绝对路径（根层须含 manifest.yaml 与入口 main.js）。不复制文件；改源码后运行中实例会自动热重载。
      </p>
      <a-input
        v-model:value="devLinkPath"
        placeholder="例如 E:/path/to/my-protocol"
        allow-clear
      />
      <a-checkbox v-model:checked="devLinkForce" style="margin-top: 12px">
        强制覆盖已安装的同名 zip 包
      </a-checkbox>
    </a-modal>

    <a-modal
      v-model:open="docOpen"
      :title="docTitle"
      width="680px"
      :footer="null"
    >
      <div
        class="markdown-body"
        v-html="renderedDoc"
      />
      <div v-if="!docText" class="muted doc-empty">该协议包未附带 README 说明文档。</div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useProtocolRuntime, useWorkspaceStore } from '@/stores'
import { errorMessage } from '@/utils/error'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'
import { invoke, isTauri } from '@/api'
import ParamForm from '@/components/protocol/ParamForm.vue'
import { defaultParams } from '@/protocol-ext/manifest'
import { readPackageDoc } from '@/protocol-ext/loader'
import { renderMarkdown } from '@/utils/markdown'
import type { ChannelInfo } from '@/stores/connectionStore'
import type { ProtocolInstance, ProtocolPackage } from '@/protocol-ext/types'

const runtime = useProtocolRuntime()
const connectionStore = useConnectionStore()
const workspaceStore = useWorkspaceStore()

const channels = computed(() => connectionStore.channelList)
const instances = computed(() => runtime.instances)
const userPackages = computed(() => runtime.packages.filter(p => p.source === 'user'))
const devPackages = computed(() => runtime.packages.filter(p => p.source === 'dev'))
const builtinPackages = computed(() => runtime.packages.filter(p => p.source === 'builtin'))

/** 有实例时默认收起协议包列表，把可视区留给实例 */
const pkgCollapseKeys = ref<string[]>([])
const logCollapseKeys = ref<string[]>([])

watch(
  instances,
  list => {
    if (list.length === 0 && pkgCollapseKeys.value.length === 0) {
      pkgCollapseKeys.value = ['pkgs']
    }
  },
  { immediate: true },
)

const pkgPanelHeader = computed(() => {
  const n = runtime.packages.length
  const parts = [
    builtinPackages.value.length ? `内置 ${builtinPackages.value.length}` : '',
    userPackages.value.length ? `已装 ${userPackages.value.length}` : '',
    devPackages.value.length ? `Dev ${devPackages.value.length}` : '',
  ].filter(Boolean)
  const detail = parts.length ? ` · ${parts.join(' / ')}` : ''
  return `可用协议 (${n})${detail}`
})

const logPanelHeader = computed(() => {
  const n = runtime.logs.length
  return n > 0 ? `运行日志 (${n})` : '运行日志'
})

const devLinkOpen = ref(false)
const devLinkPath = ref('')
const devLinkForce = ref(false)
const devLinking = ref(false)

function openDevLink() {
  devLinkPath.value = ''
  devLinkForce.value = false
  devLinkOpen.value = true
}

async function submitDevLink() {
  devLinking.value = true
  try {
    const id = await runtime.linkDevFolder(devLinkPath.value, devLinkForce.value)
    message.success(`已链接 Dev 协议: ${id}（源文件变更将自动热重载）`)
    devLinkOpen.value = false
  } catch (e) {
    message.error(errorMessage(e))
    throw e
  } finally {
    devLinking.value = false
  }
}

const docOpen = ref(false)
const docTitle = ref('')
const docText = ref('')

/** 已渲染的说明文档 HTML（未加载 / 无文档时为空） */
const renderedDoc = computed(() => (docText.value && docText.value !== '加载中…' ? renderMarkdown(docText.value) : ''))

async function openDoc(pkg: ProtocolPackage) {
  docTitle.value = `${pkg.manifest.name} (${pkg.manifest.id}) 说明`
  docText.value = '加载中…'
  docOpen.value = true
  const text = await readPackageDoc(pkg)
  docText.value = text || ''
}

let protocolsDir = ref('')
void loadProtocolsDir()

async function loadProtocolsDir() {
  if (!isTauri()) return
  try {
    const dirs = await invoke<{ protocols: string }>('get_data_dirs')
    protocolsDir.value = dirs.protocols
  } catch { /* ignore */ }
}

async function openProtocolsDir() {
  if (!protocolsDir.value) return
  await revealPath(protocolsDir.value)
}

async function handleUninstall(protocolId: string) {
  Modal.confirm({
    title: `卸载协议 ${protocolId}？`,
    content: '将删除该协议在数据目录中的安装文件，已创建的实例也会一并移除。',
    okText: '卸载',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await runtime.removePackage(protocolId)
        message.success(`已卸载协议 ${protocolId}`)
      } catch (e) {
        message.error(errorMessage(e))
        throw e
      }
    },
  })
}

const installInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)
let pendingImport: { inst: ProtocolInstance; csvKey?: string } | null = null

// ---------- 创建向导 ----------

const wizardOpen = ref(false)
const wizardStep = ref(0)
const creating = ref(false)
const wizard = reactive<{
  protocolId: string
  channelId: string
  params: Record<string, unknown>
  presetId: string
}>({
  protocolId: '',
  channelId: '',
  params: {},
  presetId: '',
})

const selectedManifest = computed(() =>
  runtime.packages.find(p => p.manifest.id === wizard.protocolId)?.manifest,
)

const TYPE_LABELS: Record<string, string> = {
  serial: '串口',
  tcp_client: 'TCP 客户端',
  tcp_server: 'TCP 服务端',
  tcp_server_client: 'TCP 客户端',
}

/** 通道 transportType 是否严格匹配协议的 channelTypes（tcp_server_client 视作 tcp_client） */
function channelStrictMatch(ch: ChannelInfo): boolean {
  const types = selectedManifest.value?.channelTypes || []
  if (types.length === 0) return true
  const t = ch.transportType === 'tcp_server_client' ? 'tcp_client' : ch.transportType
  return types.includes(t)
}

/** 全部通道：严格匹配的排前面 */
const sortedChannels = computed(() => {
  const all = channels.value
  return [...all].sort(
    (a, b) => Number(channelStrictMatch(b)) - Number(channelStrictMatch(a)),
  )
})

const mismatchCount = computed(() => channels.value.filter(ch => !channelStrictMatch(ch)).length)

const presetOptions = computed(() =>
  (selectedManifest.value?.ui.presets || []).map(p => ({ label: p.label, value: p.id })),
)

function applyPreset() {
  const presets = selectedManifest.value?.ui.presets || []
  const preset = presets.find(p => p.id === wizard.presetId)
  if (!preset) return
  wizard.params = { ...defaultParams(selectedManifest.value || ({} as never)), ...preset.params }
}

const wizardChannel = computed(() =>
  channels.value.find(ch => ch.channelId === wizard.channelId),
)

function roleLabel(role: string): string {
  return role === 'master' ? '主站' : role === 'slave' ? '从站' : '被动'
}

function channelTypeLabel(t: string): string {
  return TYPE_LABELS[t] || t
}

// ---------- 切换通道 ----------

const switchOpen = ref(false)
const switching = ref(false)
const switchInst = ref<ProtocolInstance | null>(null)
const switchChannelId = ref('')

/** 当前实例是否绑定到已存在的通道（TCP 临时端口断开会消失） */
function channelExists(channelId: string): boolean {
  return connectionStore.channels.has(channelId)
}

function openSwitchChannel(inst: ProtocolInstance) {
  switchInst.value = inst
  switchChannelId.value = inst.channelId
  switchOpen.value = true
}

const switchChannels = computed(() => {
  const list = [...channels.value]
  return list.sort((a, b) => Number(switchStrictMatch(b)) - Number(switchStrictMatch(a)))
})

function switchStrictMatch(ch: ChannelInfo): boolean {
  const types = switchInst.value?.manifest.channelTypes || []
  if (types.length === 0) return true
  const t = ch.transportType === 'tcp_server_client' ? 'tcp_client' : ch.transportType
  return types.includes(t)
}

async function handleSwitchOk() {
  const inst = switchInst.value
  if (!inst) return
  if (!switchChannelId.value) {
    message.warning('请选择通道')
    return
  }
  if (switchChannelId.value === inst.channelId) {
    switchOpen.value = false
    return
  }
  switching.value = true
  try {
    const oldChannelId = inst.channelId
    await runtime.setInstanceChannel(inst.instanceId, switchChannelId.value)
    // 与通道工作区面板同步：避免旧通道遗留不可关闭的协议标签
    workspaceStore.moveProtocolPanel(oldChannelId, switchChannelId.value, inst.instanceId)
    message.success('已切换通道')
    switchOpen.value = false
  } catch (e) {
    message.error(errorMessage(e))
  } finally {
    switching.value = false
  }
}

/** 启动前校验绑定通道；缺失时引导切换到已有通道 */
async function handleToggle(inst: ProtocolInstance) {
  if (inst.enabled) {
    await runtime.toggleInstance(inst.instanceId)
    return
  }
  if (!channelExists(inst.channelId)) {
    message.warning('绑定的通道已不存在，请选择新的通道')
    openSwitchChannel(inst)
    return
  }
  await runtime.toggleInstance(inst.instanceId)
}

function openCreateWizard() {
  wizard.protocolId = ''
  wizard.channelId = ''
  wizard.presetId = ''
  wizardStep.value = 0
  wizardOpen.value = true
}

function resetWizardToChannel() {
  wizard.channelId = ''
  wizard.params = {}
  wizard.presetId = ''
  wizardStep.value = 1
}

watch(selectedManifest, () => {
  wizard.params = defaultParams(selectedManifest.value || ({} as never))
})

async function handleWizardOk() {
  if (wizardStep.value === 0) {
    if (!wizard.protocolId) {
      message.warning('请选择协议')
      return
    }
    resetWizardToChannel()
    return
  }
  if (wizardStep.value === 1) {
    if (!wizard.channelId) {
      message.warning('请选择通道')
      return
    }
    wizardStep.value = 2
    return
  }
  // 步骤 3：创建
  creating.value = true
  try {
    const inst = await runtime.createInstance(wizard.protocolId, wizard.channelId, wizard.params)
    await runtime.setParams(inst.instanceId, wizard.params)
    // 自动在该通道工作区带出一个实例面板视图
    workspaceStore.addView(wizard.channelId, 'protocol_panel', { instanceId: inst.instanceId })
    workspaceStore.ensureProtocolPanels(wizard.channelId, [inst.instanceId])
    message.success('已创建协议实例，可在通道工作区面板查看与操作')
    wizardOpen.value = false
    wizardStep.value = 0
  } catch (e) {
    message.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

function instTitle(inst: ProtocolInstance) {
  return `${inst.manifest.name} · ${channelLabel(inst.channelId)}`
}

function channelLabel(channelId: string) {
  const ch = channels.value.find(c => c.channelId === channelId)
  return ch ? ch.portName || channelId : channelId
}

function statusColor(s: ProtocolInstance['status']) {
  if (s === 'running') return 'success'
  if (s === 'error') return 'error'
  return 'default'
}

function statusText(inst: ProtocolInstance) {
  if (inst.status === 'running') return '运行中'
  if (inst.status === 'error') return '错误'
  return '未启动'
}

function diff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(next)) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) patch[k] = next[k]
  }
  return patch
}

async function handleRemove(inst: ProtocolInstance) {
  await runtime.removeInstance(inst.instanceId)
  // 同步清理通道工作区中该实例的面板视图
  workspaceStore.removeProtocolPanel(inst.channelId, inst.instanceId)
}

function triggerInstall() {
  installInput.value?.click()
}

async function onInstallFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const buf = await file.arrayBuffer()
    const id = await runtime.installFromZip(new Uint8Array(buf))
    message.success(`已安装协议: ${id}`)
  } catch (err) {
    message.error(errorMessage(err))
  }
}

function pickImport(inst: ProtocolInstance) {
  pendingImport = { inst }
  importInput.value?.click()
}

function pickImportCsv(inst: ProtocolInstance) {
  const tableKey = (inst.manifest.ui.params || []).find(p => p.type === 'table')?.key
  if (!tableKey) {
    message.warning('该协议没有表格参数，CSV 导入不可用')
    return
  }
  pendingImport = { inst, csvKey: tableKey }
  importInput.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const target = pendingImport
  pendingImport = null
  if (!file || !target) return
  try {
    const text = await file.text()
    await runtime.importParamsText(target.inst.instanceId, text, target.csvKey)
    message.success('参数已导入')
  } catch (err) {
    message.error(errorMessage(err))
  }
}

async function handleExportParams(inst: ProtocolInstance) {
  const content = runtime.exportParamsText(inst.instanceId, 'yaml')
  const { path } = await exportTextToDisk({
    feature: `${inst.manifest.name} 参数`,
    channelId: inst.channelId,
    channelLabel: channelLabel(inst.channelId),
    ext: 'yaml',
    content,
  })
  void revealPath(path)
}

async function handleExportData(inst: ProtocolInstance) {
  const data = runtime.exportData(inst.instanceId)
  if (!data) {
    message.warning('暂无读取数据（启动后等待数据）')
    return
  }
  const { path } = await exportTextToDisk({
    feature: `${inst.manifest.name} 数据`,
    channelId: inst.channelId,
    channelLabel: channelLabel(inst.channelId),
    ext: 'csv',
    content: data.csv,
  })
  await exportTextToDisk({
    feature: `${inst.manifest.name} 数据`,
    channelId: inst.channelId,
    channelLabel: channelLabel(inst.channelId),
    ext: 'json',
    content: data.json,
  })
  void revealPath(path)
}
</script>

<style scoped>
.protocol-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 2px;
}
.page-toolbar-title {
  font-weight: 600;
  font-size: 15px;
}
.inst-card {
  background: #fafafa;
  border: 1px solid #f0f0f0 !important;
  border-radius: 8px;
}
.inst-card :deep(.ant-card-head) {
  min-height: 40px;
  padding: 0 12px;
}
.inst-card :deep(.ant-card-body) {
  padding: 8px 12px 12px;
}
.inst-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 8px;
}
.inst-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.pkg-collapse,
.log-collapse {
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}
.pkg-collapse :deep(.ant-collapse-header),
.log-collapse :deep(.ant-collapse-header) {
  padding: 8px 12px !important;
  align-items: center;
}
.pkg-collapse :deep(.ant-collapse-content-box),
.log-collapse :deep(.ant-collapse-content-box) {
  padding: 0 12px 10px !important;
}
.pkg-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 4px;
}
.pkg-group {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
  margin-left: 4px;
  margin-right: 2px;
  white-space: nowrap;
}
.pkg-group:first-child {
  margin-left: 0;
}
.pkg-tag {
  cursor: pointer;
  margin-inline-end: 0 !important;
}
.pkg-ver {
  opacity: 0.7;
  margin-left: 2px;
  font-size: 11px;
}
.pkg-dir-btn {
  padding: 0 4px;
  height: auto;
}
.pkg-hint {
  margin-top: 6px;
}
.muted { color: rgba(0, 0, 0, 0.45); font-size: 12px; }
.log-box {
  max-height: 180px;
  overflow: auto;
  font-size: 12px;
  font-family: Consolas, monospace;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.preset-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
  white-space: nowrap;
}
.wizard-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow: auto;
}
.wizard-item {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.wizard-item:hover { border-color: #91caff; }
.wizard-item.active { border-color: #1677ff; background: #e6f4ff; }
.wizard-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.log-line { white-space: pre-wrap; }
.log-ts { color: rgba(0, 0, 0, 0.35); margin-right: 8px; }
.log-proto { color: #1677ff; margin-right: 8px; }
.lv-error { color: #cf1322; }
.lv-warn { color: #d48806; }
.doc-empty { margin-top: 12px; }
</style>
