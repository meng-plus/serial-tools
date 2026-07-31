<template>
  <div class="connection-page">
    <a-row :gutter="16">
      <a-col :span="10">
        <a-card title="新建连接" :bordered="false" size="small">
          <a-form layout="vertical" :model="form">
            <a-form-item label="连接类型">
              <a-segmented v-model:value="form.conn_type" :options="[
                { label: '串口', value: 'serial' },
                { label: 'TCP 客户端', value: 'tcp_client' },
                { label: 'TCP 服务端', value: 'tcp_server' },
              ]" />
            </a-form-item>

            <template v-if="form.conn_type === 'serial'">
              <a-form-item label="串口">
                <a-space>
                  <a-select v-model:value="form.port" style="width: 260px" placeholder="选择串口" show-search>
                    <a-select-option v-for="p in ports" :key="p.name" :value="p.name">
                      {{ p.name }} — {{ p.description }}
                    </a-select-option>
                  </a-select>
                  <a-button @click="connectionStore.loadPorts()">
                    <template #icon><ReloadOutlined /></template>
                  </a-button>
                </a-space>
              </a-form-item>
              <a-row :gutter="12">
                <a-col :span="12">
                  <a-form-item label="波特率">
                    <a-select v-model:value="form.baud_rate" style="width: 100%">
                      <a-select-option v-for="b in baudRates" :key="b" :value="b">{{ b }}</a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
                <a-col :span="4">
                  <a-form-item label="数据位">
                    <a-select v-model:value="form.data_bits" style="width: 100%">
                      <a-select-option :value="7">7</a-select-option>
                      <a-select-option :value="8">8</a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
                <a-col :span="4">
                  <a-form-item label="停止位">
                    <a-select v-model:value="form.stop_bits" style="width: 100%">
                      <a-select-option :value="1">1</a-select-option>
                      <a-select-option :value="2">2</a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
                <a-col :span="4">
                  <a-form-item label="校验">
                    <a-select v-model:value="form.parity" style="width: 100%">
                      <a-select-option value="None">None</a-select-option>
                      <a-select-option value="Even">Even</a-select-option>
                      <a-select-option value="Odd">Odd</a-select-option>
                    </a-select>
                  </a-form-item>
                </a-col>
              </a-row>
              <a-form-item>
                <a-checkbox v-model:checked="form.half_duplex">RS485 半双工</a-checkbox>
              </a-form-item>
            </template>

            <template v-if="form.conn_type === 'tcp_client'">
              <a-form-item label="主机地址">
                <a-input v-model:value="form.host" placeholder="192.168.1.100" />
              </a-form-item>
              <a-form-item label="端口">
                <a-input-number v-model:value="form.tcp_port" :min="1" :max="65535" style="width: 100%" />
              </a-form-item>
            </template>

            <template v-if="form.conn_type === 'tcp_server'">
              <a-form-item label="绑定地址">
                <a-input v-model:value="form.bind_addr" placeholder="0.0.0.0" />
                <div style="color: #999; font-size: 12px; margin-top: 4px;">0.0.0.0 表示监听所有网卡</div>
              </a-form-item>
              <a-form-item label="监听端口">
                <a-input-number v-model:value="form.tcp_port" :min="1" :max="65535" style="width: 100%" />
              </a-form-item>
            </template>

            <a-button type="primary" block :loading="connecting" @click="handleConnect">
              连接
            </a-button>
          </a-form>
        </a-card>
      </a-col>

      <a-col :span="14">
        <a-card title="已连接通道" :bordered="false" size="small">
          <template #extra>
            <a-button size="small" danger @click="handleDisconnectAll" :disabled="!connectionStore.hasConnection">
              全部断开
            </a-button>
          </template>
          <a-table
            :columns="columns"
            :data-source="channelList"
            :pagination="false"
            size="small"
            row-key="channelId"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <template v-if="record.transportType === 'tcp_server'">
                  <a-badge status="success" v-if="record.connected" />
                  <span v-if="record.connected">
                    监听中
                    <template v-if="record.clients && record.clients.length > 0">
                      · <a-tag color="blue" size="small">{{ record.clients.length }} 客户端</a-tag>
                    </template>
                  </span>
                  <a-badge status="error" text="断开" v-else />
                </template>
                <template v-else-if="record.transportType === 'tcp_server_client'">
                  <a-badge status="success" text="在线" />
                </template>
                <template v-else>
                  <a-badge status="success" text="已连接" v-if="record.connected" />
                  <a-badge status="error" text="断开" v-else />
                </template>
              </template>
              <template v-if="column.key === 'clients'">
                <template v-if="record.clients && record.clients.length > 0">
                  <a-tag v-for="c in record.clients" :key="c" size="small" color="blue">{{ c }}</a-tag>
                </template>
                <span v-else-if="record.transportType === 'tcp_server'" style="color: #999">等待连接...</span>
              </template>
              <template v-if="column.key === 'action'">
                <a-space>
                  <a-button size="small" @click="openTerminal(record.channelId)">终端</a-button>
                  <a-button size="small" danger @click="connectionStore.disconnect(record.channelId)">断开</a-button>
                </a-space>
              </template>
              <template v-if="column.key === 'type'">
                <a-tag v-if="record.transportType === 'tcp_server'">TCP 服务端</a-tag>
                <a-tag v-else-if="record.transportType === 'tcp_server_client'" color="blue">客户端</a-tag>
                <a-tag v-else>{{ typeLabels[record.transportType] || record.transportType }}</a-tag>
              </template>
            </template>
          </a-table>
          <a-empty v-if="channelList.length === 0" description="暂无连接" />
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { useConnectionStore } from '@/stores'

const FORM_STORAGE_KEY = 'serial-tools-conn-form'

const router = useRouter()
const connectionStore = useConnectionStore()
const connecting = ref(false)

const ports = computed(() => connectionStore.ports)
const channelList = computed(() => Array.from(connectionStore.channels.values()))

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

const typeLabels: Record<string, string> = {
  serial: '串口',
  tcp_client: 'TCP 客户端',
  tcp_server: 'TCP 服务端',
}

function loadSavedForm() {
  try {
    const saved = localStorage.getItem(FORM_STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return null
}

function saveForm() {
  localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({
    conn_type: form.conn_type,
    port: form.port,
    baud_rate: form.baud_rate,
    data_bits: form.data_bits,
    stop_bits: form.stop_bits,
    parity: form.parity,
    half_duplex: form.half_duplex,
    host: form.host,
    bind_addr: form.bind_addr,
    tcp_port: form.tcp_port,
  }))
}

const saved = loadSavedForm()
const form = reactive({
  conn_type: saved?.conn_type || 'serial',
  port: saved?.port || '',
  baud_rate: saved?.baud_rate || 115200,
  data_bits: saved?.data_bits || 8,
  stop_bits: saved?.stop_bits || 1,
  parity: saved?.parity || 'None',
  half_duplex: saved?.half_duplex || false,
  host: saved?.host || '192.168.1.100',
  bind_addr: saved?.bind_addr || '0.0.0.0',
  tcp_port: saved?.tcp_port || 5000,
})

const columns = [
  { title: '通道 ID', dataIndex: 'channelId', width: 200 },
  { title: '类型', key: 'type', width: 100 },
  { title: '地址', dataIndex: 'portName', width: 150 },
  { title: '客户端', key: 'clients', width: 200 },
  { title: '状态', key: 'status', width: 80 },
  { title: '操作', key: 'action', width: 130 },
]

async function handleConnect() {
  connecting.value = true
  saveForm()
  try {
    const result = await connectionStore.connect({
      conn_type: form.conn_type,
      port: form.conn_type === 'serial' ? form.port : undefined,
      baud_rate: form.conn_type === 'serial' ? form.baud_rate : undefined,
      host: form.conn_type === 'tcp_client' ? form.host : (form.conn_type === 'tcp_server' ? form.bind_addr : undefined),
      tcp_port: form.conn_type !== 'serial' ? form.tcp_port : undefined,
      half_duplex: form.conn_type === 'serial' ? form.half_duplex : undefined,
    })
    if (result.success) {
      message.success(result.message)
    }
  } catch (e: any) {
    message.error(String(e))
  } finally {
    connecting.value = false
  }
}

async function handleDisconnectAll() {
  await connectionStore.disconnectAll()
  message.success('已断开所有通道')
}

function openTerminal(channelId: string) {
  router.push({ name: 'terminal', query: { channel: channelId } })
}

onMounted(() => {
  saveForm()
})
</script>
