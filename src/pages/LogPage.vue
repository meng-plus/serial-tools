<template>
  <div>
    <a-card title="系统日志" :bordered="false" size="small">
      <template #extra>
        <a-space>
          <a-select v-model:value="logStore.filterLevel" style="width: 120px" placeholder="全部级别" allowClear size="small"
            @change="(v: string) => logStore.fetchLogs(200, v)">
            <a-select-option value="info">Info</a-select-option>
            <a-select-option value="warn">Warn</a-select-option>
            <a-select-option value="error">Error</a-select-option>
          </a-select>
          <a-button size="small" @click="logStore.fetchLogs()">刷新</a-button>
          <a-button size="small" danger @click="logStore.clearLogs()">清空</a-button>
          <a-button size="small" @click="handleExportCSV">导出 CSV</a-button>
        </a-space>
      </template>

      <a-table
        :columns="columns"
        :data-source="logStore.logs"
        :pagination="{ pageSize: 50, showSizeChanger: true }"
        size="small"
        :scroll="{ y: 500 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'level'">
            <a-tag :color="levelColors[record.level] || 'default'" size="small">
              {{ record.level.toUpperCase() }}
            </a-tag>
          </template>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useLogStore } from '@/stores'

const logStore = useLogStore()

const levelColors: Record<string, string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
}

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 140 },
  { title: '级别', key: 'level', width: 80 },
  { title: '来源', dataIndex: 'source', width: 120 },
  { title: '消息', dataIndex: 'message', ellipsis: true },
]

function handleExportCSV() {
  const header = '时间,级别,来源,消息\n'
  const rows = logStore.logs.map(l =>
    `"${l.timestamp}","${l.level}","${l.source}","${l.message.replace(/"/g, '""')}"`
  ).join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `serial-tools-logs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => logStore.fetchLogs())
</script>
