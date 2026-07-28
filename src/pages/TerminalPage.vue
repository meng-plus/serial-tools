<template>
  <div class="terminal-page">
    <a-card :bordered="false" style="margin-bottom: 16px">
      <a-space>
        <a-tag :color="connectionStore.connected ? 'success' : 'default'">
          {{ connectionStore.connected ? connectionStore.portName : '未连接' }}
        </a-tag>
        <a-button size="small" @click="handleClear">清屏</a-button>
        <a-button size="small" @click="handleRefresh">刷新</a-button>
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
        <span> {{ formatPacket(pkt) }}</span>
      </div>
      <div v-if="sessionStore.packets.length === 0" style="color: #666">
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
              style="flex: 1"
            />
            <a-select v-model:value="sendSuffix" style="width: 100px">
              <a-select-option value="none">无后缀</a-select-option>
              <a-select-option value="cr">CR</a-select-option>
              <a-select-option value="lf">LF</a-select-option>
              <a-select-option value="crlf">CRLF</a-select-option>
            </a-select>
            <a-button type="primary" @click="handleSendText">发送</a-button>
          </div>
        </a-tab-pane>
        <a-tab-pane key="hex" tab="HEX">
          <div class="send-input">
            <a-input
              v-model:value="sendHex"
              placeholder="HEX: 01 03 00 00 00 02"
              @press-enter="handleSendHex"
              style="flex: 1"
            />
            <a-button type="primary" @click="handleSendHex">发送</a-button>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useConnectionStore, useSessionStore } from '@/stores'
import type { Packet } from '@/stores/sessionStore'

const connectionStore = useConnectionStore()
const sessionStore = useSessionStore()

const sendMode = ref('text')
const sendText = ref('')
const sendHex = ref('')
const sendSuffix = ref('none')
const terminalRef = ref<HTMLElement>()
let pollTimer: ReturnType<typeof setInterval> | null = null

const sortedPackets = computed(() => {
  return [...sessionStore.packets].reverse()
})

const rxCount = computed(() => sessionStore.packets.filter(p => p.direction === 'rx').length)
const txCount = computed(() => sessionStore.packets.filter(p => p.direction === 'tx').length)

function formatPacket(pkt: Packet): string {
  try {
    const bytes = new Uint8Array(pkt.bytes)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return pkt.hex
  }
}

async function handleSendText() {
  if (!sendText.value) return
  await sessionStore.sendText(sendText.value, sendSuffix.value)
  sendText.value = ''
  await refreshPackets()
}

async function handleSendHex() {
  if (!sendHex.value) return
  await sessionStore.sendHex(sendHex.value)
  sendHex.value = ''
  await refreshPackets()
}

async function handleClear() {
  await sessionStore.clearPackets()
}

async function handleRefresh() {
  await refreshPackets()
}

async function refreshPackets() {
  await sessionStore.fetchPackets(500)
  await nextTick()
  if (terminalRef.value) {
    terminalRef.value.scrollTop = terminalRef.value.scrollHeight
  }
}

onMounted(async () => {
  await refreshPackets()
  pollTimer = setInterval(refreshPackets, 1000)
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

.send-area {
  margin-top: 16px;
}

.send-input {
  display: flex;
  gap: 8px;
}
</style>
