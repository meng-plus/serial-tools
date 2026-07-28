<template>
  <div>
    <a-card title="系统日志" :bordered="false">
      <a-space style="margin-bottom: 16px">
        <a-select v-model:value="filterLevel" style="width: 120px" placeholder="全部级别" allowClear>
          <a-select-option value="info">Info</a-select-option>
          <a-select-option value="warn">Warn</a-select-option>
          <a-select-option value="error">Error</a-select-option>
        </a-select>
        <a-button @click="fetchLogs">刷新</a-button>
        <a-button @click="handleClear">清空</a-button>
        <a-button @click="handleExport">导出</a-button>
      </a-space>

      <a-table
        :columns="columns"
        :data-source="logStore.logs"
        :pagination="{ pageSize: 50 }"
        size="small"
        :scroll="{ y: 400 }"
      />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useLogStore } from '@/stores'

const logStore = useLogStore()
const filterLevel = ref<string | undefined>(undefined)

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 120 },
  { title: '级别', dataIndex: 'level', width: 80 },
  { title: '来源', dataIndex: 'source', width: 100 },
  { title: '消息', dataIndex: 'message' },
]

async function fetchLogs() {
  await logStore.fetchLogs(200, filterLevel.value)
}

async function handleClear() {
  await logStore.clearLogs()
}

async function handleExport() {
  // TODO: 打开保存对话框
}

onMounted(fetchLogs)
</script>
