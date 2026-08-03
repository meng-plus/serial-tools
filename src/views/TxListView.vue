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
      </a-space>
    </div>

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 8px"
      message="每条独立周期与次数。序号可用变量 {{seq}}；校验既可写在内容里（{{crc16:le}}），也可用下方「追加校验」按覆盖区间算后追加到帧尾（仅 HEX）。"
    />

    <div class="card-list">
      <div v-if="!list.items.length" class="empty-hint">
        暂无定时发送条目，点击「添加条目」开始
      </div>
      <div v-for="item in list.items" :key="item.id" class="tx-card">
        <!-- 卡片头部：启用 + 备注 + 格式 + 操作 -->
        <div class="card-header">
          <a-checkbox v-model:checked="item.enabled" @change="persist" />
          <a-input
            v-model:value="item.label"
            size="small"
            placeholder="备注"
            style="width: 120px"
            @change="persist"
          />
          <a-select v-model:value="item.format" size="small" style="width: 96px" @change="onFormatChange(item)">
            <a-select-option value="hex">HEX</a-select-option>
            <a-select-option value="text">UTF-8</a-select-option>
            <a-select-option value="gbk">GBK</a-select-option>
          </a-select>
          <span class="card-status" :class="{ running: tx.isItemRunning(channelId, item.id) }">
            {{ tx.isItemRunning(channelId, item.id) ? '运行中' : '停止' }}
            · 已发 {{ tx.getSentCount(channelId, item.id) }}
          </span>
          <span class="card-actions">
            <a-button type="link" size="small" @click="sendOnce(item.id)">发一次</a-button>
            <a-button
              v-if="!tx.isItemRunning(channelId, item.id)"
              type="link"
              size="small"
              @click="startOne(item.id)"
            >启动</a-button>
            <a-button
              v-else
              type="link"
              size="small"
              danger
              @click="tx.stopItem(channelId, item.id)"
            >停止</a-button>
            <a-button type="link" size="small" danger @click="removeItem(item.id)">删除</a-button>
          </span>
        </div>

        <!-- 卡片内容：payload 输入 -->
        <div class="card-body">
          <a-textarea
            v-model:value="item.payload"
            :auto-size="{ minRows: 2, maxRows: 6 }"
            :placeholder="item.format === 'hex' ? '01 03 {{seq:u8}} 00 00 00 0A {{crc16:le}}' : '文本内容，可含 {{seq}}、{{crc16}} 等变量'"
            @focus="activeItemId = item.id"
            @change="persist"
          />
          <div
            v-if="item.payload.includes('{{') || (item.format === 'hex' && item.checksum && item.checksum !== 'none')"
            class="preview"
          >
            预览：{{ previewOf(item) }}
          </div>
          <div v-if="getHexWarning(item)" class="hex-warning">
            ⚠️ {{ getHexWarning(item) }}
          </div>
        </div>

        <!-- 追加校验（与收发日志发送区一致） -->
        <div class="send-opts">
          <a-space wrap size="small">
            <span class="opt-label">追加校验</span>
            <a-select
              :value="item.checksum || 'none'"
              style="width: 260px"
              size="small"
              :get-popup-container="popupContainer"
              :dropdown-style="{ zIndex: 3000 }"
              @update:value="(v: string) => onItemChecksumChange(item, v)"
            >
              <a-select-option v-for="c in CHECKSUM_CATALOG" :key="c.id" :value="c.id">
                {{ c.name }}
              </a-select-option>
            </a-select>
            <template v-if="item.checksum && item.checksum !== 'none'">
              <template v-if="checksumNeedsEndian(item.checksum)">
                <span class="opt-label">写入端序</span>
                <a-select
                  :value="getEndian(item)"
                  style="width: 140px"
                  size="small"
                  :get-popup-container="popupContainer"
                  :dropdown-style="{ zIndex: 3000 }"
                  @update:value="(v: string) => onItemEndianChange(item, v as 'le' | 'be')"
                >
                  <a-select-option v-for="o in ENDIAN_OPTIONS" :key="o.value" :value="o.value">
                    {{ o.label }}
                  </a-select-option>
                </a-select>
              </template>
              <span class="opt-label">覆盖起</span>
              <a-input-number
                :value="item.coverStart ?? 0"
                :min="0"
                size="small"
                style="width: 70px"
                @update:value="(v: number | null) => onItemCoverStartChange(item, v)"
              />
              <a-select
                :value="item.coverEndMode || 'to_end'"
                size="small"
                style="width: 130px"
                :get-popup-container="popupContainer"
                :dropdown-style="{ zIndex: 3000 }"
                @update:value="(v: string) => onItemCoverEndModeChange(item, v)"
              >
                <a-select-option value="to_end">到末尾</a-select-option>
                <a-select-option value="exclude_tail">排除尾部N</a-select-option>
                <a-select-option value="length">指定长度</a-select-option>
              </a-select>
              <a-input-number
                v-if="(item.coverEndMode || 'to_end') !== 'to_end'"
                :value="item.coverEndValue ?? 0"
                :min="0"
                size="small"
                style="width: 70px"
                @update:value="(v: number | null) => onItemCoverEndValueChange(item, v)"
              />
              <span class="opt-hint muted">{{ itemChecksumHint(item) }}</span>
            </template>
            <span v-else class="opt-hint muted">选算法后按覆盖区间计算并追加到帧尾（仅 HEX）</span>
          </a-space>
        </div>

        <!-- 卡片底部：周期 + 循环 + 次数 -->
        <div class="card-footer">
          <span class="footer-item">
            周期
            <a-input-number
              v-model:value="item.intervalMs"
              :min="50"
              :step="100"
              size="small"
              style="width: 90px"
              @change="persist"
            />
            ms
          </span>
          <span class="footer-item">
            <a-checkbox v-model:checked="item.loop" @change="persist">循环</a-checkbox>
          </span>
          <span class="footer-item">
            次数
            <a-input-number
              v-model:value="item.count"
              :min="1"
              :disabled="item.loop"
              size="small"
              style="width: 72px"
              @change="persist"
            />
          </span>
        </div>
      </div>
    </div>

    <!-- 变量说明：与收发日志共用 TxVarHelpDrawer / TX_VAR_CATALOG -->
    <TxVarHelpDrawer
      v-model:open="showVars"
      hint="点击「插入」写入当前聚焦行的内容末尾。序号与通道序号相互独立。"
      @insert="insertToken"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { errorMessage } from '@/utils/error'
import { message } from 'ant-design-vue'
import { useTerminalStore, useTxPlannerStore } from '@/stores'
import { createDefaultTxItem, type TxListItem } from '@/workspace/schema'
import { CHECKSUM_CATALOG, type ChecksumAlgo } from '@/protocol/checksum'
import {
  ENDIAN_OPTIONS,
  applyEndianToChecksumAlgo,
  checksumNeedsEndian,
  defaultEndianForChecksum,
  endianHint,
  type Endian,
} from '@/protocol/endianLabels'
import { runSendPipeline, type CoverEndMode } from '@/protocol/sendPipeline'
import {
  previewTxPayload,
  checkHexCompatibility,
} from '@/protocol/txVars'
import TxVarHelpDrawer from '@/components/TxVarHelpDrawer.vue'

const props = defineProps<{ channelId: string }>()
const tx = useTxPlannerStore()
const terminalStore = useTerminalStore()

const list = computed(() => tx.ensureList(props.channelId))
const showVars = ref(false)
const activeItemId = ref('')

const anyRunning = computed(() =>
  list.value.items.some(i => tx.isItemRunning(props.channelId, i.id)),
)

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

function onFormatChange(item: TxListItem) {
  persist()
  const warning = getHexWarning(item)
  if (warning) {
    message.warning(warning)
  }
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

/** 预览：变量展开 +（可选）追加校验后的线上字节 */
function previewOf(item: TxListItem) {
  try {
    const algo = (item.checksum || 'none') as ChecksumAlgo
    if (item.format === 'hex' && algo !== 'none') {
      return runSendPipeline(pipelineInput(item)).preview
    }
    return previewTxPayload(item.payload, {
      format: item.format,
      itemSeq: tx.getItemSeq(props.channelId, item.id),
      channelSeq: tx.getChannelSeq(props.channelId),
    })
  } catch {
    return '(预览失败)'
  }
}

/** 检查 hex 发送时的格式兼容性 */
function getHexWarning(item: TxListItem): string | null {
  if (item.format !== 'hex') return null

  const { compatible, incompatibleTokens } = checkHexCompatibility(item.payload)
  if (!compatible && incompatibleTokens.length > 0) {
    return `变量 ${incompatibleTokens.join('、')} 使用了 dec 格式，HEX 发送时将被解析为非预期值。建议使用 hex/le/be 格式。`
  }
  return null
}

function getEndian(item: TxListItem): Endian {
  if (item.checksumEndian) return item.checksumEndian
  return defaultEndianForChecksum((item.checksum || 'none') as ChecksumAlgo)
}

function itemChecksumHint(item: TxListItem): string {
  const algo = (item.checksum || 'none') as ChecksumAlgo
  const cat = CHECKSUM_CATALOG.find(c => c.id === algo)
  if (!checksumNeedsEndian(algo)) return cat?.hint || '单字节校验，无端序'
  const tip = endianHint(getEndian(item))
  return item.format === 'hex'
    ? `${tip}${cat?.hint ? ` · ${cat.hint}` : ''}`
    : `请切换到 HEX；${tip}`
}

function onItemChecksumChange(item: TxListItem, raw: string) {
  let algo = (raw || 'none') as ChecksumAlgo
  const end = defaultEndianForChecksum(algo)
  algo = applyEndianToChecksumAlgo(algo, end)
  const patch: Partial<TxListItem> = {
    checksum: algo,
    checksumEndian: checksumNeedsEndian(algo) ? end : undefined,
  }
  if (algo === 'none') {
    patch.coverStart = undefined
    patch.coverEndMode = undefined
    patch.coverEndValue = undefined
  } else {
    patch.coverStart = item.coverStart ?? 0
    patch.coverEndMode = item.coverEndMode || 'to_end'
    if (item.format !== 'hex') {
      patch.format = 'hex'
      message.info('追加校验需 HEX 字节流，已切换到 HEX 发送')
    }
  }
  tx.updateItem(props.channelId, item.id, patch)
}

function onItemEndianChange(item: TxListItem, end: Endian) {
  const algo = applyEndianToChecksumAlgo((item.checksum || 'none') as ChecksumAlgo, end)
  tx.updateItem(props.channelId, item.id, {
    checksum: algo,
    checksumEndian: end,
  })
}

function onItemCoverStartChange(item: TxListItem, v: number | null) {
  tx.updateItem(props.channelId, item.id, {
    coverStart: Math.max(0, Math.floor(v ?? 0)),
  })
}

function onItemCoverEndModeChange(item: TxListItem, v: string) {
  const mode = (v === 'exclude_tail' || v === 'length' || v === 'to_end' ? v : 'to_end') as CoverEndMode
  tx.updateItem(props.channelId, item.id, {
    coverEndMode: mode,
    coverEndValue: mode === 'to_end' ? undefined : (item.coverEndValue ?? 0),
  })
}

function onItemCoverEndValueChange(item: TxListItem, v: number | null) {
  tx.updateItem(props.channelId, item.id, {
    coverEndValue: Math.max(0, Math.floor(v ?? 0)),
  })
}

function popupContainer() {
  return document.body
}

function pipelineInput(item: TxListItem) {
  const algo = (item.checksum || 'none') as ChecksumAlgo
  return {
    format: item.format,
    payload: item.payload,
    expandCtx: {
      format: (item.format === 'hex' ? 'hex' : 'text') as 'hex' | 'text',
      itemSeq: tx.getItemSeq(props.channelId, item.id),
      channelSeq: tx.getChannelSeq(props.channelId),
    },
    checksum: item.format === 'hex' ? algo : ('none' as ChecksumAlgo),
    cover: {
      start: item.coverStart ?? 0,
      endMode: (item.coverEndMode || 'to_end') as CoverEndMode,
      endValue: item.coverEndValue ?? 0,
    },
    checksumEndian: checksumNeedsEndian(algo) ? getEndian(item) : undefined,
  }
}

async function sendItem(item: TxListItem) {
  const warning = getHexWarning(item)
  if (warning) {
    message.warning(warning)
  }

  const algo = (item.checksum || 'none') as ChecksumAlgo
  if (algo !== 'none' && item.format !== 'hex') {
    item.format = 'hex'
    persist()
    message.warning('追加校验需 HEX 发送，已切换格式，请确认内容为十六进制后再次发送')
    return
  }

  const r = runSendPipeline(pipelineInput(item))
  if (item.format === 'hex') {
    await terminalStore.sendHex(props.channelId, r.wire)
  } else {
    await terminalStore.sendText(
      props.channelId,
      r.wire,
      'none',
      item.format === 'gbk' ? 'gbk' : 'utf-8',
    )
  }

  tx.bumpSeqs(props.channelId, item.id, r.usedItemSeq, r.usedChannelSeq)
}

async function sendOnce(itemId: string) {
  const item = list.value.items.find(i => i.id === itemId)
  if (!item) return
  try {
    await sendItem(item)
  } catch (e: unknown) {
    message.error(errorMessage(e))
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
.tx-list-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.toolbar {
  margin-bottom: 4px;
}

.empty-hint {
  color: rgba(0, 0, 0, 0.45);
  text-align: center;
  padding: 40px 0;
}

.card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}

.tx-card {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
  transition: box-shadow 0.2s;
}

.tx-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  flex-wrap: wrap;
}

.card-status {
  margin-left: auto;
  font-size: 12px;
  color: #999;
}

.card-status.running {
  color: #389e0d;
  font-weight: 500;
}

.card-actions {
  display: flex;
  gap: 0;
}

.card-body {
  padding: 12px;
}

.preview {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  margin-top: 6px;
  font-family: ui-monospace, monospace;
  word-break: break-all;
}

.hex-warning {
  font-size: 12px;
  color: #d46b08;
  margin-top: 4px;
}

.send-opts {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}
.opt-label {
  font-size: 0.92em;
  color: rgba(0, 0, 0, 0.65);
  font-weight: 500;
}
.opt-hint {
  font-size: 0.85em;
  color: #d46b08;
}
.opt-hint.muted {
  color: rgba(0, 0, 0, 0.45);
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
  flex-wrap: wrap;
}

.footer-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}
</style>
