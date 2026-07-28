<template>
  <div>
    <a-card title="通信连接" :bordered="false">
      <a-form layout="vertical">
        <a-form-item label="连接类型">
          <a-radio-group v-model:value="form.conn_type">
            <a-radio-button value="serial">串口 (UART/RS485)</a-radio-button>
            <a-radio-button value="tcp_client">TCP 客户端</a-radio-button>
          </a-radio-group>
        </a-form-item>

        <template v-if="form.conn_type === 'serial'">
          <a-form-item label="串口">
            <a-select v-model:value="form.port" style="width: 300px" placeholder="选择串口">
              <a-select-option v-for="p in ports" :key="p.name" :value="p.name">
                {{ p.name }} — {{ p.description }}
              </a-select-option>
            </a-select>
            <a-button style="margin-left: 8px" @click="loadPorts">刷新</a-button>
          </a-form-item>
          <a-form-item label="波特率">
            <a-select v-model:value="form.baud_rate" style="width: 200px">
              <a-select-option :value="9600">9600</a-select-option>
              <a-select-option :value="19200">19200</a-select-option>
              <a-select-option :value="38400">38400</a-select-option>
              <a-select-option :value="57600">57600</a-select-option>
              <a-select-option :value="115200">115200</a-select-option>
              <a-select-option :value="230400">230400</a-select-option>
              <a-select-option :value="460800">460800</a-select-option>
              <a-select-option :value="921600">921600</a-select-option>
            </a-select>
          </a-form-item>
        </template>

        <template v-if="form.conn_type === 'tcp_client'">
          <a-form-item label="主机地址">
            <a-input v-model:value="form.host" style="width: 300px" placeholder="192.168.1.100" />
          </a-form-item>
          <a-form-item label="端口">
            <a-input-number v-model:value="form.tcp_port" :min="1" :max="65535" style="width: 200px" />
          </a-form-item>
        </template>
      </a-form>

      <a-button type="primary" :loading="connecting" @click="handleConnect" :disabled="connected">
        连接
      </a-button>
    </a-card>

    <!-- 已连接的通道列表 -->
    <a-card title="已连接通道" :bordered="false" style="margin-top: 16px">
      <a-table
        :columns="columns"
        :data-source="connections"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.connected ? 'success' : 'error'">
              {{ record.connected ? '已连接' : '断开' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'action'">
            <a-button size="small" danger @click="handleDisconnect(record.channel_id)">
              断开
            </a-button>
          </template>
        </template>
      </a-table>
      <a-empty v-if="connections.length === 0" description="暂无连接" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'

interface PortInfo {
  name: string
  description: string
}

interface ConnectionStatus {
  connected: boolean
  channel_id: string
  transport_type: string
  port_name: string
}

const connecting = ref(false)
const connected = ref(false)
const ports = ref<PortInfo[]>([])
const connections = ref<ConnectionStatus[]>([])

const form = reactive({
  conn_type: 'serial',
  port: '',
  baud_rate: 115200,
  host: '192.168.1.100',
  tcp_port: 5000,
})

const columns = [
  { title: '通道 ID', dataIndex: 'channel_id' },
  { title: '类型', dataIndex: 'transport_type' },
  { title: '地址', dataIndex: 'port_name' },
  { title: '状态', key: 'status' },
  { title: '操作', key: 'action' },
]

let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadPorts() {
  try {
    ports.value = await invoke<PortInfo[]>('list_ports')
  } catch (e) {
    console.error('加载串口列表失败:', e)
  }
}

async function refreshConnections() {
  try {
    connections.value = await invoke<ConnectionStatus[]>('get_connection_status')
    connected.value = connections.value.some(c => c.connected)
  } catch (e) {
    console.error('刷新连接状态失败:', e)
  }
}

async function handleConnect() {
  connecting.value = true
  try {
    const result = await invoke<{ success: boolean; message: string; channel_id: string }>(
      'connect',
      { request: form }
    )
    if (result.success) {
      message.success(result.message)
      await refreshConnections()
    }
  } catch (e: any) {
    message.error(String(e))
  } finally {
    connecting.value = false
  }
}

async function handleDisconnect(channelId: string) {
  try {
    await invoke('disconnect', { channelId })
    message.success('已断开')
    await refreshConnections()
  } catch (e: any) {
    message.error(String(e))
  }
}

onMounted(async () => {
  await loadPorts()
  await refreshConnections()
  pollTimer = setInterval(refreshConnections, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>
