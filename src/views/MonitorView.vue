<template>
  <div class="monitor-view">
    <div class="toolbar">
      <a-space>
        <a-button size="small" :disabled="cards.length === 0" @click="handleExport">导出</a-button>
        <span class="hint">卡片随解析数值事件刷新；曲线请用「图表」视图订阅 valueId</span>
      </a-space>
    </div>
    <a-empty v-if="cards.length === 0" description="暂无数值：请在解析日志中添加「转为数值」规则" />
    <a-row :gutter="[12, 12]">
      <a-col v-for="c in cards" :key="c.valueId" :xs="24" :sm="12" :md="8">
        <a-card size="small" :title="c.valueId">
          <div class="value">{{ c.sample?.value ?? '—' }}<span class="unit">{{ c.sample?.unit }}</span></div>
          <div class="ts">{{ c.sample?.timestamp || '等待更新' }}</div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useValueBus, useProtocolStore, useConnectionStore } from '@/stores'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'

const props = defineProps<{ channelId: string }>()
const valueBus = useValueBus()
const protocolStore = useProtocolStore()
const connectionStore = useConnectionStore()

const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const cards = computed(() => {
  void valueBus.series
  void valueBus.latest
  const fromRules = new Set<string>()
  for (const r of protocolStore.rules) {
    for (const f of r.fields) {
      if (f.as === 'number') fromRules.add(f.valueId || f.name)
    }
  }
  for (const id of valueBus.listValueIds(props.channelId)) fromRules.add(id)
  return [...fromRules].map(valueId => ({
    valueId,
    sample: valueBus.getLatest(props.channelId, valueId),
    series: valueBus.getSeries(props.channelId, valueId),
  }))
})

function handleExport() {
  if (cards.value.length === 0) {
    message.warning('当前无可导出数据')
    return
  }
  const content = JSON.stringify({
    channelId: props.channelId,
    exportedAt: new Date().toISOString(),
    values: cards.value.map(c => ({
      valueId: c.valueId,
      latest: c.sample ?? null,
      series: c.series,
    })),
  }, null, 2)
  void (async () => {
    try {
      const { path, via } = await exportTextToDisk({
        feature: '监控数值',
        channelId: props.channelId,
        channelLabel: channelLabel.value,
        ext: 'json',
        content,
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
      message.error(String(e))
    }
  })()
}
</script>

<style scoped>
.toolbar { margin-bottom: 12px; }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); }
.value { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.unit { font-size: 14px; margin-left: 6px; color: rgba(0,0,0,0.45); font-weight: 400; }
.ts { margin-top: 8px; font-size: 12px; color: rgba(0,0,0,0.45); }
</style>
