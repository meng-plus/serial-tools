<template>
  <div ref="rootRef" class="io-log-view" :style="fontStyle" tabindex="0" @keydown="onRootKeydown">
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
        <a-button size="small" @click="handleClear">清屏</a-button>
        <a-button size="small" @click="showVars = true">变量说明</a-button>
        <span class="rx-tx-counter">
          <span class="rx-label">RX {{ terminalStore.rxCount }}</span>
          ·
          <span class="tx-label">TX {{ terminalStore.txCount }}</span>
        </span>
        <span class="hint">字号 {{ fontSize }} · Ctrl+滚轮</span>
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

    <div v-if="previewText" class="preview">预览：{{ previewText }}</div>

    <div class="send-opts">
      <a-space wrap size="small">
        <span class="opt-label">追加校验</span>
        <a-select v-model:value="checksum" style="width: 200px" size="small">
          <a-select-option v-for="c in CHECKSUM_CATALOG" :key="c.id" :value="c.id">{{ c.name }}</a-select-option>
        </a-select>
        <template v-if="checksum !== 'none'">
          <span class="opt-label">覆盖起</span>
          <a-input-number v-model:value="coverStart" :min="0" size="small" style="width: 70px" />
          <a-select v-model:value="coverEndMode" style="width: 130px" size="small">
            <a-select-option value="to_end">到末尾</a-select-option>
            <a-select-option value="exclude_tail">排除尾部N</a-select-option>
            <a-select-option value="length">指定长度</a-select-option>
          </a-select>
          <a-input-number
            v-if="coverEndMode !== 'to_end'"
            v-model:value="coverEndValue"
            :min="0"
            size="small"
            style="width: 70px"
          />
        </template>
        <span v-else class="opt-hint muted">选算法后按覆盖区间计算并追加到帧尾（仅 HEX）</span>
      </a-space>
    </div>

    <div class="send-bar">
      <a-select v-model:value="sendFormat" style="width: 110px">
        <a-select-option value="utf-8">UTF-8</a-select-option>
        <a-select-option value="gbk">GBK</a-select-option>
        <a-select-option value="hex">HEX</a-select-option>
      </a-select>
      <a-textarea
        ref="sendInputRef"
        v-model:value="sendPayload"
        class="send-input"
        :placeholder="sendFormat === 'hex' ? 'HEX，Enter 发送 / Shift+Enter 换行' : 'Enter 发送 / Shift+Enter 换行'"
        :auto-size="{ minRows: 2, maxRows: 4 }"
        @keydown="handleSendKeydown"
        @paste="onHexPaste"
      />
      <a-select v-if="sendFormat !== 'hex'" v-model:value="sendSuffix" style="width: 100px">
        <a-select-option value="none">无后缀</a-select-option>
        <a-select-option value="cr">CR</a-select-option>
        <a-select-option value="lf">LF</a-select-option>
        <a-select-option value="crlf">CRLF</a-select-option>
      </a-select>
      <a-button size="small" :disabled="!lastSent" @click="resendLast">重发</a-button>
      <a-button type="primary" :disabled="!sendPayload.trim()" @click="handleSend">发送</a-button>
    </div>

    <a-drawer v-model:open="showVars" title="变量说明" width="440" placement="right">
      <p class="hint">发送前展开。条目序号用本发送框独立计数；通道序号与定时发送共享。</p>
      <a-list :data-source="TX_VAR_CATALOG" size="small" bordered>
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title><code>{{ item.token }}</code> <a-tag size="small">{{ item.scope }}</a-tag></template>
              <template #description>
                <div>{{ item.description }}</div>
                <div class="ex">例：{{ item.hexExample }}</div>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a @click="insertToken(item.token)">插入</a>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useTerminalStore, useTxPlannerStore } from '@/stores'
import type { Encoding } from '@/stores/terminalStore'
import { formatLogLine } from '@/utils/formatLogLine'
import {
  exportTextToDisk,
  createRealtimeLogFile,
  appendRealtimeLog,
  revealPath,
} from '@/utils/diskLog'
import { CHECKSUM_CATALOG, type ChecksumAlgo } from '@/protocol/checksum'
import { TX_VAR_CATALOG } from '@/protocol/txVars'
import {
  normalizeHexInput,
  runSendPipeline,
  type CoverEndMode,
} from '@/protocol/sendPipeline'
import { useViewFontSize } from '@/composables/useViewFontSize'

const props = defineProps<{ channelId: string }>()

const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()
const txPlanner = useTxPlannerStore()

const rootRef = ref<HTMLElement | null>(null)
const terminalRef = ref<HTMLElement>()
const sendInputRef = ref()
const { fontSize, style: fontStyle } = useViewFontSize(rootRef, 13)

const sendFormat = ref<'utf-8' | 'gbk' | 'hex'>('utf-8')
const sendPayload = ref('')
const sendSuffix = ref('none')
const autoScroll = ref(true)
const lastExportPath = ref('')
const realtimeOn = ref(false)
const realtimePath = ref('')
const showVars = ref(false)
const checksum = ref<ChecksumAlgo>('none')
const coverStart = ref(0)
const coverEndMode = ref<CoverEndMode>('to_end')
const coverEndValue = ref(0)

const history = ref<string[]>([])
const historyIdx = ref(-1)
const lastSent = ref('')
const SEQ_ITEM = 'io-log-send'
let realtimeLastId = 0

const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const previewText = computed(() => {
  if (!sendPayload.value.trim()) return ''
  const needPreview =
    (sendFormat.value === 'hex' && checksum.value !== 'none') ||
    sendPayload.value.includes('{{') ||
    sendFormat.value === 'hex'
  if (!needPreview) return ''
  try {
    return runSendPipeline(pipelineInput()).preview
  } catch (e) {
    return String(e)
  }
})

function pipelineInput() {
  return {
    format: (sendFormat.value === 'hex' ? 'hex' : sendFormat.value === 'gbk' ? 'gbk' : 'text') as
      | 'hex'
      | 'gbk'
      | 'text',
    payload: sendPayload.value,
    expandCtx: {
      format: (sendFormat.value === 'hex' ? 'hex' : 'text') as 'hex' | 'text',
      itemSeq: txPlanner.getItemSeq(props.channelId, SEQ_ITEM),
      channelSeq: txPlanner.getChannelSeq(props.channelId),
    },
    checksum: sendFormat.value === 'hex' ? checksum.value : ('none' as ChecksumAlgo),
    cover: {
      start: coverStart.value,
      endMode: coverEndMode.value,
      endValue: coverEndValue.value,
    },
  }
}

watch(checksum, (v) => {
  if (v !== 'none' && sendFormat.value !== 'hex') {
    sendFormat.value = 'hex'
    message.info('追加校验需 HEX 字节流，已切换到 HEX 发送')
  }
})

const sendHint = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  if (ch?.transportType === 'tcp_server') {
    return 'TCP Server：发送将广播到全部在线客户端。'
  }
  return ''
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
  if (realtimeOn.value) void stopRealtime(true)
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
  },
)

function handleClear() {
  Modal.confirm({
    title: '清屏？',
    content: '仅清空收发日志显示，不断开连接。',
    onOk: () => terminalStore.clear(),
  })
}

function onRootKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault()
    handleClear()
  }
}

function insertToken(token: string) {
  sendPayload.value = `${sendPayload.value}${sendPayload.value && !sendPayload.value.endsWith(' ') ? ' ' : ''}${token}`
}

function onHexPaste(e: ClipboardEvent) {
  if (sendFormat.value !== 'hex') return
  const text = e.clipboardData?.getData('text')
  if (!text) return
  e.preventDefault()
  sendPayload.value = normalizeHexInput(text)
}

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
      content: `仅追加本通道新接收(RX)数据。\n路径：\n${path}`,
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
  if (notify && p) message.info(`已停止落盘：${p}`)
}

function pushHistory(s: string) {
  history.value = [s, ...history.value.filter(x => x !== s)].slice(0, 20)
  historyIdx.value = -1
}

async function handleSend() {
  if (!sendPayload.value.trim()) return
  try {
    const raw = sendPayload.value
    if (checksum.value !== 'none' && sendFormat.value !== 'hex') {
      sendFormat.value = 'hex'
      message.warning('追加校验需 HEX 发送，已切换格式，请确认内容为十六进制后再次发送')
      return
    }
    const r = runSendPipeline(pipelineInput())
    if (sendFormat.value === 'hex') {
      await terminalStore.sendHex(props.channelId, r.wire)
    } else {
      await terminalStore.sendText(
        props.channelId,
        r.wire,
        sendSuffix.value,
        sendFormat.value as Encoding,
      )
    }
    txPlanner.bumpSeqs(props.channelId, SEQ_ITEM, r.usedItemSeq, r.usedChannelSeq)
    pushHistory(raw)
    lastSent.value = raw
  } catch (e: unknown) {
    message.error(String(e))
  }
}

function resendLast() {
  if (!lastSent.value) return
  sendPayload.value = lastSent.value
  void handleSend()
}

function handleSendKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    void handleSend()
    return
  }
  if (e.ctrlKey && e.key === 'ArrowUp') {
    e.preventDefault()
    resendLast()
    return
  }
  if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey) {
    const el = e.target as HTMLTextAreaElement
    if (el.selectionStart === 0 && el.selectionEnd === 0 && history.value.length) {
      e.preventDefault()
      const next = historyIdx.value < 0 ? 0 : Math.min(history.value.length - 1, historyIdx.value + 1)
      historyIdx.value = next
      sendPayload.value = history.value[next]
    }
  }
  if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && historyIdx.value >= 0) {
    e.preventDefault()
    if (historyIdx.value <= 0) {
      historyIdx.value = -1
      sendPayload.value = ''
    } else {
      historyIdx.value -= 1
      sendPayload.value = history.value[historyIdx.value]
    }
  }
}
</script>

<style scoped>
.io-log-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
  outline: none;
}
.toolbar { padding-bottom: 8px; border-bottom: 1px solid #f0f0f0; margin-bottom: 8px; }
.hint { color: rgba(0,0,0,0.45); font-size: 0.92em; }
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
.preview {
  font-size: 0.85em;
  color: rgba(0,0,0,0.45);
  font-family: ui-monospace, monospace;
  margin: 4px 0;
  word-break: break-all;
}
.send-opts {
  margin-bottom: 6px;
  padding: 6px 8px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}
.opt-label { font-size: 0.92em; color: rgba(0,0,0,0.65); font-weight: 500; }
.opt-hint { font-size: 0.85em; color: #d46b08; }
.opt-hint.muted { color: rgba(0,0,0,0.45); }
.rx-tx-counter { color: #999; font-size: 0.92em; font-family: ui-monospace, monospace; }
.rx-label { color: #389e0d; }
.tx-label { color: #0958d9; }
.log-container { flex: 1; overflow-y: auto; min-height: 160px; font-family: ui-monospace, monospace; }
.log-line { line-height: 1.5; }
.timestamp { color: #8c8c8c; margin-right: 4px; }
.rx { color: #389e0d; margin-right: 4px; }
.tx { color: #0958d9; margin-right: 4px; }
/* 用 em 跟随 Ctrl+滚轮 根字号，避免通道名固定 11px */
.channel-tag { color: #555; font-size: 0.92em; margin-right: 4px; }
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
.ex { margin-top: 4px; font-size: 12px; }
</style>
