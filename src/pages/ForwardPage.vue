<template>
  <div>
    <a-card title="端口转发" :bordered="false">
      <a-space style="margin-bottom: 16px">
        <a-button type="primary" @click="showModal = true">新建转发</a-button>
      </a-space>

      <a-table
        :columns="columns"
        :data-source="forwarders"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'running' ? 'success' : 'default'">
              {{ record.status === 'running' ? '运行中' : '已停止' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button size="small" @click="handleStop(record.id)">停止</a-button>
            </a-space>
          </template>
        </template>
      </a-table>

      <a-empty v-if="forwarders.length === 0" description="暂无转发规则" />
    </a-card>

    <a-modal v-model:open="showModal" title="新建转发" @ok="handleCreate">
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input v-model:value="newForward.name" />
        </a-form-item>
        <a-form-item label="源类型">
          <a-select v-model:value="newForward.sourceType">
            <a-select-option value="serial">串口</a-select-option>
            <a-select-option value="tcp">TCP</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="源地址">
          <a-input v-model:value="newForward.sourceAddr" placeholder="COM3 或 192.168.1.100:5000" />
        </a-form-item>
        <a-form-item label="目标类型">
          <a-select v-model:value="newForward.targetType">
            <a-select-option value="serial">串口</a-select-option>
            <a-select-option value="tcp">TCP</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="目标地址">
          <a-input v-model:value="newForward.targetAddr" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { invoke } from '@/api'

const showModal = ref(false)
const forwarders = ref<any[]>([])

const columns = [
  { title: '名称', dataIndex: 'name' },
  { title: '源', dataIndex: 'source' },
  { title: '目标', dataIndex: 'target' },
  { title: '状态', key: 'status' },
  { title: 'RX', dataIndex: 'rx_count' },
  { title: 'TX', dataIndex: 'tx_count' },
  { title: '操作', key: 'action' },
]

const newForward = reactive({
  name: '',
  sourceType: 'serial',
  sourceAddr: '',
  targetType: 'tcp',
  targetAddr: '',
})

async function handleCreate() {
  await invoke('start_forward', {
    name: newForward.name,
    sourceType: newForward.sourceType,
    sourceAddr: newForward.sourceAddr,
    targetType: newForward.targetType,
    targetAddr: newForward.targetAddr,
  })
  showModal.value = false
  await loadForwarders()
}

async function handleStop(id: string) {
  await invoke('stop_forward', { id })
  await loadForwarders()
}

async function loadForwarders() {
  forwarders.value = await invoke('list_forwarders')
}

onMounted(loadForwarders)
</script>
