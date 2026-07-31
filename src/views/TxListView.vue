<template>
  <div class="tx-list-view">
    <div class="toolbar">
      <a-space wrap>
        <a-button size="small" type="primary" :disabled="!list.items.length" @click="handleStartEnabled">
          启动全部已启用
        </a-button>
        <a-button size="small" danger :disabled="!anyRunning" @click="tx.stopChannel(channelId)">
          停止全部
        </a-button>
        <a-button size="small" @click="addItem">添加条目</a-button>
        <a-button size="small" @click="showVars = true">变量说明</a-button>
        <a-select
          v-model:value="list.frameProfileId"
          allow-clear
          placeholder="默认帧配置（可选）"
          style="width: 200px"
          size="small"
          @change="persist"
        >
          <a-select-option v-for="p in tx.frameProfiles" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
        </a-select>
      </a-space>
    </div>

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 8px"
      message="每条独立周期与次数；内容原样发送（后缀请写在内容里，如 0D0A）。离开本页不会停止已启动的定时器。点击「变量说明」查阅 {{seq}} / {{channel.seq}} / 时间 / 随机 等。"
    />

    <a-table
      size="small"
      :columns="columns"
      :data-source="list.items"
      row-key="id"
      :pagination="false"
      :scroll="{ x: 1100 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'enabled'">
          <a-checkbox v-model:checked="record.enabled" @change="persist" />
        </template>
        <template v-else-if="column.key === 'label'">
          <a-input v-model:value="record.label" size="small" placeholder="备注" @change="persist" />
        </template>
        <template v-else-if="column.key === 'format'">
          <a-select v-model:value="record.format" size="small" style="width: 88px" @change="persist">
            <a-select-option value="hex">HEX</a-select-option>
            <a-select-option value="text">UTF-8</a-select-option>
            <a-select-option value="gbk">GBK</a-select-option>
          </a-select>
        </template>
        <template v-else-if="column.key === 'payload'">
          <div class="payload-cell">
            <a-input
              v-model:value="record.payload"
              size="small"
              :placeholder="record.format === 'hex' ? '01 03 {{seq:u8}} …' : '文本，可含 {{seq}}'"
              @change="persist"
              @focus="activeItemId = record.id"
            />
            <div class="preview" v-if="record.payload.includes('{{')">
              预览: {{ previewOf(record) }}
            </div>
          </div>
        </template>
        <template v-else-if="column.key === 'intervalMs'">
          <a-input-number
            v-model:value="record.intervalMs"
            :min="50"
            :step="100"
            size="small"
            style="width: 100px"
            @change="persist"
          />
        </template>
        <template v-else-if="column.key === 'loop'">
          <a-checkbox v-model:checked="record.loop" @change="persist">循环</a-checkbox>
        </template>
        <template v-else-if="column.key === 'count'">
          <a-input-number
            v-model:value="record.count"
            :min="1"
            :disabled="record.loop"
            size="small"
            style="width: 72px"
            @change="persist"
          />
        </template>
        <template v-else-if="column.key === 'frame'">
          <a-select
            v-model:value="record.frameProfileId"
            allow-clear
            placeholder="默认"
            size="small"
            style="width: 120px"
            @change="persist"
          >
            <a-select-option v-for="p in tx.frameProfiles" :key="p.id" :value="p.id">{{ p.name }}</a-select-option>
          </a-select>
        </template>
        <template v-else-if="column.key === 'status'">
          <span :class="{ running: tx.isItemRunning(channelId, record.id) }">
            {{ tx.isItemRunning(channelId, record.id) ? '运行' : '停止' }}
            · 已发 {{ tx.getSentCount(channelId, record.id) }}
          </span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="sendOnce(record.id)">发一次</a-button>
          <a-button
            v-if="!tx.isItemRunning(channelId, record.id)"
            type="link"
            size="small"
            @click="startOne(record.id)"
          >启动</a-button>
          <a-button
            v-else
            type="link"
            size="small"
            danger
            @click="tx.stopItem(channelId, record.id)"
          >停止</a-button>
          <a-button type="link" size="small" danger @click="removeItem(record.id)">删</a-button>
        </template>
      </template>
    </a-table>

    <a-drawer v-model:open="showVars" title="变量说明" width="480" placement="right">
      <p class="hint">点击「插入」写入当前聚焦行的内容末尾。条目序号与通道序号相互独立。</p>
      <a-list :data-source="TX_VAR_CATALOG" size="small" bordered>
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <code>{{ item.token }}</code>
                <a-tag size="small" style="margin-left: 8px">{{ item.scope }}</a-tag>
              </template>
              <template #description>
                <div>{{ item.description }}</div>
                <div class="ex">文本：<code>{{ item.textExample }}</code></div>
                <div class="ex">HEX：<code>{{ item.hexExample }}</code></div>
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
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { useTerminalStore, useTxPlannerStore } from '@/stores'
import { createDefaultTxItem, type TxListItem } from '@/workspace/schema'
import { applyFrame, bytesToHex, hexToBytes } from '@/protocol/frame'
import { expandTxPayload, previewTxPayload, TX_VAR_CATALOG } from '@/protocol/txVars'

const props = defineProps<{ channelId: string }>()
const tx = useTxPlannerStore()
const terminalStore = useTerminalStore()

const list = computed(() => tx.ensureList(props.channelId))
const showVars = ref(false)
const activeItemId = ref('')

const anyRunning = computed(() =>
  list.value.items.some(i => tx.isItemRunning(props.channelId, i.id)),
)

const columns = [
  { title: '启用', key: 'enabled', width: 56 },
  { title: '备注', key: 'label', width: 90 },
  { title: '格式', key: 'format', width: 96 },
  { title: '内容', key: 'payload', width: 280 },
  { title: '周期ms', key: 'intervalMs', width: 110 },
  { title: '循环', key: 'loop', width: 64 },
  { title: '次数', key: 'count', width: 80 },
  { title: '帧配置', key: 'frame', width: 130 },
  { title: '状态', key: 'status', width: 110 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' as const },
]

function persist() {
  tx.setList(props.channelId, {
    ...list.value,
    items: list.value.items.map(i => ({ ...i })),
  })
}

function addItem() {
  const item = createDefaultTxItem({
    id: `item-${Date.now()}`,
    payload: '01 03 00 00 00 0A',
  })
  tx.setList(props.channelId, {
    ...list.value,
    items: [...list.value.items, item],
  })
  activeItemId.value = item.id
}

function removeItem(id: string) {
  tx.stopItem(props.channelId, id)
  tx.setList(props.channelId, {
    ...list.value,
    items: list.value.items.filter(i => i.id !== id),
  })
}

function insertToken(token: string) {
  const id = activeItemId.value || list.value.items[0]?.id
  if (!id) {
    message.warning('请先添加并选中一条内容')
    return
  }
  const item = list.value.items.find(i => i.id === id)
  if (!item) return
  item.payload = `${item.payload}${item.payload.endsWith(' ') || !item.payload ? '' : ' '}${token}`
  activeItemId.value = id
  persist()
  message.success(`已插入 ${token}`)
}

function previewOf(item: TxListItem) {
  try {
    return previewTxPayload(item.payload, {
      format: item.format,
      itemSeq: tx.getItemSeq(props.channelId, item.id),
      channelSeq: tx.getChannelSeq(props.channelId),
    })
  } catch {
    return '(预览失败)'
  }
}

async function sendItem(item: TxListItem) {
  const expanded = expandTxPayload(item.payload, {
    format: item.format,
    itemSeq: tx.getItemSeq(props.channelId, item.id),
    channelSeq: tx.getChannelSeq(props.channelId),
  })

  const profileId = item.frameProfileId || list.value.frameProfileId
  const profile = tx.frameProfiles.find(p => p.id === profileId)

  if (item.format === 'hex') {
    let bytes = hexToBytes(expanded.payload)
    if (profile) {
      const seq = tx.getProfileSeq(profile.id)
      const framed = applyFrame(bytes, profile, seq)
      bytes = framed.bytes
      tx.setProfileSeq(profile.id, framed.nextSeq)
    }
    await terminalStore.sendHex(props.channelId, bytesToHex(bytes))
  } else {
    await terminalStore.sendText(
      props.channelId,
      expanded.payload,
      'none',
      item.format === 'gbk' ? 'gbk' : 'utf-8',
    )
  }

  tx.bumpSeqs(props.channelId, item.id, expanded.usedItemSeq, expanded.usedChannelSeq)
}

async function sendOnce(itemId: string) {
  const item = list.value.items.find(i => i.id === itemId)
  if (!item) return
  try {
    await sendItem(item)
  } catch (e: unknown) {
    message.error(String(e))
  }
}

function bindSendFn() {
  return async (channelId: string, itemId: string) => {
    const item = tx.listsByChannel[channelId]?.items.find(i => i.id === itemId)
    if (!item) throw new Error('条目不存在')
    await sendItem(item)
  }
}

function startOne(itemId: string) {
  const ok = tx.startItem(props.channelId, itemId, bindSendFn())
  if (!ok) message.warning('条目不存在')
  else message.success('已启动')
}

function handleStartEnabled() {
  const n = tx.startEnabled(props.channelId, bindSendFn())
  if (n === 0) message.warning('没有已启用的条目')
  else message.success(`已启动 ${n} 条`)
}
</script>

<style scoped>
.tx-list-view { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.toolbar { margin-bottom: 4px; }
.payload-cell { display: flex; flex-direction: column; gap: 2px; }
.preview { font-size: 11px; color: rgba(0,0,0,0.45); word-break: break-all; }
.running { color: #389e0d; font-weight: 500; }
.hint { color: rgba(0,0,0,0.45); margin-bottom: 12px; }
.ex { margin-top: 4px; font-size: 12px; }
code { font-size: 12px; }
</style>
