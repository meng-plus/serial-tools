<template>
  <div class="io-log-view">
    <div class="toolbar">
      <a-space wrap>
        <a-select v-model:value="terminalStore.encoding" style="width: 120px" size="small">
          <a-select-option value="utf-8">显示 UTF-8</a-select-option>
          <a-select-option value="gbk">显示 GBK</a-select-option>
          <a-select-option value="hex">显示 HEX</a-select-option>
        </a-select>

        <a-dropdown :trigger="['click']">
          <a-button size="small">显示/落盘字段</a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showTimestamp">时间戳</a-checkbox>
              </a-menu-item>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showDirection">收发标记</a-checkbox>
              </a-menu-item>
              <a-menu-item>
                <a-checkbox v-model:checked="terminalStore.displayConfig.showChannel">通道来源</a-checkbox>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>

        <a-button :type="autoScroll ? 'primary' : 'default'" size="small" @click="autoScroll = !autoScroll">
          自动滚动
        </a-button>
        <a-button size="small" @click="handleExport">导出</a-button>
        <a-button
          size="small"
          :type="realtimeOn ? 'primary' : 'default'"
          :danger="realtimeOn"
          @click="toggleRealtime"
        >
          {{ realtimeOn ? '停止落盘' : '接收实时落盘' }}
        </a-button>
        <a-button size="small" @click="terminalStore.clear()">清屏</a-button>
        <span class="rx-tx-counter">
          <span class="rx-label">RX {{ terminalStore.rxCount }}</span>
          ·
          <span class="tx-label">TX {{ terminalStore.txCount }}</span>
        </span>
      </a-space>
    </div>

    <div v-if="lastExportPath" class="path-bar">
      <span class="path-label">最近导出：</span>
      <code class="path-text">{{ lastExportPath }}</code>
      <a-button type="link" size="small" @click="reveal(lastExportPath)">打开目录</a-button>
    </div>
    <div v-if="realtimePath" class="path-bar live">
      <span class="path-label">实时落盘中（仅 RX）：</span>
      <code class="path-text">{{ realtimePath }}</code>
      <a-button type="link" size="small" @click="reveal(realtimePath)">打开目录</a-button>
    </div>

    <div v-if="sendHint" class="send-hint">{{ sendHint }}</div>

    <div class="log-container" ref="terminalRef">
      <div v-for="line in terminalStore.filteredLines" :key="line.id" class="log-line">
        <span v-if="terminalStore.displayConfig.showTimestamp" class="timestamp">[{{ line.timestamp }}]</span>
        <span v-if="terminalStore.displayConfig.showDirection" :class="line.direction">{{ line.direction === 'rx' ? 'RX' : 'TX' }}</span>
        <span v-if="terminalStore.displayConfig.showChannel" class="channel-tag">{{ line.channelId }}</span>
        <span class="log-data"> {{ terminalStore.displayText(line) }}</span>
      </div>
      <div v-if="terminalStore.filteredLines.length === 0" class="log-placeholder">等待数据...</div>
    </div>

    <div class="send-bar">
      <a-select v-model:value="sendFormat" style="width: 110px">
        <a-select-option value="utf-8">UTF-8</a-select-option>
        <a-select-option value="gbk">GBK</a-select-option>
        <a-select-option value="hex">HEX</a-select-option>
      </a-select>
      <a-textarea
        v-model:value="sendPayload"
        class="send-input"
        :placeholder="sendFormat === 'hex' ? '例: 01 03 … (Ctrl+Enter)' : '发送内容 (Ctrl+Enter)'"
        :auto-size="{ minRows: 2, maxRows: 4 }"
        @keydown="handleSendKeydown"
      />
      <a-select v-if="sendFormat !== 'hex'" v-model:value="sendSuffix" style="width: 100px">
        <a-select-option value="none">无后缀</a-select-option>
        <a-select-option value="cr">CR</a-select-option>
        <a-select-option value="lf">LF</a-select-option>
        <a-select-option value="crlf">CRLF</a-select-option>
      </a-select>
      <a-button type="primary" :disabled="!sendPayload.trim()" @click="handleSend">发送</a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useTerminalStore } from '@/stores'
import type { Encoding } from '@/stores/terminalStore'
import { formatLogLine } from '@/utils/formatLogLine'
import {
  exportTextToDisk,
  createRealtimeLogFile,
  appendRealtimeLog,
  revealPath,
} from '@/utils/diskLog'

const props = defineProps<{ channelId: string }>()

const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()
const terminalRef = ref<HTMLElement>()
const sendFormat = ref<'utf-8' | 'gbk' | 'hex'>('utf-8')
const sendPayload = ref('')
const sendSuffix = ref('none')
const autoScroll = ref(true)
const lastExportPath = ref('')
const realtimeOn = ref(false)
const realtimePath = ref('')
let realtimeLastId = 0

const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

onMounted(() => {
  terminalStore.activeChannelId = props.channelId
})

onUnmounted(() => {
  realtimeOn.value = false
  realtimePath.value = ''
})

watch(() => props.channelId, (id) => {
  terminalStore.activeChannelId = id
  if (realtimeOn.value) {
    void stopRealtime(true)
  }
})

const sendHint = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  if (ch?.transportType === 'tcp_server') {
    return 'TCP Server：发送将广播到全部在线客户端。'
  }
  return ''
})

watch(
  () => terminalStore.filteredLines.length,
  async () => {
    if (realtimeOn.value && realtimePath.value) {
      const lines = terminalStore.filteredLines
      for (const line of lines) {
        if (line.id <= realtimeLastId) continue
        realtimeLastId = Math.max(realtimeLastId, line.id)
        if (line.direction !== 'rx') continue
        const text = formatLogLine(
          line,
          terminalStore.displayText(line),
          terminalStore.displayConfig,
        )
        try {
          await appendRealtimeLog(realtimePath.value, text)
        } catch (e) {
          console.warn(e)
          message.error('实时落盘写入失败，已停止')
          await stopRealtime(false)
          break
        }
      }
    }
    if (!autoScroll.value) return
    await nextTick()
    if (terminalRef.value) terminalRef.value.scrollTop = terminalRef.value.scrollHeight
  }
)

async function reveal(path: string) {
  try {
    await revealPath(path)
  } catch (e: unknown) {
    message.error(String(e))
  }
}

async function handleExport() {
  const lines = terminalStore.filteredLines
  if (lines.length === 0) {
    message.warning('当前无可导出数据')
    return
  }
  const cfg = terminalStore.displayConfig
  const text = lines
    .map(line => formatLogLine(line, terminalStore.displayText(line), cfg))
    .join('\n')

  try {
    const { path, via } = await exportTextToDisk({
      feature: '收发日志',
      channelId: props.channelId,
      channelLabel: channelLabel.value,
      ext: 'txt',
      content: text + '\n',
    })
    lastExportPath.value = path
    if (via === 'appdir') {
      Modal.success({
        title: '导出完成',
        content: `文件已保存到：\n${path}`,
        okText: '打开目录',
        onOk: () => reveal(path),
      })
    } else {
      message.success(`已触发下载：${path}`)
    }
  } catch (e: unknown) {
    message.error(String(e))
  }
}

async function toggleRealtime() {
  if (realtimeOn.value) {
    await stopRealtime(true)
    return
  }
  try {
    const cfg = terminalStore.displayConfig
    const header =
      `# serial-tools 接收实时落盘\n` +
      `# channel=${props.channelId}\n` +
      `# fields: timestamp=${cfg.showTimestamp} direction=${cfg.showDirection} channel=${cfg.showChannel}\n` +
      `# started=${new Date().toISOString()}\n\n`
    const path = await createRealtimeLogFile({
      feature: '接收实时',
      channelId: props.channelId,
      channelLabel: channelLabel.value,
      header,
    })
    realtimePath.value = path
    realtimeOn.value = true
    realtimeLastId = terminalStore.filteredLines.reduce((m, l) => Math.max(m, l.id), 0)
    Modal.success({
      title: '已开始实时落盘',
      content: `仅追加本通道新接收(RX)数据。\n路径：\n${path}\n\n落盘字段跟随「显示/落盘字段」开关。`,
      okText: '打开目录',
      onOk: () => reveal(path),
    })
  } catch (e: unknown) {
    message.error(String(e))
  }
}

async function stopRealtime(notify: boolean) {
  realtimeOn.value = false
  const p = realtimePath.value
  realtimePath.value = ''
  if (notify && p) {
    message.info(`已停止落盘：${p}`)
  }
}

async function handleSend() {
  if (!sendPayload.value.trim()) return
  try {
    if (sendFormat.value === 'hex') {
      await terminalStore.sendHex(props.channelId, sendPayload.value)
    } else {
      await terminalStore.sendText(
        props.channelId,
        sendPayload.value,
        sendSuffix.value,
        sendFormat.value as Encoding
      )
    }
  } catch (e: unknown) {
    message.error(String(e))
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
.io-log-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
}
.toolbar { padding-bottom: 8px; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px; }
.path-bar {
  font-size: 12px;
  color: rgba(0,0,0,0.65);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.path-bar.live { color: #389e0d; }
.path-label { flex-shrink: 0; }
.path-text {
  font-size: 11px;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
}
.send-hint { font-size: 12px; color: #8c8c8c; margin-bottom: 6px; }
.rx-tx-counter { color: #999; font-size: 12px; font-family: ui-monospace, monospace; }
.rx-label { color: #389e0d; }
.tx-label { color: #0958d9; }
.log-container { flex: 1; overflow-y: auto; min-height: 160px; font-family: ui-monospace, monospace; font-size: 13px; }
.log-line { line-height: 1.5; }
.timestamp { color: #8c8c8c; margin-right: 4px; }
.rx { color: #389e0d; margin-right: 4px; }
.tx { color: #0958d9; margin-right: 4px; }
.channel-tag { color: #555; font-size: 11px; margin-right: 4px; }
.log-placeholder { color: #666; padding: 24px; text-align: center; }
.send-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.send-input { flex: 1; min-width: 0; }
</style>
