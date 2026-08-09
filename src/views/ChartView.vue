<template>
  <div class="chart-view">
    <div class="toolbar">
      <a-space wrap>
        <span class="label">订阅数值</span>
        <a-select
          v-model:value="selectedIds"
          mode="multiple"
          allow-clear
          placeholder="选择本通道 valueId"
          style="min-width: 260px"
          size="small"
          :options="valueOptions"
          @change="persistConfig"
        />
        <a-select v-model:value="maxPoints" style="width: 120px" size="small" @change="persistConfig">
          <a-select-option :value="50">最近 50 点</a-select-option>
          <a-select-option :value="100">最近 100 点</a-select-option>
          <a-select-option :value="200">最近 200 点</a-select-option>
          <a-select-option :value="500">最近 500 点</a-select-option>
        </a-select>
        <a-button size="small" :disabled="selectedIds.length === 0" @click="handleExport">导出</a-button>
        <a-button size="small" :disabled="selectedIds.length === 0" @click="clearSelectedSeries">清空所选序列</a-button>
      </a-space>
    </div>

    <a-empty
      v-if="availableIds.length === 0"
      description="暂无数值：请先在解析日志添加「转为数值」规则并收到匹配数据"
    />
    <a-empty
      v-else-if="selectedIds.length === 0"
      description="请在上方选择要订阅的 valueId"
    />
    <SeriesChart
      v-else
      :channel-id="channelId"
      :value-ids="selectedIds"
      :max-points="maxPoints"
      height="100%"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { errorMessage } from '@/utils/error'
import { message, Modal } from 'ant-design-vue'
import { useValueBus, useProtocolStore, useConnectionStore, useWorkspaceStore } from '@/stores'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'
import SeriesChart from '@/components/protocol/SeriesChart.vue'

const props = defineProps<{
  channelId: string
  viewId: string
}>()

const valueBus = useValueBus()
const protocolStore = useProtocolStore()
const connectionStore = useConnectionStore()
const workspace = useWorkspaceStore()

const selectedIds = ref<string[]>([])
const maxPoints = ref(100)

const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const availableIds = computed(() => {
  // 依赖 series/latest 以便事件驱动刷新
  void valueBus.series
  void valueBus.latest
  const ids = new Set<string>()
  for (const r of protocolStore.rules) {
    for (const f of r.fields) {
      if (f.as === 'number') ids.add(f.valueId || f.name)
    }
    for (const f of r.binaryFields || []) {
      ids.add(f.valueId || f.name)
    }
  }
  for (const id of valueBus.listValueIds(props.channelId)) ids.add(id)
  return [...ids]
})

const valueOptions = computed(() =>
  availableIds.value.map(id => ({ label: id, value: id }))
)

function loadConfig() {
  const views = workspace.viewsByChannel[props.channelId] || []
  const view = views.find(v => v.id === props.viewId)
  const cfg = (view?.config || {}) as { valueIds?: string[]; maxPoints?: number }
  if (Array.isArray(cfg.valueIds)) selectedIds.value = [...cfg.valueIds]
  if (typeof cfg.maxPoints === 'number') maxPoints.value = cfg.maxPoints
}

function persistConfig() {
  workspace.updateViewConfig(props.channelId, props.viewId, {
    valueIds: [...selectedIds.value],
    maxPoints: maxPoints.value,
  })
}

onMounted(loadConfig)
watch(() => props.viewId, loadConfig)

function clearSelectedSeries() {
  for (const id of selectedIds.value) {
    valueBus.clearSeries(props.channelId, id)
  }
  message.success('已清空所选序列缓冲（规则仍在）')
}

function handleExport() {
  if (selectedIds.value.length === 0) {
    message.warning('请先选择 valueId')
    return
  }
  void valueBus.series
  const payload = {
    channelId: props.channelId,
    exportedAt: new Date().toISOString(),
    maxPoints: maxPoints.value,
    series: selectedIds.value.map(valueId => ({
      valueId,
      points: valueBus.getSeries(props.channelId, valueId).slice(-maxPoints.value),
    })),
  }
  void (async () => {
    try {
      const { path, via } = await exportTextToDisk({
        feature: '图表数据',
        channelId: props.channelId,
        channelLabel: channelLabel.value,
        ext: 'json',
        content: JSON.stringify(payload, null, 2),
      })
      if (via === 'appdir') {
        Modal.success({
          title: '导出完成',
          content: `文件已保存到：\n${path}`,
          okText: '打开目录',
          onOk: () => revealPath(path),
        })
      } else {
        message.success(`已触发下载：${path}`)
      }
    } catch (e: unknown) {
      message.error(errorMessage(e))
    }
  })()
}
</script>

<style scoped>
.chart-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
  gap: 8px;
}
.toolbar { flex-shrink: 0; }
.label { font-size: 13px; color: rgba(0,0,0,0.45); }
</style>
