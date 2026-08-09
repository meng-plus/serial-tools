<template>
  <div class="info-panel">
    <div v-if="control.title" class="ip-title">{{ control.title }}</div>
    <div v-if="rows.length === 0" class="ip-empty">暂无查询结果，请点击上方读取按钮</div>
    <dl v-else class="ip-list">
      <div v-for="row in rows" :key="row.key" class="ip-row" :class="row.level || 'info'">
        <dt>{{ row.label || row.key }}</dt>
        <dd>
          <span class="ip-text">{{ row.text || '--' }}</span>
          <span v-if="row.updatedAt" class="ip-time">{{ row.updatedAt }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useProtocolRuntime } from '@/stores'
import { selectInfoEntries } from '@/protocol-ext/infoMap'
import type { DashboardControl } from '@/protocol-ext/types'

const props = defineProps<{
  instanceId: string
  control: DashboardControl
}>()

const runtime = useProtocolRuntime()

const rows = computed(() => {
  void runtime.infoByInstance
  const map = runtime.getInstanceInfo(props.instanceId)
  return selectInfoEntries(map, props.control.keys)
})
</script>

<style scoped>
.info-panel {
  padding: 8px 10px;
  background: var(--color-fill-2, #fafafa);
  border: 1px solid var(--color-border-2, #e8e8e8);
  border-radius: 6px;
  min-height: 64px;
}
.ip-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.ip-empty {
  color: var(--color-text-3, #999);
  font-size: 13px;
}
.ip-list {
  margin: 0;
  display: grid;
  gap: 6px;
}
.ip-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
}
.ip-row dt {
  margin: 0;
  color: var(--color-text-2, #666);
}
.ip-row dd {
  margin: 0;
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}
.ip-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}
.ip-time {
  color: var(--color-text-3, #999);
  font-size: 12px;
}
.ip-row.warn .ip-text { color: #d48806; }
.ip-row.error .ip-text { color: #cf1322; }
</style>
