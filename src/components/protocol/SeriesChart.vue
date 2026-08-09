<template>
  <div class="series-chart" :style="{ height }">
    <a-empty
      v-if="ids.length === 0"
      description="未配置 valueId"
    />
    <v-chart v-else class="chart" :option="chartOption" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import { useValueBus } from '@/stores'

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
])

const props = defineProps<{
  channelId: string
  valueId?: string
  valueIds?: string[]
  maxPoints?: number
  height?: string
}>()

const valueBus = useValueBus()

const ids = computed(() => {
  const list = props.valueIds && props.valueIds.length > 0 ? props.valueIds : [props.valueId || '']
  return list.filter(Boolean)
})

const chartOption = computed(() => {
  void valueBus.series
  const COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2']
  const series = ids.value.map((valueId, i) => {
    const samples = valueBus.getSeries(props.channelId, valueId).slice(-(props.maxPoints || 100))
    return {
      name: valueId,
      type: 'line' as const,
      showSymbol: samples.length < 40,
      smooth: true,
      data: samples.map(s => [s.timestamp, s.value]),
      color: COLORS[i % COLORS.length],
    }
  })
  return {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 48, right: 16, top: 32, bottom: 32 },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16 }],
    xAxis: { type: 'category', boundaryGap: false },
    yAxis: { type: 'value', scale: true },
    series,
  }
})
</script>

<style scoped>
.series-chart { width: 100%; }
.chart { width: 100%; height: 100%; min-height: 200px; }
</style>
