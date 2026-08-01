<template>
  <div ref="rootRef" class="vt100-view" tabindex="0" @keydown="onRootKey">
    <div class="toolbar">
      <a-space wrap>
        <a-checkbox v-model:checked="localEcho">本地回显</a-checkbox>
        <a-input-number
          v-model:value="fontSize"
          :min="10"
          :max="28"
          size="small"
          addon-before="字号"
          style="width: 120px"
          @change="applyFont"
        />
        <a-button size="small" @click="copySelection">复制选中</a-button>
        <a-button size="small" @click="handleClear">清屏</a-button>
        <a-button size="small" @click="focusTerm">聚焦</a-button>
        <span class="hint">Ctrl+Shift+C 复制 · Ctrl+Shift+V 粘贴 · Ctrl+滚轮字号 · Ctrl+L 清屏</span>
      </a-space>
    </div>
    <div ref="hostRef" class="xterm-host" @click="focusTerm" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useRxHub, useTerminalStore, useWorkspaceStore } from '@/stores'
import type { RxRecord } from '@/protocol/types'
import { useViewFontSize } from '@/composables/useViewFontSize'

const props = defineProps<{ channelId: string; viewId: string }>()

const hub = useRxHub()
const terminalStore = useTerminalStore()
const workspace = useWorkspaceStore()

const rootRef = ref<HTMLElement | null>(null)
const hostRef = ref<HTMLElement | null>(null)
const localEcho = ref(true)

let term: Terminal | null = null
let fit: FitAddon | null = null
let unsub: (() => void) | null = null
let ro: ResizeObserver | null = null

const { fontSize, setFontSize } = useViewFontSize(rootRef, 14, (n) => {
  if (term) {
    term.options.fontSize = n
    fit?.fit()
  }
  persistConfig()
})

function dataToHex(data: string): string {
  let hex = ''
  for (let i = 0; i < data.length; i++) {
    hex += (data.charCodeAt(i) & 0xff).toString(16).padStart(2, '0')
  }
  return hex
}

function writeRx(r: RxRecord) {
  if (r.channelId !== props.channelId || r.direction !== 'rx' || !term) return
  const bytes = r.bytes?.length ? r.bytes : []
  if (bytes.length) {
    term.write(Uint8Array.from(bytes))
    return
  }
  if (r.text) term.write(r.text)
}

function sendRaw(data: string) {
  if (!data) return
  if (localEcho.value && term) {
    term.write(data)
  }
  void terminalStore.sendHex(props.channelId, dataToHex(data)).catch((e: unknown) => {
    message.error(String(e))
  })
}

function applyFont() {
  if (!term) return
  term.options.fontSize = fontSize.value
  fit?.fit()
  persistConfig()
}

function persistConfig() {
  workspace.updateViewConfig(props.channelId, props.viewId, {
    localEcho: localEcho.value,
    fontSize: fontSize.value,
  })
}

function handleClear() {
  Modal.confirm({
    title: '清屏？',
    content: '仅清空 VT100 显示，不断开连接。',
    onOk: () => term?.reset(),
  })
}

function focusTerm() {
  term?.focus()
}

async function copySelection() {
  const sel = term?.getSelection()
  if (!sel) {
    message.info('请先拖选文本')
    return
  }
  try {
    await navigator.clipboard.writeText(sel)
    message.success('已复制')
  } catch {
    message.error('复制失败')
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) sendRaw(text)
  } catch {
    message.error('无法读取剪贴板')
  }
}

function onRootKey(e: KeyboardEvent) {
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault()
    handleClear()
  }
}

function loadConfig() {
  const views = workspace.viewsByChannel[props.channelId] || []
  const v = views.find(x => x.id === props.viewId)
  const cfg = v?.config || {}
  if (typeof cfg.localEcho === 'boolean') localEcho.value = cfg.localEcho
  if (typeof cfg.fontSize === 'number') {
    setFontSize(cfg.fontSize)
  }
}

watch(localEcho, persistConfig)

onMounted(async () => {
  await hub.init()
  await terminalStore.init()
  loadConfig()

  if (!hostRef.value) return
  term = new Terminal({
    cursorBlink: true,
    fontSize: fontSize.value,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#aeafad',
    },
    scrollback: 5000,
    convertEol: false,
    rightClickSelectsWord: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(hostRef.value)
  fit.fit()
  term.focus()

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const e = ev as KeyboardEvent
    // Ctrl+Shift+C 或有选区时 Ctrl+C → 复制
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      if (e.shiftKey || (term && term.hasSelection())) {
        e.preventDefault()
        void copySelection()
        return false
      }
      // 无选区：不把 Ctrl+C 发给设备
      return false
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault()
      void pasteFromClipboard()
      return false
    }
    return true
  })

  term.onData((data) => {
    sendRaw(data)
  })

  for (const r of hub.recordsForChannel(props.channelId)) {
    writeRx(r)
  }

  unsub = hub.subscribe(writeRx)

  ro = new ResizeObserver(() => {
    try {
      fit?.fit()
    } catch { /* ignore */ }
  })
  ro.observe(hostRef.value)
})

onUnmounted(() => {
  unsub?.()
  unsub = null
  ro?.disconnect()
  ro = null
  term?.dispose()
  term = null
  fit = null
})
</script>

<style scoped>
.vt100-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
  outline: none;
}
.toolbar .hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
.xterm-host {
  flex: 1;
  min-height: 280px;
  padding: 4px;
  background: #1e1e1e;
  border-radius: 6px;
  overflow: hidden;
}
.xterm-host :deep(.xterm) {
  height: 100%;
}
.xterm-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
