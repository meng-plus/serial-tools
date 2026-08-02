<template>
  <div>
    <a-card title="数据总线" :bordered="false">
      <a-alert
        type="info"
        show-icon
        message="总线模式"
        description="创建数据总线，将任意通道以不同方向接入。支持点对点转发和一对多广播。"
        style="margin-bottom: 16px"
      />

      <a-space style="margin-bottom: 16px">
        <a-button type="primary" @click="showCreateModal = true">
          创建总线
        </a-button>
        <a-button @click="refreshBuses">刷新</a-button>
      </a-space>

      <a-table
        :columns="busColumns"
        :data-source="buses"
        :pagination="false"
        size="small"
        row-key="id"
        :expand-column-width="60"
      >
        <template #expandedRowRender="{ record }">
          <div style="padding: 8px 0">
            <a-space direction="vertical" style="width: 100%">
              <div v-if="record.subscriptions.length === 0" style="color: #999">暂无订阅通道</div>
              <div v-for="sub in record.subscriptions" :key="sub.channel_id" style="display: flex; align-items: center; gap: 8px">
                <a-tag :color="sub.direction === 'rx_to_bus' ? 'green' : sub.direction === 'tx_from_bus' ? 'blue' : 'purple'">
                  {{ directionLabel(sub.direction) }}
                </a-tag>
                <span>{{ sub.channel_id }}</span>
                <a-button size="small" danger @click="handleUnsubscribe(record.id, sub.channel_id)">移除</a-button>
              </div>
            </a-space>
            <a-divider style="margin: 8px 0" />
            <a-space>
              <a-select v-model:value="newSub.channelId" placeholder="选择通道" style="width: 200px" size="small">
                <a-select-option v-for="ch in availableChannels(record)" :key="ch" :value="ch">{{ ch }}</a-select-option>
              </a-select>
              <a-select v-model:value="newSub.direction" style="width: 130px" size="small">
                <a-select-option value="rx_to_bus">RX → 总线</a-select-option>
                <a-select-option value="tx_from_bus">总线 → TX</a-select-option>
                <a-select-option value="both">双向</a-select-option>
              </a-select>
              <a-button size="small" type="primary" @click="handleSubscribe(record.id)" :disabled="!newSub.channelId">添加订阅</a-button>
            </a-space>
          </div>
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'running' ? 'success' : 'default'">
              {{ record.status === 'running' ? '运行中' : '已停止' }}
            </a-tag>
          </template>
          <template v-if="column.key === 'subs'">
            <span>{{ record.subscriptions.length }} 通道</span>
          </template>
          <template v-if="column.key === 'action'">
            <a-space>
              <a-button v-if="record.status === 'running'" size="small" danger @click="handleStop(record.id)">停止</a-button>
              <template v-else>
                <a-button size="small" type="primary" @click="handleStart(record.id)">启动</a-button>
                <a-button size="small" @click="handleDelete(record.id)">删除</a-button>
              </template>
            </a-space>
          </template>
        </template>
      </a-table>

      <a-empty v-if="buses.length === 0" description="暂无数据总线" />
    </a-card>

    <a-modal v-model:open="showCreateModal" title="创建总线" @ok="handleCreate" :confirm-loading="creating">
      <a-form layout="vertical">
        <a-form-item label="总线名称">
          <a-input v-model:value="newBusName" placeholder="例: 串口转TCP总线" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { errorMessage } from '@/utils/error'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'
import { useConnectionStore } from '@/stores'

const connectionStore = useConnectionStore()

interface BusSubInfo {
  channel_id: string
  direction: string
}

interface BusInfo {
  id: string
  name: string
  subscriptions: BusSubInfo[]
  status: string
  rx_bytes: number
  tx_bytes: number
}

const showCreateModal = ref(false)
const creating = ref(false)
const newBusName = ref('')
const buses = ref<BusInfo[]>([])

const newSub = reactive({
  channelId: '',
  direction: 'rx_to_bus',
})

const busColumns = [
  { title: '名称', dataIndex: 'name', width: 180 },
  { title: '状态', key: 'status', width: 80 },
  { title: '订阅', key: 'subs', width: 80 },
  { title: 'RX 字节', dataIndex: 'rx_bytes', width: 90 },
  { title: 'TX 字节', dataIndex: 'tx_bytes', width: 90 },
  { title: '操作', key: 'action', width: 120 },
]

let pollTimer: ReturnType<typeof setInterval> | null = null

function directionLabel(d: string): string {
  if (d === 'rx_to_bus') return 'RX → 总线'
  if (d === 'tx_from_bus') return '总线 → TX'
  if (d === 'both') return '双向'
  return d
}

function availableChannels(bus: BusInfo): string[] {
  const subscribed = new Set(bus.subscriptions.map(s => s.channel_id))
  return Array.from(connectionStore.channels.keys()).filter(id => !subscribed.has(id))
}

async function refreshBuses() {
  try {
    buses.value = await invoke<BusInfo[]>('list_buses')
  } catch { /* ignore */ }
}

async function handleCreate() {
  if (!newBusName.value) {
    message.warning('请输入总线名称')
    return
  }
  creating.value = true
  try {
    await invoke('create_bus', { request: { name: newBusName.value } })
    message.success('总线已创建')
    showCreateModal.value = false
    newBusName.value = ''
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  } finally {
    creating.value = false
  }
}

async function handleSubscribe(busId: string) {
  if (!newSub.channelId) {
    message.warning('请选择通道')
    return
  }
  try {
    await invoke('subscribe_bus', {
      request: {
        bus_id: busId,
        channel_id: newSub.channelId,
        direction: newSub.direction,
      },
    })
    message.success('订阅成功')
    newSub.channelId = ''
    newSub.direction = 'rx_to_bus'
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleUnsubscribe(busId: string, channelId: string) {
  try {
    await invoke('unsubscribe_bus', { busId, channelId })
    message.success('已取消订阅')
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleStart(busId: string) {
  try {
    await invoke('start_bus', { busId })
    message.success('总线已启动')
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleStop(busId: string) {
  try {
    await invoke('stop_bus', { busId })
    message.success('总线已停止')
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleDelete(busId: string) {
  try {
    await invoke('delete_bus', { busId })
    message.success('总线已删除')
    await refreshBuses()
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

onMounted(async () => {
  await refreshBuses()
  pollTimer = setInterval(refreshBuses, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>
