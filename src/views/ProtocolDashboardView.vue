<template>
  <div class="dash-view">
    <div class="dash-toolbar">
      <a-space wrap>
        <span class="label">绑定实例</span>
        <a-select
          :value="targetInstanceId"
          style="min-width: 200px"
          size="small"
          placeholder="选择协议实例"
          @change="setInstance"
        >
          <a-select-option v-for="i in channelInstances" :key="i.instanceId" :value="i.instanceId">
            {{ i.manifest.name }}（{{ i.enabled ? '运行中' : '未启动' }}）
          </a-select-option>
        </a-select>
        <a-button size="small" :type="editMode ? 'primary' : 'default'" @click="editMode = !editMode">
          {{ editMode ? '完成编辑' : '编辑布局' }}
        </a-button>
        <a-dropdown v-if="editMode">
          <a-button size="small" type="dashed">添加控件</a-button>
          <template #overlay>
            <a-menu @click="addControl">
              <a-menu-item key="value">数值卡</a-menu-item>
              <a-menu-item key="button">按钮（触发动作）</a-menu-item>
              <a-menu-item key="table">变量表</a-menu-item>
              <a-menu-item key="chart">趋势图</a-menu-item>
              <a-menu-item key="text">文本标签</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
      <a-empty
        v-if="channelInstances.length === 0"
        style="margin-top: 12px"
      >
        <template #description>
          <div class="empty-desc">
            <p>该通道暂无协议实例。可点击「一键创建示例」快速体验：自动创建内置 Modbus 主站实例并填充仪表盘。</p>
            <a-button
              type="primary"
              size="small"
              :loading="creatingExample"
              @click="createExample"
            >
              一键创建示例实例
            </a-button>
          </div>
        </template>
      </a-empty>
    </div>

    <div v-if="controls.length" class="dash-grid">
      <div
        v-for="c in controls"
        :key="c.id"
        class="dash-cell"
        :class="{ editing: editMode }"
        :style="cellStyle(c)"
      >
        <div class="cell-head">
          <span class="cell-title">{{ c.title || controlTitle(c) }}</span>
          <a-space v-if="editMode" size="small">
            <a-button size="small" type="link" @click="openEdit(c)">编辑</a-button>
            <a-button size="small" type="link" danger @click="removeControl(c.id)">删除</a-button>
          </a-space>
        </div>
        <div class="cell-body">
          <!-- value -->
          <div v-if="c.type === 'value'" class="value-big">
            <span class="value-num">{{ formatValue(latestOf(c)) }}</span>
            <span class="value-unit">{{ latestOf(c)?.unit || '' }}</span>
          </div>
          <!-- button -->
          <a-button
            v-else-if="c.type === 'button'"
            block
            :disabled="!targetInstance || !targetInstance.enabled"
            @click="runtime.runAction(targetInstanceId, c.actionId || '', c.actionParams || {})"
          >
            {{ c.title || actionLabel(c.actionId) }}
          </a-button>
          <!-- table -->
          <a-table
            v-else-if="c.type === 'table'"
            size="small"
            :data-source="tableRows(c)"
            :columns="tableColumns"
            :pagination="false"
            row-key="valueId"
          />
          <!-- chart -->
          <v-chart v-else-if="c.type === 'chart'" class="dash-chart" :option="chartOption(c)" autoresize />
          <!-- text -->
          <div v-else-if="c.type === 'text'" class="dash-text">{{ c.text }}</div>
        </div>
      </div>
    </div>
    <a-empty v-else description="尚无控件，点击「编辑布局」添加" />

    <a-modal
      v-model:open="modalOpen"
      title="编辑控件"
      width="560px"
      @ok="saveEdit"
    >
      <a-form v-if="editing" layout="vertical">
        <a-form-item label="标题">
          <a-input v-model:value="editing.title" placeholder="留空则自动取绑定信息" />
        </a-form-item>
        <a-form-item v-if="['value', 'table', 'chart'].includes(editing.type)" label="绑定变量 (valueId)">
          <a-select
            v-model:value="editing.valueIds"
            mode="multiple"
            allow-clear
            :options="valueOptions"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item v-if="editing.type === 'button'" label="触发动作">
          <a-select v-model:value="editing.actionId" :options="actionOptions" style="width: 100%" />
        </a-form-item>
        <a-form-item v-if="editing.type === 'text'" label="文本">
          <a-textarea v-model:value="editing.text" :rows="3" />
        </a-form-item>
        <a-space wrap>
          <a-form-item label="行(row)">
            <a-input-number v-model:value="editing.row" :min="0" :max="20" />
          </a-form-item>
          <a-form-item label="列(col)">
            <a-input-number v-model:value="editing.col" :min="0" :max="11" />
          </a-form-item>
          <a-form-item label="宽(1-12)">
            <a-input-number v-model:value="editing.w" :min="1" :max="12" />
          </a-form-item>
          <a-form-item label="高">
            <a-input-number v-model:value="editing.h" :min="1" :max="12" />
          </a-form-item>
        </a-space>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useConnectionStore, useValueBus, useWorkspaceStore } from '@/stores'
import { useProtocolRuntime } from '@/protocol-ext/manager'
import type { DashboardControl } from '@/protocol-ext/types'
import type { ValueSample } from '@/protocol/types'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

const props = defineProps<{ channelId: string; viewId: string }>()

const valueBus = useValueBus()
const workspace = useWorkspaceStore()
const runtime = useProtocolRuntime()
const connection = useConnectionStore()

const editMode = ref(false)
const modalOpen = ref(false)
const editing = ref<DashboardControl | null>(null)
const creatingExample = ref(false)

const channelInstances = computed(() =>
  runtime.instances.filter(i => i.channelId === props.channelId),
)

const view = computed(() =>
  workspace.viewsByChannel[props.channelId]?.find(v => v.id === props.viewId),
)

const configInstanceId = computed(() => String(view.value?.config?.instanceId || ''))

const targetInstanceId = computed(() => {
  if (channelInstances.value.some(i => i.instanceId === configInstanceId.value)) {
    return configInstanceId.value
  }
  return channelInstances.value[0]?.instanceId || ''
})

const targetInstance = computed(() =>
  runtime.instances.find(i => i.instanceId === targetInstanceId.value),
)

const controls = computed<DashboardControl[]>(() => {
  const c = view.value?.config?.controls
  return Array.isArray(c) ? (c as DashboardControl[]) : []
})

function setInstance(id: string) {
  workspace.updateViewConfig(props.channelId, props.viewId, { instanceId: id })
}

function persist(controlsList: DashboardControl[]) {
  workspace.updateViewConfig(props.channelId, props.viewId, { controls: controlsList })
}

function cellStyle(c: DashboardControl) {
  return {
    gridColumn: `${c.col + 1} / span ${c.w}`,
    gridRow: `${c.row + 1} / span ${c.h}`,
  }
}

function controlTitle(c: DashboardControl): string {
  if (c.title) return c.title
  if (c.type === 'button') return actionLabel(c.actionId)
  if (c.type === 'value' || c.type === 'table' || c.type === 'chart') {
    return (c.valueIds || []).join(', ') || c.type
  }
  return c.type
}

function actionLabel(actionId?: string): string {
  const a = targetInstance.value?.manifest.ui.actions?.find(x => x.id === actionId)
  return a?.label || actionId || '按钮'
}

// ---------- 值 ----------

function latestOf(c: DashboardControl): ValueSample | undefined {
  const id = c.valueIds?.[0]
  return id ? valueBus.getLatest(props.channelId, id) : undefined
}

function formatValue(s?: ValueSample): string {
  if (s == null) return '—'
  const n = Number(s.value)
  return Number.isNaN(n) ? String(s.value) : String(n)
}

const valueOptions = computed(() => {
  const ids = new Set(valueBus.listValueIds(props.channelId))
  for (const v of targetInstance.value?.variables || []) ids.add(v.key)
  return [...ids].map(id => ({ value: id, label: id }))
})

const actionOptions = computed(() =>
  (targetInstance.value?.manifest.ui.actions || []).map(a => ({ value: a.id, label: a.label })),
)

// ---------- 表格 ----------

const tableColumns = [
  { title: '变量', dataIndex: 'valueId', key: 'valueId' },
  { title: '值', dataIndex: 'value', key: 'value' },
  { title: '单位', dataIndex: 'unit', key: 'unit' },
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp' },
]

function tableRows(c: DashboardControl) {
  return (c.valueIds || []).map(id => {
    const s = valueBus.getLatest(props.channelId, id)
    return {
      valueId: id,
      value: s == null ? '—' : String(s.value),
      unit: s?.unit || '',
      timestamp: s?.timestamp || '',
    }
  })
}

// ---------- 图表 ----------

function chartOption(c: DashboardControl) {
  const ids = c.valueIds || []
  const series = ids.map(id => {
    const samples = valueBus.getSeries(props.channelId, id)
    return {
      name: id,
      type: 'line' as const,
      showSymbol: false,
      data: samples.slice(-200).map(s => ({ value: [s.timestamp, s.value] })),
    }
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { show: ids.length > 1, type: 'scroll' as const },
    grid: { left: 40, right: 12, top: 28, bottom: 40 },
    xAxis: { type: 'category' as const },
    yAxis: { type: 'value' as const, scale: true },
    series,
  }
}

// ---------- 编辑 ----------

function addControl(info: { key: string }) {
  const type = info.key as DashboardControl['type']
  const c: DashboardControl = {
    id: `ctl-${Date.now()}`,
    type,
    row: 0,
    col: 0,
    w: type === 'chart' ? 12 : type === 'value' ? 4 : 6,
    h: type === 'chart' ? 6 : type === 'button' ? 2 : 4,
    valueIds: [],
  }
  persist([...controls.value, c])
}

function openEdit(c: DashboardControl) {
  editing.value = { ...c, valueIds: [...(c.valueIds || [])], actionParams: { ...(c.actionParams || {}) } }
  modalOpen.value = true
}

function saveEdit() {
  if (!editing.value) return
  persist(controls.value.map(c => (c.id === editing.value!.id ? editing.value! : c)))
  modalOpen.value = false
  editing.value = null
}

function removeControl(id: string) {
  persist(controls.value.filter(c => c.id !== id))
}

// ---------- 一键创建示例 ----------

const CHANNEL_TYPE_TO_PROTOCOL: Record<string, string> = {
  serial: 'modbus-rtu-master',
  tcp_client: 'modbus-tcp-master',
}

async function createExample() {
  if (creatingExample.value) return
  creatingExample.value = true
  try {
    const protoId =
      CHANNEL_TYPE_TO_PROTOCOL[connection.channels.get(props.channelId)?.transportType || ''] ||
      'modbus-rtu-master'
    const inst = await runtime.createInstance(protoId, props.channelId, {
      poll: [
        { name: 'temp', addr: 1, func: 3, start: 0, count: 10 },
        { name: 'pressure', addr: 2, func: 3, start: 0, count: 5 },
      ],
    })
    await runtime.startInstance(inst.instanceId)
    setInstance(inst.instanceId)
    const base = [
      { id: 'ctl-demo-1', type: 'value', row: 0, col: 0, w: 4, h: 2, title: '温度', valueIds: ['temp_0'] },
      { id: 'ctl-demo-2', type: 'value', row: 0, col: 4, w: 4, h: 2, title: '压力', valueIds: ['pressure_0'] },
      { id: 'ctl-demo-3', type: 'chart', row: 0, col: 8, w: 4, h: 6, title: '温度趋势', valueIds: ['temp_0'] },
      { id: 'ctl-demo-4', type: 'table', row: 2, col: 0, w: 4, h: 4, title: '寄存器', valueIds: ['temp_0', 'temp_1'] },
      { id: 'ctl-demo-5', type: 'button', row: 2, col: 4, w: 4, h: 2, title: '立即读取一轮', actionId: 'read_all' },
      { id: 'ctl-demo-6', type: 'text', row: 2, col: 8, w: 4, h: 2, text: '示例：Modbus 主站周期轮询读取寄存器，数值经协议引擎推送至此。' },
    ] as DashboardControl[]
    persist(base)
    message.success('已创建示例实例并启动，可在「协议扩展」页调整参数')
  } catch (e) {
    message.error(`创建示例失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    creatingExample.value = false
  }
}
</script>

<style scoped>
.dash-view { display: flex; flex-direction: column; height: 100%; }
.dash-toolbar { margin-bottom: 8px; }
.label { color: rgba(0, 0, 0, 0.45); font-size: 12px; }
.dash-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 40px;
  gap: 8px;
  overflow: auto;
  align-content: start;
}
.dash-cell {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}
.dash-cell.editing { border: 1px dashed #1677ff; }
.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.cell-title { font-size: 12px; color: rgba(0, 0, 0, 0.65); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell-body { flex: 1; min-height: 0; }
.value-big { font-size: 22px; font-weight: 600; display: flex; align-items: baseline; gap: 6px; }
.value-num { font-family: Consolas, monospace; }
.value-unit { font-size: 12px; color: rgba(0, 0, 0, 0.45); }
.dash-chart { width: 100%; height: 100%; min-height: 80px; }
.dash-text { white-space: pre-wrap; font-size: 13px; }
.empty-desc { text-align: center; }
.empty-desc p { color: rgba(0, 0, 0, 0.45); margin-bottom: 12px; max-width: 420px; }
</style>
