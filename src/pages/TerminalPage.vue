<template>
  <div class="terminal-page">
    <div class="terminal-toolbar">
      <a-space wrap>
        <a-select
          v-model:value="terminalStore.activeChannelId"
          style="width: 300px"
          placeholder="全部通道"
          allowClear
          @change="onChannelChange"
        >
          <a-select-option value="">全部通道</a-select-option>
          <template v-for="ch in allChannels" :key="ch.channelId">
            <a-select-option v-if="ch.transportType === 'tcp_server'" :value="ch.channelId">
              Server {{ ch.portName }}（广播）
            </a-select-option>
            <a-select-option v-else-if="ch.transportType === 'tcp_server_client'" :value="ch.channelId">
              └ Client {{ ch.portName }}
            </a-select-option>
            <a-select-option v-else :value="ch.channelId">
              {{ ch.portName || ch.channelId }}
            </a-select-option>
          </template>
        </a-select>

        <a-select v-model:value="terminalStore.encoding" style="width: 120px" size="middle">
          <a-select-option value="utf-8">显示 UTF-8</a-select-option>
          <a-select-option value="gbk">显示 GBK</a-select-option>
          <a-select-option value="hex">显示 HEX</a-select-option>
        </a-select>

        <a-tooltip title="自动滚动">
          <a-button :type="autoScroll ? 'primary' : 'default'" size="small" @click="autoScroll = !autoScroll">
            <template #icon><VerticalAlignBottomOutlined /></template>
          </a-button>
        </a-tooltip>

        <a-dropdown :trigger="['click']">
          <a-button size="small">
            <template #icon><SettingOutlined /></template>
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showTimestamp">时间戳</a-checkbox>
              </a-menu-item>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showDirection">收发标记</a-checkbox>
              </a-menu-item>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showChannel">通道标记</a-checkbox>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>

        <a-button size="small" @click="terminalStore.clear()">清屏</a-button>

        <span class="rx-tx-counter">
          <span class="rx-label">RX {{ terminalStore.rxCount }}</span>
          ·
          <span class="tx-label">TX {{ terminalStore.txCount }}</span>
        </span>
      </a-space>
    </div>

    <div v-if="sendHint" class="send-hint">{{ sendHint }}</div>

    <div class="terminal-container terminal-xshell" ref="terminalRef">
      <div v-for="line in terminalStore.filteredLines" :key="line.id" class="terminal-line">
        <span v-if="terminalStore.displayConfig.showTimestamp" class="timestamp">[{{ line.timestamp }}]</span>
        <span v-if="terminalStore.displayConfig.showDirection" :class="line.direction">{{ line.direction === 'rx' ? 'RX' : 'TX' }}</span>
        <span v-if="terminalStore.displayConfig.showChannel" class="channel-tag">{{ line.channelId }}</span>
        <span class="terminal-data"> {{ terminalStore.displayText(line) }}</span>
      </div>
      <div v-if="terminalStore.filteredLines.length === 0" class="terminal-placeholder">等待数据...</div>
    </div>

    <!-- 单一发送栏：模式 + 输入 + 后缀 + 发送 -->
    <div class="send-bar">
      <a-select v-model:value="sendFormat" style="width: 110px" :disabled="!selectedChannel">
        <a-select-option value="utf-8">UTF-8</a-select-option>
        <a-select-option value="gbk">GBK</a-select-option>
        <a-select-option value="hex">HEX</a-select-option>
      </a-select>

      <a-textarea
        v-model:value="sendPayload"
        class="send-input"
        :placeholder="sendPlaceholder"
        :disabled="!selectedChannel"
        :auto-size="{ minRows: 2, maxRows: 5 }"
        @keydown="handleSendKeydown"
      />

      <a-select
        v-if="sendFormat !== 'hex'"
        v-model:value="sendSuffix"
        style="width: 110px"
        :disabled="!selectedChannel"
      >
        <a-select-option value="none">无后缀</a-select-option>
        <a-select-option value="cr">CR</a-select-option>
        <a-select-option value="lf">LF</a-select-option>
        <a-select-option value="crlf">CRLF</a-select-option>
      </a-select>

      <a-button
        type="primary"
        :disabled="!selectedChannel || !sendPayload.trim()"
        @click="handleSend"
      >
        发送
      </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { errorMessage } from '@/utils/error'
import { useRoute, useRouter } from 'vue-router'
import { VerticalAlignBottomOutlined, SettingOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useConnectionStore, useTerminalStore } from '@/stores'
import type { Encoding } from '@/stores/terminalStore'

const route = useRoute()
const router = useRouter()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()

const terminalRef = ref<HTMLElement>()
const sendFormat = ref<'utf-8' | 'gbk' | 'hex'>('utf-8')
const sendPayload = ref('')
const sendSuffix = ref('none')
const autoScroll = ref(true)

const allChannels = computed(() => connectionStore.channelList)
const connectedChannels = computed(() => connectionStore.connectedChannels)

const selectedChannel = computed(() => {
  if (terminalStore.activeChannelId) return terminalStore.activeChannelId
  return connectedChannels.value[0]?.channelId || ''
})

const sendPlaceholder = computed(() => {
  if (!selectedChannel.value) return '请先选择通道'
  if (sendFormat.value === 'hex') return '例: 01 03 00 00 00 02   (Ctrl+Enter 发送)'
  return '输入要发送的内容   (Ctrl+Enter 发送)'
})

const sendHint = computed(() => {
  const id = selectedChannel.value
  if (!id) return ''
  const ch = connectionStore.channelList.find(c => c.channelId === id)
  if (ch?.transportType === 'tcp_server') {
    return '当前为 TCP Server：发送将广播到全部在线客户端。单客户端请选择 └ Client 通道。'
  }
  if (ch?.transportType === 'tcp_server_client') {
    return `单客户端：${ch.portName || id}`
  }
  return ''
})

onMounted(() => {
  const queryChannel = route.query.channel as string
  if (queryChannel) terminalStore.activeChannelId = queryChannel
})

function onChannelChange() {
  const id = terminalStore.activeChannelId || undefined
  router.replace({ name: 'terminal', query: id ? { channel: id } : {} })
}

watch(
  () => terminalStore.filteredLines.length,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight
    }
  }
)

async function handleSend() {
  if (!selectedChannel.value || !sendPayload.value.trim()) return
  try {
    if (sendFormat.value === 'hex') {
      await terminalStore.sendHex(selectedChannel.value, sendPayload.value)
    } else {
      await terminalStore.sendText(
        selectedChannel.value,
        sendPayload.value,
        sendSuffix.value,
        sendFormat.value as Encoding
      )
    }
  } catch (e: any) {
    message.error(errorMessage(e))
  }
}

function handleSendKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault()
    void handleSend()
  }
}
</script>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 180px);
}
.terminal-toolbar {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 8px;
}
.send-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 6px;
}
.rx-tx-counter {
  color: #999;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
.rx-label { color: #389e0d; }
.tx-label { color: #0958d9; }
.terminal-container {
  flex: 1;
  overflow-y: auto;
  min-height: 200px;
}
.terminal-line { line-height: 1.5; }
.terminal-placeholder {
  color: #666;
  padding: 20px;
  text-align: center;
}
.channel-tag {
  color: #555;
  font-size: 0.92em;
  margin: 0 4px;
}
.send-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.send-input {
  flex: 1;
  min-width: 0;
}
</style>
