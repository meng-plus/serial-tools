<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="app-ctx-menu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @contextmenu.prevent
    >
      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="item.type === 'divider'" class="ctx-divider" />
        <div
          v-else
          class="ctx-item"
          :class="{ disabled: item.disabled }"
          @click="onItemClick(item)"
        >
          <span>{{ item.label }}</span>
          <span v-if="item.hint" class="ctx-hint">{{ item.hint }}</span>
        </div>
      </template>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import { useRouter } from 'vue-router'
import { useConnectionStore, useTerminalStore } from '@/stores'

export type CtxItem =
  | { type: 'divider' }
  | { type: 'action'; label: string; hint?: string; disabled?: boolean; action: () => void | Promise<void> }

const router = useRouter()
const connectionStore = useConnectionStore()
const terminalStore = useTerminalStore()

const visible = ref(false)
const x = ref(0)
const y = ref(0)
const items = ref<CtxItem[]>([])

function hide() {
  visible.value = false
  items.value = []
}

function getSelectionText() {
  return window.getSelection()?.toString() ?? ''
}

function resolveEditable(el: HTMLElement | null): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!el) return null
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el
  if (el.isContentEditable) return el
  return el.closest('input, textarea, [contenteditable="true"]') as HTMLElement | null
}

async function copyText(text: string) {
  if (!text) {
    message.warning('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制')
  } catch {
    message.error('复制失败')
  }
}

async function pasteInto(el: HTMLElement) {
  try {
    const text = await navigator.clipboard.readText()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const before = el.value.slice(0, start)
      const after = el.value.slice(end)
      el.value = before + text + after
      el.dispatchEvent(new Event('input', { bubbles: true }))
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
      el.focus()
    } else {
      document.execCommand('insertText', false, text)
    }
  } catch {
    message.warning('无法读取剪贴板，请使用 Ctrl+V')
  }
}

function buildItems(el: HTMLElement | null): CtxItem[] {
  const list: CtxItem[] = []
  const selection = getSelectionText()
  const editable = resolveEditable(el)
  const inTerminal = !!el?.closest('.terminal-container, .terminal-page')
  const inSend = !!el?.closest('.send-bar, .send-input')

  if (editable) {
    const canCutCopy = selection.length > 0
      || (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
        ? (editable.selectionStart ?? 0) !== (editable.selectionEnd ?? 0)
        : false)
    list.push(
      {
        type: 'action',
        label: '剪切',
        hint: 'Ctrl+X',
        disabled: !canCutCopy,
        action: () => {
          document.execCommand('cut')
        },
      },
      {
        type: 'action',
        label: '复制',
        hint: 'Ctrl+C',
        disabled: !canCutCopy && !selection,
        action: async () => {
          const t = getSelectionText()
            || ((editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement)
              ? editable.value.slice(editable.selectionStart ?? 0, editable.selectionEnd ?? 0)
              : '')
          await copyText(t || getSelectionText())
        },
      },
      {
        type: 'action',
        label: '粘贴',
        hint: 'Ctrl+V',
        action: () => pasteInto(editable),
      },
      {
        type: 'action',
        label: '全选',
        hint: 'Ctrl+A',
        action: () => {
          if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
            editable.select()
            editable.focus()
          } else {
            document.execCommand('selectAll')
          }
        },
      },
    )
    if (inSend) {
      list.push(
        { type: 'divider' },
        {
          type: 'action',
          label: '清空发送框',
          action: () => {
            if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
              editable.value = ''
              editable.dispatchEvent(new Event('input', { bubbles: true }))
            }
          },
        },
      )
    }
  } else if (inTerminal) {
    list.push(
      {
        type: 'action',
        label: '复制选中',
        hint: 'Ctrl+C',
        disabled: !selection,
        action: () => copyText(selection),
      },
      {
        type: 'action',
        label: '复制全部日志',
        action: async () => {
          const text = terminalStore.filteredLines
            .map(l => {
              const parts = [
                terminalStore.displayConfig.showTimestamp ? `[${l.timestamp}]` : '',
                terminalStore.displayConfig.showDirection ? (l.direction === 'rx' ? 'RX' : 'TX') : '',
                terminalStore.displayConfig.showChannel ? l.channelId : '',
                terminalStore.displayText(l),
              ].filter(Boolean)
              return parts.join(' ')
            })
            .join('\n')
          await copyText(text)
        },
      },
      {
        type: 'action',
        label: '复制全部 HEX',
        action: async () => {
          const text = terminalStore.filteredLines
            .map(l => `${l.direction.toUpperCase()} ${l.hex}`)
            .join('\n')
          await copyText(text)
        },
      },
      { type: 'divider' },
      {
        type: 'action',
        label: '清屏',
        action: () => terminalStore.clear(),
      },
      {
        type: 'action',
        label: terminalStore.encoding === 'hex' ? '切换为 UTF-8 显示' : '切换为 HEX 显示',
        action: () => {
          terminalStore.encoding = terminalStore.encoding === 'hex' ? 'utf-8' : 'hex'
        },
      },
    )
  } else {
    if (selection) {
      list.push({
        type: 'action',
        label: '复制',
        hint: 'Ctrl+C',
        action: () => copyText(selection),
      })
      list.push({ type: 'divider' })
    }
    list.push(
      {
        type: 'action',
        label: '刷新连接状态',
        action: async () => {
          await connectionStore.refreshStatus()
          message.success('连接状态已刷新')
        },
      },
      {
        type: 'action',
        label: '打开终端',
        action: () => {
          void router.push({ name: 'terminal' })
        },
      },
      {
        type: 'action',
        label: '清屏',
        disabled: terminalStore.lines.length === 0,
        action: () => terminalStore.clear(),
      },
    )
  }

  return list
}

function placeMenu(clientX: number, clientY: number) {
  const pad = 8
  const approxW = 220
  const approxH = Math.max(40, items.value.length * 32)
  x.value = Math.min(clientX, window.innerWidth - approxW - pad)
  y.value = Math.min(clientY, window.innerHeight - approxH - pad)
  x.value = Math.max(pad, x.value)
  y.value = Math.max(pad, y.value)
}

function onContextMenu(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  // 不在自定义菜单上再次弹出
  if (el?.closest('.app-ctx-menu')) {
    e.preventDefault()
    return
  }
  e.preventDefault()
  items.value = buildItems(el)
  if (items.value.length === 0) {
    hide()
    return
  }
  placeMenu(e.clientX, e.clientY)
  visible.value = true
}

async function onItemClick(item: CtxItem) {
  if (item.type !== 'action' || item.disabled) return
  hide()
  await item.action()
}

function onPointerDown(e: MouseEvent) {
  if (!visible.value) return
  const el = e.target as HTMLElement | null
  if (!el?.closest('.app-ctx-menu')) hide()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') hide()
}

onMounted(() => {
  window.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('blur', hide)
  window.addEventListener('resize', hide)
  window.addEventListener('scroll', hide, true)
})

onUnmounted(() => {
  window.removeEventListener('contextmenu', onContextMenu, true)
  window.removeEventListener('mousedown', onPointerDown, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('blur', hide)
  window.removeEventListener('resize', hide)
  window.removeEventListener('scroll', hide, true)
})
</script>

<style scoped>
.app-ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  max-width: 280px;
  padding: 4px 0;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
  user-select: none;
}
.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 14px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.88);
  cursor: pointer;
  line-height: 1.4;
}
.ctx-item:hover:not(.disabled) {
  background: #f5f5f5;
}
.ctx-item.disabled {
  color: rgba(0, 0, 0, 0.25);
  cursor: not-allowed;
}
.ctx-hint {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}
.ctx-divider {
  height: 1px;
  margin: 4px 0;
  background: #f0f0f0;
}
</style>
