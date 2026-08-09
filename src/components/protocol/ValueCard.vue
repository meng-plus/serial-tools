<template>
  <div class="value-card">
    <div class="vc-head">
      <span class="vc-title" :title="valueId">{{ control.title || valueId }}</span>
      <a-space size="4">
        <a-button size="small" type="text" :disabled="!latest" @click="historyOpen = true">
          历史
        </a-button>
      </a-space>
    </div>
    <div class="vc-body">
      <template v-if="latest">
        <span class="vc-num">{{ formatValue(latest.value) }}</span>
        <span v-if="latest.unit" class="vc-unit">{{ latest.unit }}</span>
      </template>
      <span v-else class="vc-na">--</span>
      <div v-if="latest" class="vc-time">{{ formatTime(latest.timestamp) }}</div>
    </div>

    <a-drawer
      :open="historyOpen"
      :title="`${control.title || valueId} · 历史记录`"
      placement="right"
      width="560"
      @close="historyOpen = false"
    >
      <a-table
        :data-source="history"
        :columns="historyColumns"
        :pagination="false"
        size="small"
        row-key="timestamp"
      />
      <a-empty v-if="history.length === 0" description="暂无历史样本" />
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useValueBus } from '@/stores'
import type { DashboardControl } from '@/protocol-ext/types'
import type { ValueSample } from '@/protocol/types'

const props = defineProps<{
  channelId: string
  control: DashboardControl
}>()

const valueBus = useValueBus()
const historyOpen = ref(false)

/** 卡片主 valueId：valueIds[0]，无则用 title */
const valueId = computed(() => props.control.valueIds?.[0] || props.control.title || '')

const latest = computed(() => {
  void valueBus.latest
  return valueId.value ? valueBus.getLatest(props.channelId, valueId.value) : undefined
})

const history = computed<ValueSample[]>(() => {
  void valueBus.series
  if (!valueId.value) return []
  return valueBus.getSeries(props.channelId, valueId.value).slice(-HISTORY_LIMIT).reverse()
})

const HISTORY_LIMIT = 200

const historyColumns = [
  { key: 'time', title: '时间', dataIndex: 'timestamp', width: 180, customRender: ({ text }: { text: string }) => formatTime(text) },
  { key: 'value', title: '数值', dataIndex: 'value', width: 120, customRender: ({ text }: { text: number }) => formatValue(text) },
  { key: 'unit', title: '单位', dataIndex: 'unit' },
]

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
</script>

<style scoped>
.value-card {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 10px 12px;
  min-width: 160px;
  background: #fff;
}
.vc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}
.vc-title {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vc-body { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.vc-num { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.vc-unit { font-size: 12px; color: rgba(0, 0, 0, 0.45); }
.vc-na { font-size: 18px; color: rgba(0, 0, 0, 0.25); }
.vc-time { width: 100%; font-size: 11px; color: rgba(0, 0, 0, 0.35); }
</style>
