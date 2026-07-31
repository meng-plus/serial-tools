<template>
  <div class="chat-view">
    <div class="toolbar">
      <a-space>
        <a-button size="small" :type="autoScroll ? 'primary' : 'default'" @click="autoScroll = !autoScroll">
          自动滚动
        </a-button>
        <a-button size="small" @click="clearLocal">清屏（仅本视图）</a-button>
        <span class="hint">一行收发 = 一个气泡；不清空全局日志</span>
      </a-space>
    </div>

    <div ref="listRef" class="bubble-list">
      <div
        v-for="m in messages"
        :key="m.key"
        class="row"
        :class="m.direction"
      >
        <div class="bubble">
          <div class="meta">
            <span class="dir">{{ m.direction === 'rx' ? '收' : '发' }}</span>
            <span class="time">{{ m.timestamp }}</span>
          </div>
          <pre class="body">{{ m.body }}</pre>
        </div>
      </div>
      <a-empty v-if="messages.length === 0" description="暂无消息" />
    </div>

    <div class="send-bar">
      <a-select v-model:value="sendFormat" style="width: 100px" size="small">
        <a-select-option value="utf-8">UTF-8</a-select-option>
        <a-select-option value="gbk">GBK</a-select-option>
        <a-select-option value="hex">HEX</a-select-option>
      </a-select>
      <a-select
        v-model:value="suffix"
        style="width: 90px"
        size="small"
        :disabled="sendFormat === 'hex'"
      >
        <a-select-option value="none">无后缀</a-select-option>
        <a-select-option value="cr">CR</a-select-option>
        <a-select-option value="lf">LF</a-select-option>
        <a-select-option value="crlf">CRLF</a-select-option>
      </a-select>
      <a-input
        v-model:value="payload"
        size="small"
        class="send-input"
        :placeholder="sendFormat === 'hex' ? '01 03 00 00' : '输入消息，Enter 发送'"
        @pressEnter="handleSend"
      />
      <a-button type="primary" size="small" :loading="sending" @click="handleSend">发送</a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { useRxHub, useTerminalStore } from '@/stores'
import type { RxRecord } from '@/protocol/types'

const props = defineProps<{ channelId: string }>()
const hub = useRxHub()
const terminalStore = useTerminalStore()

interface ChatMsg {
  key: string
  direction: 'rx' | 'tx'
  timestamp: string
  body: string
}

const messages = ref<ChatMsg[]>([])
const autoScroll = ref(true)
const listRef = ref<HTMLElement | null>(null)
const sendFormat = ref<'utf-8' | 'gbk' | 'hex'>('utf-8')
const suffix = ref('crlf')
const payload = ref('')
const sending = ref(false)

let unsub: (() => void) | null = null
let seq = 0

function recordKey(r: RxRecord) {
  return r.seq != null && r.seq > 0
    ? `seq:${r.seq}`
    : `c:${r.direction}|${r.timestamp}|${r.hex}|${++seq}`
}

function bodyOf(r: RxRecord): string {
  if (r.text && r.text.length) return r.text
  return r.hex || ''
}

function append(r: RxRecord) {
  if (r.channelId !== props.channelId) return
  messages.value.push({
    key: recordKey(r),
    direction: r.direction,
    timestamp: r.timestamp,
    body: bodyOf(r),
  })
  if (messages.value.length > 2000) {
    messages.value.splice(0, messages.value.length - 2000)
  }
  scrollIfNeeded()
}

function seed() {
  messages.value = []
  for (const r of hub.recordsForChannel(props.channelId)) {
    append(r)
  }
}

function clearLocal() {
  messages.value = []
}

async function scrollIfNeeded() {
  if (!autoScroll.value) return
  await nextTick()
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function handleSend() {
  const text = payload.value
  if (!text.trim() && sendFormat.value !== 'hex') {
    message.warning('请输入内容')
    return
  }
  sending.value = true
  try {
    if (sendFormat.value === 'hex') {
      await terminalStore.sendHex(props.channelId, text)
    } else {
      await terminalStore.sendText(
        props.channelId,
        text,
        suffix.value,
        sendFormat.value === 'gbk' ? 'gbk' : 'utf-8',
      )
    }
    payload.value = ''
  } catch (e: unknown) {
    message.error(String(e))
  } finally {
    sending.value = false
  }
}

watch(
  () => props.channelId,
  () => {
    seed()
  },
)

onMounted(async () => {
  await hub.init()
  await terminalStore.init()
  seed()
  unsub = hub.subscribe(append)
})

onUnmounted(() => {
  unsub?.()
  unsub = null
})
</script>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}
.toolbar .hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
.bubble-list {
  flex: 1;
  min-height: 240px;
  overflow: auto;
  padding: 8px 12px;
  background: #f7f8fa;
  border-radius: 6px;
}
.row {
  display: flex;
  margin-bottom: 10px;
}
.row.rx { justify-content: flex-start; }
.row.tx { justify-content: flex-end; }
.bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.row.tx .bubble {
  background: #e6f4ff;
}
.meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
  margin-bottom: 4px;
}
.dir { font-weight: 600; }
.body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.45;
}
.send-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.send-input { flex: 1; }
</style>
