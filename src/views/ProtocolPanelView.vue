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
          <template v-if="showTopActions">
            <template v-for="a in instance.manifest.ui.actions || []" :key="a.id">
              <a-button size="small" :disabled="!instance.enabled" @click="runAction(a.id)">
                {{ a.label }}
              </a-button>
            </template>
          </template>
          <a-button size="small" @click="openSwitch">切换通道</a-button>
          <a-button size="small" :type="instance.enabled ? 'default' : 'primary'" @click="toggle">
            {{ instance.enabled ? '停止' : '启动' }}
          </a-button>
          <a-button size="small" type="link" @click="goConfig">
            参数配置
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

      <div class="panel-data">
        <template v-if="sections.length > 1">
          <div v-for="sec in sections" :key="sec.group?.id || '__default__'" class="panel-section">
            <div class="section-head">
              <strong>{{ sec.group?.label || '数据' }}</strong>
              <a-space wrap>
                <template v-for="b in sec.group?.buttons || []" :key="b.id">
                  <a-button
                    size="small"
                    :type="b.kind === 'write' ? 'primary' : 'default'"
                    :disabled="!instance.enabled"
                    @click="runGroupAction(b)"
                  >
                    {{ b.label }}
                  </a-button>
                </template>
              </a-space>
            </div>
            <div class="section-body">
              <template v-for="c in sec.controls" :key="c.id">
                <RegisterGrid
                  v-if="c.type === 'register_grid'"
                  :channel-id="channelId"
                  :instance-id="instance.instanceId"
                  :grid="c.grid || { label: c.title || '数据' }"
                />
                <InfoPanel
                  v-else-if="c.type === 'info_panel'"
                  :instance-id="instance.instanceId"
                  :control="c"
                />
                <ProgressPanel
                  v-else-if="c.type === 'progress'"
                  :instance-id="instance.instanceId"
                  :control="c"
                />
                <ValueCard
                  v-else-if="c.type === 'value'"
                  :channel-id="channelId"
                  :control="c"
                />
                <SeriesChart
                  v-else-if="c.type === 'chart'"
                  :channel-id="channelId"
                  :value-id="c.valueIds?.[0] || ''"
                  :max-points="c.maxPoints"
                  height="240px"
                />
              </template>
              <a-empty v-if="sec.controls.length === 0" description="该分组暂无数据控件。" />
            </div>
          </div>
        </template>
        <template v-else>
          <template v-for="c in sections[0]?.controls || []" :key="c.id">
            <RegisterGrid
              v-if="c.type === 'register_grid'"
              :channel-id="channelId"
              :instance-id="instance.instanceId"
              :grid="c.grid || { label: c.title || '数据' }"
            />
            <InfoPanel
              v-else-if="c.type === 'info_panel'"
              :instance-id="instance.instanceId"
              :control="c"
            />
            <ProgressPanel
              v-else-if="c.type === 'progress'"
              :instance-id="instance.instanceId"
              :control="c"
            />
            <ValueCard
              v-else-if="c.type === 'value'"
              :channel-id="channelId"
              :control="c"
            />
            <SeriesChart
              v-else-if="c.type === 'chart'"
              :channel-id="channelId"
              :value-id="c.valueIds?.[0] || ''"
              :max-points="c.maxPoints"
              height="240px"
            />
          </template>
          <a-empty v-if="(sections[0]?.controls || []).length === 0" description="该协议无实例面板（寄存器网格）声明，可在「参数配置」中调整。" />
        </template>
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
import { useRouter } from 'vue-router'
import { useConnectionStore, useWorkspaceStore, useProtocolRuntime } from '@/stores'
import { errorMessage } from '@/utils/error'
import RegisterGrid from '@/components/protocol/RegisterGrid.vue'
import ValueCard from '@/components/protocol/ValueCard.vue'
import SeriesChart from '@/components/protocol/SeriesChart.vue'
import InfoPanel from '@/components/protocol/InfoPanel.vue'
import ProgressPanel from '@/components/protocol/ProgressPanel.vue'
import { buildPanelControls } from '@/protocol-ext/dashboardTemplate'
import type { DashboardControl, GroupButtonDef, ProtocolInstance } from '@/protocol-ext/types'

const props = defineProps<{ channelId: string; viewId: string }>()

const runtime = useProtocolRuntime()
const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()
const router = useRouter()

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

/** 参与分区渲染的控件（register_grid / value / chart / info_panel / progress） */
const DATA_TYPES: DashboardControl['type'][] = [
  'register_grid',
  'value',
  'chart',
  'info_panel',
  'progress',
]

/** 分组已有按钮时，顶栏不再重复平铺全部 actions */
const showTopActions = computed(() => {
  const groups = instance.value?.manifest.ui.groups || []
  return !groups.some(g => (g.buttons || []).length > 0)
})

interface PanelSection {
  group?: { id: string; label: string; buttons?: GroupButtonDef[] }
  controls: DashboardControl[]
}

/** 按 ui.groups 分区渲染；未声明 groups 或全部无归属时降级为单区 */
const sections = computed<PanelSection[]>(() => {
  if (!instance.value) return []
  const controls = buildPanelControls(instance.value.manifest)
  const groups = instance.value.manifest.ui.groups || []
  const dataControls = controls.filter(c => DATA_TYPES.includes(c.type))
  if (groups.length === 0) {
    // 单区：全部数据控件（兼容旧行为）
    return [{ controls: dataControls }]
  }
  const hasAnyGroup = controls.some(c => c.group)
  if (!hasAnyGroup) {
    // groups 声明了但没有控件归属：全部并入第一个分区（同默认生成归属）
    return [{ group: groups[0], controls: dataControls }]
  }
  const sectionsOut: PanelSection[] = []
  const defaultControls: DashboardControl[] = []
  const byGroup = new Map<string, DashboardControl[]>()
  for (const c of controls) {
    if (!DATA_TYPES.includes(c.type)) continue
    if (!c.group) defaultControls.push(c)
    else {
      const arr = byGroup.get(c.group) || []
      arr.push(c)
      byGroup.set(c.group, arr)
    }
  }
  for (const g of groups) {
    sectionsOut.push({ group: g, controls: byGroup.get(g.id) || [] })
  }
  if (defaultControls.length > 0) {
    sectionsOut.push({ controls: defaultControls })
  }
  return sectionsOut
})

async function runGroupAction(b: GroupButtonDef) {
  if (!instance.value) return
  await runtime.runAction(instance.value.instanceId, b.action || b.id, b.args || {})
}

function bindFirst() {
  const inst = channelInstances.value[0]
  if (inst) workspace.updateViewConfig(props.channelId, props.viewId, { instanceId: inst.instanceId })
}

/** 参数配置入口：跳转到「协议扩展」页（配置统一在该页负责） */
function goConfig() {
  void router.push({ name: 'protocol' })
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
    const oldChannelId = inst.channelId
    await runtime.setInstanceChannel(inst.instanceId, switchChannelId.value)
    workspace.moveProtocolPanel(oldChannelId, switchChannelId.value, inst.instanceId)
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
.panel-data { display: flex; flex-direction: column; gap: 8px; }
.panel-section { border: 1px solid #f0f0f0; border-radius: 6px; overflow: hidden; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}
.section-body { padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
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