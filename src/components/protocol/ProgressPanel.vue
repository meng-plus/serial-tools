<template>
  <div class="progress-panel">
    <div v-if="control.title" class="pp-title">{{ control.title }}</div>
    <div v-if="!entry" class="pp-empty">暂无进度</div>
    <template v-else>
      <div class="pp-label">{{ entry.label || entry.id }}</div>
      <a-progress
        :percent="percent"
        :status="entry.done ? (percent >= 100 ? 'success' : 'exception') : 'active'"
        size="small"
      />
      <div class="pp-meta muted">
        {{ entry.current }} / {{ entry.total }}
        <span v-if="entry.updatedAt"> · {{ entry.updatedAt }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useProtocolRuntime } from '@/stores'
import { progressPercent } from '@/protocol-ext/progressMap'
import type { DashboardControl } from '@/protocol-ext/types'

const props = defineProps<{
  instanceId: string
  control: DashboardControl
}>()

const runtime = useProtocolRuntime()

const entry = computed(() => {
  void runtime.progressByInstance
  const id = props.control.progressId || props.control.keys?.[0]
  if (!id) return null
  return runtime.getInstanceProgress(props.instanceId)[id] || null
})

const percent = computed(() => (entry.value ? progressPercent(entry.value) : 0))
</script>

<style scoped>
.progress-panel {
  padding: 8px 10px;
  background: var(--color-fill-2, #fafafa);
  border: 1px solid var(--color-border-2, #e8e8e8);
  border-radius: 6px;
  min-height: 64px;
}
.pp-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.pp-empty {
  color: var(--color-text-3, #999);
  font-size: 13px;
}
.pp-label {
  font-size: 13px;
  margin-bottom: 4px;
}
.pp-meta {
  font-size: 12px;
  margin-top: 4px;
}
.muted {
  color: var(--color-text-3, #999);
}
</style>
