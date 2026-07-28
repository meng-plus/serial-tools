<template>
  <div>
    <a-card title="协议解析" :bordered="false">
      <a-table
        :columns="columns"
        :data-source="parsedResults"
        :pagination="{ pageSize: 50 }"
        size="small"
        :scroll="{ y: 400 }"
      />
      <a-empty v-if="parsedResults.length === 0" description="暂无解析结果" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 120 },
  { title: '来源', dataIndex: 'source', width: 80 },
  { title: '规则', dataIndex: 'rule_id', width: 120 },
  { title: '内容', dataIndex: 'content' },
  { title: 'HEX', dataIndex: 'hex', width: 200 },
]

const parsedResults = ref([])
</script>
