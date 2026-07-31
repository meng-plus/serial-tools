<template>
  <div>
    <a-card title="端口转发" :bordered="false">
      <a-alert
        type="info"
        show-icon
        message="转发说明"
        description="在两个已连接的通道之间建立数据桥接。支持：串口↔TCP、串口↔串口、TCP↔TCP。请先在「连接管理」页面建立两个连接，再创建转发规则。"
        style="margin-bottom: 16px"
      />

      <a-button type="primary" @click="showModal = true" :disabled="connections.length < 2">
        新建转发
      </a-button>

      <a-table
        :columns="columns"
        :data-source="forwarders"
        :pagination="false"
        size="small"
        style="margin-top: 16px"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'direction'">
            {{ directionLabel(record.direction) }}
          </template>
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'running' ? 'success' : 'default'">
              {{ record.status === 'running' ? '运行中' : '已停止' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button
                v-if="record.status === 'running'"
                size="small"
                danger
                @click="handleStop(record.id)"
              >
                停止
              </a-button>
              <a-button
                v-else
                size="small"
                @click="handleDelete(record.id)"
              >
                删除
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>

      <a-empty v-if="forwarders.length === 0" description="暂无转发规则" />
    </a-card>

    <a-modal v-model:open="showModal" title="新建转发" @ok="handleCreate" :confirm-loading="creating">
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input v-model:value="newForward.name" placeholder="例: 串口转TCP" />
        </a-form-item>
        <a-form-item label="源通道">
          <a-select v-model:value="newForward.sourceChannelId" placeholder="选择源通道">
            <a-select-option v-for="c in connections" :key="c.channel_id" :value="c.channel_id">
              {{ c.channel_id }} ({{ c.transport_type }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="目标通道">
          <a-select v-model:value="newForward.targetChannelId" placeholder="选择目标通道">
            <a-select-option
              v-for="c in connections"
              :key="c.channel_id"
              :value="c.channel_id"
              :disabled="c.channel_id === newForward.sourceChannelId"
            >
              {{ c.channel_id }} ({{ c.transport_type }})
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="转发方向">
          <a-radio-group v-model:value="newForward.direction">
            <a-radio value="bidirectional">双向 (↔)</a-radio>
            <a-radio value="source_to_target">单向 (→)</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'
import { useConnectionStore } from '@/stores'

const connectionStore = useConnectionStore()

interface ConnectionStatus {
  connected: boolean
  channel_id: string
  transport_type: string
  port_name: string
}

interface ForwarderInfo {
  id: string
  name: string
  source: string
  target: string
  direction: string
  status: string
  rx_bytes: number
  tx_bytes: number
}

const showModal = ref(false)
const creating = ref(false)
const connections = ref<ConnectionStatus[]>([])
const forwarders = ref<ForwarderInfo[]>([])

const columns = [
  { title: '名称', dataIndex: 'name' },
  { title: '源通道', dataIndex: 'source' },
  { title: '目标通道', dataIndex: 'target' },
  { title: '方向', key: 'direction' },
  { title: '状态', key: 'status' },
  { title: '操作', key: 'action' },
]

const newForward = reactive({
  name: '',
  sourceChannelId: '',
  targetChannelId: '',
  direction: 'bidirectional',
})

let pollTimer: ReturnType<typeof setInterval> | null = null

function directionLabel(d: string): string {
  if (d === 'bidirectional') return '双向 ↔'
  if (d === 'source_to_target') return '单向 →'
  if (d === 'target_to_source') return '单向 ←'
  return d
}

async function refreshForwarders() {
  try {
    forwarders.value = await invoke<ForwarderInfo[]>('list_forwarders')
  } catch { /* ignore */ }
}

function syncConnections() {
  connections.value = connectionStore.connectedChannels.map(c => ({
    connected: c.connected,
    channel_id: c.channelId,
    transport_type: c.transportType,
    port_name: c.portName,
  }))
}

async function handleCreate() {
  if (!newForward.sourceChannelId || !newForward.targetChannelId) {
    message.warning('请选择源通道和目标通道')
    return
  }
  if (newForward.sourceChannelId === newForward.targetChannelId) {
    message.warning('源通道和目标通道不能相同')
    return
  }
  creating.value = true
  try {
    await invoke('start_forward', {
      request: {
        name: newForward.name || '转发',
        source_channel_id: newForward.sourceChannelId,
        target_channel_id: newForward.targetChannelId,
        direction: newForward.direction,
      },
    })
    message.success('转发已启动')
    showModal.value = false
    newForward.name = ''
    newForward.sourceChannelId = ''
    newForward.targetChannelId = ''
    newForward.direction = 'bidirectional'
    await refreshForwarders()
  } catch (e: any) {
    message.error(String(e))
  } finally {
    creating.value = false
  }
}

async function handleStop(id: string) {
  try {
    await invoke('stop_forward', { forwarderId: id })
    message.success('转发已停止')
    await refreshForwarders()
  } catch (e: any) {
    message.error(String(e))
  }
}

async function handleDelete(id: string) {
  try {
    await invoke('delete_forwarder', { forwarderId: id })
    message.success('已删除')
    await refreshForwarders()
  } catch (e: any) {
    message.error(String(e))
  }
}

onMounted(async () => {
  syncConnections()
  await refreshForwarders()
  pollTimer = setInterval(() => {
    syncConnections()
    refreshForwarders()
  }, 10000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>
