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
                  <a-select
                    v-model:value="form.port"
                    style="width: 360px"
                    placeholder="选择串口"
                    show-search
                    :filter-option="filterPortOption"
                  >
                    <a-select-option
                      v-for="p in ports"
                      :key="p.name"
                      :value="p.name"
                      :title="portFullLabel(p)"
                    >
                      {{ portFullLabel(p) }}
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
                    <BaudRateSelect v-model="form.baud_rate" />
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
              <a-row :gutter="12">
                <a-col :span="12">
                  <a-form-item label="字节超时断包 (ms)">
                    <a-input-number v-model:value="form.byte_timeout_ms" :min="5" :max="5000" style="width: 100%" />
                  </a-form-item>
                </a-col>
                <a-col :span="12">
                  <a-form-item label="帧超时 (ms)">
                    <a-input-number v-model:value="form.frame_timeout_ms" :min="20" :max="10000" style="width: 100%" />
                  </a-form-item>
                </a-col>
              </a-row>
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
            <a-space>
              <a-button size="small" @click="connectionStore.refreshStatus()">刷新</a-button>
              <a-button size="small" danger @click="handleDisconnectAll" :disabled="!connectionStore.hasConnection">
                全部断开
              </a-button>
            </a-space>
          </template>

          <div v-for="ch in topLevelChannels" :key="ch.channelId" class="channel-block">
            <div class="channel-row">
              <div class="channel-main">
                <a-tag v-if="ch.transportType === 'tcp_server'">TCP 服务端</a-tag>
                <a-tag v-else>{{ typeLabels[ch.transportType] || ch.transportType }}</a-tag>
                <span class="channel-id">{{ ch.channelId }}</span>
                <span class="channel-addr">{{ connectionStore.channelDisplayName(ch) }}{{ ch.alias ? ` · ${ch.portName}` : '' }}</span>
                <template v-if="ch.transportType === 'tcp_server'">
                  <a-badge status="success" />
                  <span>监听中</span>
                  <a-tag v-if="clientCount(ch) > 0" color="blue">{{ clientCount(ch) }} 客户端</a-tag>
                  <span v-else style="color: #999">等待连接...</span>
                </template>
                <template v-else>
                  <a-badge :status="ch.connected ? 'success' : 'error'" :text="ch.connected ? '已连接' : '断开'" />
                </template>
              </div>
              <a-space>
                <a-button size="small" @click="openTerminal(ch.channelId)">工作区</a-button>
                <a-button size="small" danger @click="handleDisconnect(ch.channelId)">断开</a-button>
              </a-space>
            </div>

            <!-- TCP Server 在线客户端清单 -->
            <div v-if="ch.transportType === 'tcp_server'" class="client-list">
              <div class="client-list-title">在线客户端</div>
              <div
                v-for="client in connectionStore.getServerClients(ch.channelId)"
                :key="client.channelId"
                class="client-row"
              >
                <span class="client-indent">└</span>
                <a-tag color="blue">客户端</a-tag>
                <span class="channel-id">{{ client.portName || client.channelId }}</span>
                <a-badge status="success" text="在线" />
                <a-space>
                  <a-button size="small" type="link" @click="openTerminal(client.channelId)">工作区</a-button>
                  <a-button size="small" type="link" danger @click="handleKickClient(client.channelId)">断开</a-button>
                </a-space>
              </div>
              <div
                v-if="connectionStore.getServerClients(ch.channelId).length === 0"
                class="client-row muted"
              >
                暂无客户端接入
              </div>
            </div>
          </div>

          <a-empty v-if="topLevelChannels.length === 0" description="暂无连接" />
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
import type { PortInfo } from '@/stores/connectionStore'
import { portFullLabel as formatPortFullLabel, portDisplayName } from '@/utils/portLabel'
import { errorMessage } from '@/utils/error'
import { loadAppSettings, saveChannelTimeout } from '@/utils/appSettings'
import BaudRateSelect from '@/components/BaudRateSelect.vue'

const FORM_STORAGE_KEY = 'serial-tools-conn-form'
const appDefaults = loadAppSettings()

const router = useRouter()
const connectionStore = useConnectionStore()
const connecting = ref(false)

const ports = computed(() => connectionStore.ports)
const topLevelChannels = computed(() => connectionStore.topLevelChannels)

const typeLabels: Record<string, string> = {
  serial: '串口',
  tcp_client: 'TCP 客户端',
  tcp_server: 'TCP 服务端',
}

function clientCount(ch: { channelId: string; clients?: string[] }) {
  const nested = connectionStore.getServerClients(ch.channelId).length
  return nested || ch.clients?.length || 0
}

function portFullLabel(p: PortInfo) {
  return formatPortFullLabel(p.name, p.description)
}

function filterPortOption(input: string, option: { value?: string }) {
  const q = input.trim().toLowerCase()
  if (!q) return true
  const p = ports.value.find(x => x.name === option.value)
  if (!p) return false
  const short = portDisplayName(p.description).toLowerCase()
  return (
    p.name.toLowerCase().includes(q) ||
    short.includes(q) ||
    (p.description || '').toLowerCase().includes(q)
  )
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
    byte_timeout_ms: form.byte_timeout_ms,
    frame_timeout_ms: form.frame_timeout_ms,
  }))
}

const saved = loadSavedForm()
const form = reactive({
  conn_type: saved?.conn_type || 'serial',
  port: saved?.port || '',
  baud_rate: saved?.baud_rate || appDefaults.defaultBaudRate,
  data_bits: saved?.data_bits || 8,
  stop_bits: saved?.stop_bits || 1,
  parity: saved?.parity || 'None',
  half_duplex: saved?.half_duplex || false,
  host: saved?.host || '192.168.1.100',
  bind_addr: saved?.bind_addr || '0.0.0.0',
  tcp_port: saved?.tcp_port || 5000,
  byte_timeout_ms: saved?.byte_timeout_ms || appDefaults.serialByteTimeoutMs,
  frame_timeout_ms: saved?.frame_timeout_ms || appDefaults.serialFrameTimeoutMs,
})

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
      byte_timeout_ms: form.conn_type === 'serial' ? form.byte_timeout_ms : undefined,
      frame_timeout_ms: form.conn_type === 'serial' ? form.frame_timeout_ms : undefined,
    })
    if (result.success) {
      message.success(result.message)
      if (result.channel_id) {
        if (form.conn_type === 'serial') {
          saveChannelTimeout(result.channel_id, form.byte_timeout_ms, form.frame_timeout_ms)
        }
        router.push({ name: 'workspace', params: { channelId: result.channel_id } })
      }
    }
  } catch (e: any) {
    message.error(errorMessage(e))
  } finally {
    connecting.value = false
  }
}

async function handleDisconnect(channelId: string) {
  try {
    await connectionStore.disconnect(channelId)
    message.success('已断开')
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleKickClient(channelId: string) {
  try {
    await connectionStore.disconnectClient(channelId)
    message.success('客户端已断开')
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

async function handleDisconnectAll() {
  await connectionStore.disconnectAll()
  message.success('已断开所有通道')
}

function openTerminal(channelId: string) {
  router.push({ name: 'workspace', params: { channelId } })
}

onMounted(() => {
  saveForm()
})
</script>

<style scoped>
.channel-block {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.channel-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.channel-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.channel-id {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}
.channel-addr {
  color: #888;
  font-size: 12px;
}
.client-list {
  margin-top: 8px;
  padding-left: 8px;
  border-left: 2px solid #e6f4ff;
}
.client-list-title {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
}
.client-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.client-indent {
  color: #1677ff;
  width: 16px;
}
.client-row.muted {
  color: #999;
  font-size: 12px;
}
</style>
