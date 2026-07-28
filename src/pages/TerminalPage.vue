<template>
  <div class="terminal-page">
    <a-card :bordered="false" style="margin-bottom: 16px">
      <a-space>
        <a-select v-model:value="selectedChannel" style="width: 200px" placeholder="选择通道">
          <a-select-option v-for="c in connections" :key="c.channel_id" :value="c.channel_id">
            {{ c.channel_id }} ({{ c.transport_type }})
          </a-select-option>
        </a-select>
        <a-tag :color="connections.length > 0 ? 'success' : 'default'">
          {{ connections.length }} 个连接
        </a-tag>
        <a-button size="small" @click="refreshAll">刷新</a-button>
        <a-button size="small" @click="handleClear">清屏</a-button>
        <span style="margin-left: auto; color: #999; font-size: 12px">
          RX: {{ rxCount }} | TX: {{ txCount }}
        </span>
      </a-space>
    </a-card>

    <div class="terminal-container terminal-xshell" ref="terminalRef">
      <div v-for="(pkt, idx) in sortedPackets" :key="idx">
        <span class="timestamp">[{{ pkt.timestamp }}]</span>
        <span :class="pkt.direction === 'rx' ? 'rx' : 'tx'">
          {{ pkt.direction === 'rx' ? 'RX' : 'TX' }}
        </span>
        <span class="channel-tag">{{ pkt.channel_id }}</span>
        <span> {{ formatPacket(pkt) }}</span>
      </div>
      <div v-if="packets.length === 0" style="color: #666">
        等待数据...
      </div>
    </div>

    <div class="send-area">
      <a-tabs v-model:activeKey="sendMode" size="small">
        <a-tab-pane key="text" tab="文本">
          <div class="send-input">
            <a-input
              v-model:value="sendText"
              placeholder="输入文本..."
              @press-enter="handleSendText"
              :disabled="!selectedChannel"
              style="flex: 1"
            />
            <a-select v-model:value="sendSuffix" style="width: 100px">
              <a-select-option value="none">无后缀</a-select-option>
              <a-select-option value="cr">CR</a-select-option>
              <a-select-option value="lf">LF</a-select-option>
              <a-select-option value="crlf">CRLF</a-select-option>
            </a-select>
            <a-button type="primary" @click="handleSendText" :disabled="!selectedChannel">发送</a-button>
          </div>
        </a-tab-pane>
        <a-tab-pane key="hex" tab="HEX">
          <div class="send-input">
            <a-input
              v-model:value="sendHex"
              placeholder="01 03 00 00 00 02"
              @press-enter="handleSendHex"
              :disabled="!selectedChannel"
              style="flex: 1"
            />
            <a-button type="primary" @click="handleSendHex" :disabled="!selectedChannel">发送</a-button>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { message } from 'ant-design-vue'
import { invoke } from '@/api'

interface Packet {
  timestamp: string
  direction: string
  channel_id: string
  bytes: number[]
  hex: string
  text: string
}

interface ConnectionStatus {
  connected: boolean
  channel_id: string
  transport_type: string
  port_name: string
}

const selectedChannel = ref('')
const connections = ref<ConnectionStatus[]>([])
const packets = ref<Packet[]>([])
const sendMode = ref('text')
const sendText = ref('')
const sendHex = ref('')
const sendSuffix = ref('none')
const terminalRef = ref<HTMLElement>()
let pollTimer: ReturnType<typeof setInterval> | null = null

const sortedPackets = computed(() => [...packets.value].reverse())
const rxCount = computed(() => packets.value.filter(p => p.direction === 'rx').length)
const txCount = computed(() => packets.value.filter(p => p.direction === 'tx').length)

function formatPacket(pkt: Packet): string {
  try {
    const bytes = new Uint8Array(pkt.bytes)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return pkt.hex
  }
}

async function refreshAll() {
  try {
    connections.value = await invoke<ConnectionStatus[]>('get_connection_status')
    if (!selectedChannel.value && connections.value.length > 0) {
      selectedChannel.value = connections.value[0].channel_id
    }
  } catch (e) { /* ignore */ }
  await refreshPackets()
}

async function refreshPackets() {
  try {
    const result = await invoke<{ packets: Packet[]; total: number }>('get_packets', { limit: 500 })
    packets.value = result.packets
    await nextTick()
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight
    }
  } catch (e) { /* ignore */ }
}

async function handleSendText() {
  if (!selectedChannel.value || !sendText.value) return
  try {
    await invoke('send_data', {
      request: {
        channel_id: selectedChannel.value,
        data: sendText.value,
        format: 'text',
        suffix: sendSuffix.value,
      },
    })
    sendText.value = ''
    await refreshPackets()
  } catch (e: any) {
    message.error(String(e))
  }
}

async function handleSendHex() {
  if (!selectedChannel.value || !sendHex.value) return
  try {
    await invoke('send_data', {
      request: {
        channel_id: selectedChannel.value,
        data: sendHex.value,
        format: 'hex',
        suffix: 'none',
      },
    })
    sendHex.value = ''
    await refreshPackets()
  } catch (e: any) {
    message.error(String(e))
  }
}

async function handleClear() {
  await invoke('clear_packets')
  packets.value = []
}

onMounted(async () => {
  await refreshAll()
  pollTimer = setInterval(refreshAll, 1000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 180px);
}
.terminal-container {
  flex: 1;
  overflow-y: auto;
  min-height: 300px;
}
.send-area { margin-top: 16px; }
.send-input { display: flex; gap: 8px; }
.channel-tag { color: #999; font-size: 11px; margin: 0 4px; }
</style>
