<template>
  <div class="terminal-page">
    <div class="terminal-toolbar">
      <a-space>
        <a-select v-model:value="terminalStore.activeChannelId" style="width: 280px" placeholder="全部通道" allowClear>
          <a-select-option value="">全部通道</a-select-option>
          <template v-for="ch in allChannels" :key="ch.channelId">
            <!-- TCP Server：显示服务端本身 -->
            <template v-if="ch.transportType === 'tcp_server'">
              <a-select-option :value="ch.channelId">
                🖧 {{ ch.channelId }} ({{ ch.clients?.length || 0 }} 客户端)
              </a-select-option>
            </template>
            <!-- TCP Server 客户端子通道：缩进显示 -->
            <template v-else-if="ch.transportType === 'tcp_server_client'">
              <a-select-option :value="ch.channelId">
                &nbsp;&nbsp;└ {{ ch.portName }} (客户端)
              </a-select-option>
            </template>
            <!-- 其他通道 -->
            <template v-else>
              <a-select-option :value="ch.channelId">
                {{ ch.channelId }}
              </a-select-option>
            </template>
          </template>
        </a-select>

        <a-segmented v-model:value="terminalStore.encoding" :options="[
          { label: 'UTF-8', value: 'utf-8' },
          { label: 'GBK', value: 'gbk' },
          { label: 'HEX', value: 'hex' },
        ]" size="small" />

        <a-divider type="vertical" />

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
          <span class="rx-label">RX: {{ terminalStore.rxCount }}</span>
          <a-divider type="vertical" />
          <span class="tx-label">TX: {{ terminalStore.txCount }}</span>
        </span>
      </a-space>
    </div>

    <div class="terminal-container terminal-xshell" ref="terminalRef">
      <div v-for="line in terminalStore.filteredLines" :key="line.id" class="terminal-line">
        <span v-if="terminalStore.displayConfig.showTimestamp" class="timestamp">[{{ line.timestamp }}]</span>
        <span v-if="terminalStore.displayConfig.showDirection" :class="line.direction">{{ line.direction === 'rx' ? 'RX' : 'TX' }}</span>
        <span v-if="terminalStore.displayConfig.showChannel" class="channel-tag">{{ line.channelId }}</span>
        <span class="terminal-data"> {{ terminalStore.displayText(line) }}</span>
      </div>
      <div v-if="terminalStore.filteredLines.length === 0" class="terminal-placeholder">
        等待数据...
      </div>
    </div>

    <div class="send-area">
      <a-tabs v-model:activeKey="sendMode" size="small">
        <a-tab-pane key="text" tab="文本">
          <div class="send-col">
            <a-textarea
              v-model:value="sendText"
              :placeholder="selectedChannel ? '输入文本... (Ctrl+Enter 发送)' : '请先选择通道'"
              :disabled="!selectedChannel"
              :auto-size="{ minRows: 2, maxRows: 6 }"
              @keydown="handleTextKeydown"
            />
            <div class="send-actions">
              <a-select v-model:value="sendSuffix" style="width: 100px" size="small">
                <a-select-option value="none">无后缀</a-select-option>
                <a-select-option value="cr">CR (\r)</a-select-option>
                <a-select-option value="lf">LF (\n)</a-select-option>
                <a-select-option value="crlf">CRLF (\r\n)</a-select-option>
              </a-select>
              <a-button type="primary" size="small" @click="handleSendText" :disabled="!selectedChannel || !sendText">
                发送 (Ctrl+Enter)
              </a-button>
            </div>
          </div>
        </a-tab-pane>
        <a-tab-pane key="hex" tab="HEX">
          <div class="send-col">
            <a-textarea
              v-model:value="sendHex"
              placeholder="01 03 00 00 00 02"
              :disabled="!selectedChannel"
              :auto-size="{ minRows: 2, maxRows: 4 }"
              @keydown="handleHexKeydown"
            />
            <div class="send-actions">
              <a-button type="primary" size="small" @click="handleSendHex" :disabled="!selectedChannel || !sendHex">
                发送 (Ctrl+Enter)
              </a-button>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { VerticalAlignBottomOutlined, SettingOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useConnectionStore, useTerminalStore } from '@/stores'

const route = useRoute()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()

const terminalRef = ref<HTMLElement>()
const sendMode = ref('text')
const sendText = ref('')
const sendHex = ref('')
const sendSuffix = ref('none')
const autoScroll = ref(true)

// 所有通道（按类型排序：先显示 TCP Server，紧跟其客户端，再显示其他）
const allChannels = computed(() => {
  const list = Array.from(connectionStore.channels.values())
  // 已在 connectionStore.refreshStatus 中按插入顺序排列，无需额外排序
  return list
})

const connectedChannels = computed(() => connectionStore.connectedChannels)

const selectedChannel = computed(() => {
  const queryChannel = route.query.channel as string
  if (queryChannel) return queryChannel
  if (terminalStore.activeChannelId) return terminalStore.activeChannelId
  return connectedChannels.value[0]?.channelId || ''
})

onMounted(() => {
  const queryChannel = route.query.channel as string
  if (queryChannel) {
    terminalStore.activeChannelId = queryChannel
  }
})

watch(
  () => terminalStore.filteredLines.length,
  async () => {
    if (autoScroll.value) {
      await nextTick()
      if (terminalRef.value) {
        terminalRef.value.scrollTop = terminalRef.value.scrollHeight
      }
    }
  }
)

async function handleSendText() {
  if (!selectedChannel.value || !sendText.value) return
  try {
    await terminalStore.sendText(selectedChannel.value, sendText.value, sendSuffix.value)
    // 不清空发送框，方便重复发送
  } catch (e: any) {
    message.error(String(e))
  }
}

async function handleSendHex() {
  if (!selectedChannel.value || !sendHex.value) return
  try {
    await terminalStore.sendHex(selectedChannel.value, sendHex.value)
    // 不清空发送框
  } catch (e: any) {
    message.error(String(e))
  }
}

function handleTextKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault()
    handleSendText()
  }
}

function handleHexKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault()
    handleSendHex()
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
.rx-tx-counter {
  color: #999;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
.rx-label { color: #00ff41; }
.tx-label { color: #00bcd4; }
.terminal-container {
  flex: 1;
  overflow-y: auto;
  min-height: 200px;
}
.terminal-line {
  line-height: 1.5;
}
.terminal-placeholder {
  color: #666;
  padding: 20px;
  text-align: center;
}
.channel-tag {
  color: #555;
  font-size: 11px;
  margin: 0 4px;
}
.send-area {
  margin-top: 8px;
  border-top: 1px solid #f0f0f0;
  padding-top: 8px;
}
.send-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.send-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.send-row {
  display: flex;
  gap: 8px;
}
</style>
