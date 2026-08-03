<template>
  <div class="panel-view">
    <a-empty v-if="!instance" description="未绑定协议实例或实例不存在">
      <template #description>
        <div class="panel-empty">
          <p>此面板未绑定实例。可到「协议扩展」页创建实例，或重新添加本视图。</p>
          <a-button size="small" type="primary" @click="bindFirst">绑定第一个实例</a-button>
        </div>
      </template>
    </a-empty>

    <template v-else>
      <div class="panel-head">
        <a-space wrap>
          <strong>{{ instance.manifest.name }}</strong>
          <a-tag color="blue">{{ roleLabel(instance.manifest.role) }}</a-tag>
          <a-tag :color="statusColor(instance.status)">{{ statusText(instance) }}</a-tag>
          <span class="muted">通道：{{ channelLabel }}</span>
          <span v-if="instance.lastRxAt" class="muted">最近收包 {{ instance.lastRxAt }}</span>
        </a-space>
        <a-space wrap>
          <template v-for="a in instance.manifest.ui.actions || []" :key="a.id">
            <a-button size="small" :disabled="!instance.enabled" @click="runAction(a.id)">
              {{ a.label }}
            </a-button>
          </template>
          <a-button size="small" @click="openSwitch">切换通道</a-button>
          <a-button size="small" :type="instance.enabled ? 'default' : 'primary'" @click="toggle">
            {{ instance.enabled ? '停止' : '启动' }}
          </a-button>
        </a-space>
      </div>

      <a-alert
        v-if="instance.status === 'error' && instance.error"
        type="error"
        show-icon
        :message="instance.error"
        style="margin: 8px 0"
      />

      <a-collapse :default-active-key="['params']" class="panel-collapse">
        <a-collapse-panel key="params" header="参数配置">
          <ParamForm
            :params="instance.manifest.ui.params || []"
            :model-value="instance.params"
            @update:model-value="onParams"
          />
        </a-collapse-panel>
      </a-collapse>

      <div class="panel-data">
        <RegisterGrid
          v-for="c in gridControls"
          :key="c.id"
          :channel-id="channelId"
          :instance-id="instance.instanceId"
          :grid="c.grid || { label: c.title || '数据' }"
        />
      </div>
    </template>

    <a-modal
      v-model:open="switchOpen"
      title="切换实例通道"
      width="560px"
      :confirm-loading="switching"
      @ok="handleSwitchOk"
    >
      <a-alert
        v-if="switchInst"
        type="info"
        show-icon
        message="切换后若实例正在运行会自动重启。"
        style="margin-bottom: 12px"
      />
      <a-empty
        v-if="channels.length === 0"
        description="当前无任何通道，请先在「连接」页建立连接。"
      />
      <template v-else>
        <div class="switch-list">
          <div
            v-for="ch in channels"
            :key="ch.channelId"
            class="switch-item"
            :class="{ active: switchChannelId === ch.channelId }"
            @click="switchChannelId = ch.channelId"
          >
            <div class="switch-item-head">
              <b>{{ ch.portName || ch.channelId }}</b>
              <a-tag :color="ch.connected ? 'success' : 'default'" size="small">
                {{ ch.connected ? '已连接' : '未连接' }}
              </a-tag>
            </div>
            <div class="muted">{{ ch.channelId }}</div>
          </div>
        </div>
      </template>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { useConnectionStore, useWorkspaceStore, useProtocolRuntime } from '@/stores'
import { errorMessage } from '@/utils/error'
import ParamForm from '@/components/protocol/ParamForm.vue'
import RegisterGrid from '@/components/protocol/RegisterGrid.vue'
import { buildPanelControls } from '@/protocol-ext/dashboardTemplate'
import type { DashboardControl, ProtocolInstance } from '@/protocol-ext/types'

const props = defineProps<{ channelId: string; viewId: string }>()

const runtime = useProtocolRuntime()
const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()

const view = computed(() =>
  workspace.viewsByChannel[props.channelId]?.find(v => v.id === props.viewId),
)

const configInstanceId = computed(() => String(view.value?.config?.instanceId || ''))

const channelInstances = computed<ProtocolInstance[]>(() =>
  runtime.instances.filter(i => i.channelId === props.channelId),
)

const instance = computed<ProtocolInstance | undefined>(() => {
  const list = channelInstances.value
  if (list.some(i => i.instanceId === configInstanceId.value)) {
    return list.find(i => i.instanceId === configInstanceId.value)
  }
  return list[0]
})

const channels = computed(() => connectionStore.channelList)

const channelLabel = computed(() => {
  const ch = channels.value.find(c => c.channelId === instance.value?.channelId)
  return ch ? ch.portName || ch.channelId : (instance.value?.channelId || '')
})

const gridControls = computed<DashboardControl[]>(() => {
  if (!instance.value) return []
  const controls = buildPanelControls(instance.value.manifest)
  return controls.filter(c => c.type === 'register_grid')
})

function bindFirst() {
  const inst = channelInstances.value[0]
  if (inst) workspace.updateViewConfig(props.channelId, props.viewId, { instanceId: inst.instanceId })
}

function onParams(v: Record<string, unknown>) {
  if (!instance.value) return
  runtime.setParams(instance.value.instanceId, diff(instance.value.params, v))
}

function roleLabel(role: string): string {
  return role === 'master' ? '主站' : role === 'slave' ? '从站' : '被动'
}

function statusColor(s: string) {
  if (s === 'running') return 'success'
  if (s === 'error') return 'error'
  return 'default'
}

function statusText(inst: { status: string }) {
  if (inst.status === 'running') return '运行中'
  if (inst.status === 'error') return '错误'
  return '未启动'
}

async function runAction(actionId: string) {
  if (!instance.value) return
  await runtime.runAction(instance.value.instanceId, actionId, {})
}

async function toggle() {
  if (!instance.value) return
  await runtime.toggleInstance(instance.value.instanceId)
}

function diff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(next)) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) patch[k] = next[k]
  }
  return patch
}

// ---------- 切换通道 ----------

const switchOpen = ref(false)
const switching = ref(false)
const switchInst = ref<ProtocolInstance | null>(null)
const switchChannelId = ref('')

function openSwitch() {
  switchInst.value = instance.value ?? null
  switchChannelId.value = instance.value?.channelId || ''
  switchOpen.value = true
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
    await runtime.setInstanceChannel(inst.instanceId, switchChannelId.value)
    message.success('已切换通道')
    switchOpen.value = false
  } catch (e) {
    message.error(errorMessage(e))
  } finally {
    switching.value = false
  }
}
</script>

<style scoped>
.panel-view { display: flex; flex-direction: column; gap: 8px; padding: 4px; }
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.panel-collapse :deep(.ant-collapse-content-box) { padding: 12px; }
.panel-data { display: flex; flex-direction: column; gap: 8px; }
.muted { color: rgba(0, 0, 0, 0.45); font-size: 12px; }
.panel-empty { text-align: center; }
.panel-empty p { color: rgba(0, 0, 0, 0.45); margin-bottom: 12px; }
.switch-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow: auto; }
.switch-item {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.switch-item:hover { border-color: #91caff; }
.switch-item.active { border-color: #1677ff; background: #e6f4ff; }
.switch-item-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
</style>