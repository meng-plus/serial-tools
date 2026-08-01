<template>
  <div class="parsed-log-view">
    <a-alert
      type="info"
      show-icon
      class="help"
      message="怎么测：保存规则 → 在「收发日志」用 HEX/文本发送示例报文 → 匹配结果出现在本页。二进制规则会自动分帧（定界符 + 超时兜底）。一条规则可提取多个字段（最多 32）。"
    />

    <div class="toolbar">
      <a-space wrap>
        <a-button size="small" type="primary" @click="openCreate">添加规则</a-button>
        <a-button size="small" @click="handleExport">导出</a-button>
        <a-button size="small" @click="protocolStore.clearParsed(channelId)">清空本通道结果</a-button>
      </a-space>
    </div>

    <a-list size="small" :data-source="channelRules" class="rule-list" bordered>
      <template #header>解析规则（作用于当前工作区通道）</template>
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #title>{{ item.name }}</template>
            <template #description>
              <a-tag size="small">{{ item.type }}</a-tag>
              {{ describeRule(item) }}
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-switch
              :checked="item.enabled"
              size="small"
              @change="(checked: boolean) => protocolStore.updateRule(item.id, { enabled: checked })"
            />
            <a-button size="small" type="link" @click="openEdit(item)">编辑</a-button>
            <a-button size="small" danger type="link" @click="protocolStore.removeRule(item.id)">删</a-button>
          </template>
        </a-list-item>
      </template>
    </a-list>
    <a-empty v-if="channelRules.length === 0" description="暂无规则，可点「添加规则」或用示例一键填充" />

    <a-table
      class="result-table"
      size="small"
      :columns="columns"
      :data-source="rows"
      :pagination="{ pageSize: 30 }"
      row-key="id"
      :scroll="{ y: 280 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'fields'">
          <a-tag v-for="f in record.fields" :key="f.name" size="small">
            {{ f.name }}={{ f.value }}{{ f.unit }}
          </a-tag>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="showRuleModal"
      :title="editingId ? '编辑解析规则' : '添加解析规则'"
      :ok-text="editingId ? '保存' : '添加'"
      width="860px"
      @ok="handleSubmit"
      @cancel="resetForm"
    >
      <a-space wrap style="margin-bottom: 12px">
        <span class="preset-label">填入示例：</span>
        <a-button size="small" @click="applyPreset('regexTemp')">正则 · 温湿度</a-button>
        <a-button size="small" @click="applyPreset('jsonTemp')">JSON · 多字段</a-button>
        <a-button size="small" @click="applyPreset('binTemp')">二进制 · AA55 温湿度</a-button>
      </a-space>

      <a-alert type="success" show-icon style="margin-bottom: 12px" :message="helpText" />

      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="名称" required>
              <a-input v-model:value="form.name" placeholder="例: 温湿度帧" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="类型">
              <a-select v-model:value="form.type" @change="onTypeChange">
                <a-select-option value="regex">正则（文本）</a-select-option>
                <a-select-option value="json">JSON（文本）</a-select-option>
                <a-select-option value="binary">二进制（厂家帧）</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <template v-if="form.type === 'regex'">
          <a-form-item label="正则表达式" required>
            <a-input v-model:value="form.pattern" placeholder="TEMP:([0-9.]+).*HUM:([0-9.]+)" />
          </a-form-item>
        </template>

        <template v-else-if="form.type === 'json'">
          <a-form-item label="过滤路径（可选）">
            <a-input v-model:value="form.pattern" placeholder="留空或 $.status" />
          </a-form-item>
        </template>

        <template v-else>
          <a-row :gutter="12">
            <a-col :span="8">
              <a-form-item label="同步头 HEX（可选）">
                <a-input v-model:value="form.syncHeader" placeholder="AA55" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="长度模式">
                <a-select v-model:value="form.lengthMode">
                  <a-select-option value="fixed">定长</a-select-option>
                  <a-select-option value="field">长度域</a-select-option>
                  <a-select-option value="idle">仅超时拼包</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="静默超时 idleMs">
                <a-input-number v-model:value="form.idleMs" :min="10" :step="10" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item v-if="form.lengthMode === 'fixed'" label="定长（字节）">
            <a-input-number v-model:value="form.fixedLength" :min="1" />
          </a-form-item>
          <a-row v-if="form.lengthMode === 'field'" :gutter="12">
            <a-col :span="6">
              <a-form-item label="长度域偏移">
                <a-input-number v-model:value="form.lengthOffset" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="长度域字节数">
                <a-select v-model:value="form.lengthSize" style="width: 100%">
                  <a-select-option :value="1">1</a-select-option>
                  <a-select-option :value="2">2</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="长度域端序">
                <a-select v-model:value="form.lengthEndian" style="width: 100%" :disabled="form.lengthSize === 1">
                  <a-select-option v-for="o in ENDIAN_OPTIONS" :key="o.value" :value="o.value">
                    {{ o.label }}
                  </a-select-option>
                </a-select>
                <div class="field-hint">{{ endianHint(form.lengthEndian) }}</div>
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="lengthBias">
                <a-input-number v-model:value="form.lengthBias" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="12">
            <a-col :span="14">
              <a-form-item label="帧尾校验算法">
                <a-select v-model:value="form.checksum" style="width: 100%" @change="onChecksumChange">
                  <a-select-option v-for="c in CHECKSUM_CATALOG" :key="c.id" :value="c.id">
                    {{ c.name }}
                  </a-select-option>
                </a-select>
                <div v-if="checksumHint" class="field-hint">{{ checksumHint }}</div>
              </a-form-item>
            </a-col>
            <a-col :span="10">
              <a-form-item label="校验写入端序">
                <a-select
                  v-model:value="form.checksumEndian"
                  style="width: 100%"
                  :disabled="!checksumNeedsEndian(form.checksum)"
                  @change="onChecksumEndianChange"
                >
                  <a-select-option v-for="o in ENDIAN_OPTIONS" :key="o.value" :value="o.value">
                    {{ o.label }}
                  </a-select-option>
                </a-select>
                <div class="field-hint">
                  {{ checksumNeedsEndian(form.checksum) ? endianHint(form.checksumEndian) : '8 位校验无端序' }}
                </div>
              </a-form-item>
            </a-col>
          </a-row>
        </template>

        <a-divider orientation="left">
          提取字段
          <a-button type="link" size="small" :disabled="form.fields.length >= MAX_FIELDS" @click="addField">
            + 添加字段
          </a-button>
        </a-divider>

        <div v-for="(row, idx) in form.fields" :key="row.key" class="field-row">
          <div class="field-row-head">
            <span>字段 {{ idx + 1 }}</span>
            <a-button
              type="link"
              size="small"
              danger
              :disabled="form.fields.length <= 1"
              @click="removeField(idx)"
            >
              删除
            </a-button>
          </div>
          <a-row :gutter="8">
            <a-col :span="form.type === 'binary' ? 5 : 6">
              <a-form-item label="名称" required>
                <a-input v-model:value="row.name" placeholder="temperature" />
              </a-form-item>
            </a-col>
            <template v-if="form.type === 'regex'">
              <a-col :span="4">
                <a-form-item label="捕获组">
                  <a-input-number v-model:value="row.group" :min="1" style="width: 100%" />
                </a-form-item>
              </a-col>
              <a-col :span="4">
                <a-form-item label="数值">
                  <a-switch v-model:checked="row.asNumber" checked-children="是" un-checked-children="否" />
                </a-form-item>
              </a-col>
            </template>
            <template v-else-if="form.type === 'json'">
              <a-col :span="6">
                <a-form-item label="JSON 路径" required>
                  <a-input v-model:value="row.path" placeholder="$.temp" />
                </a-form-item>
              </a-col>
              <a-col :span="4">
                <a-form-item label="数值">
                  <a-switch v-model:checked="row.asNumber" checked-children="是" un-checked-children="否" />
                </a-form-item>
              </a-col>
            </template>
            <template v-else>
              <a-col :span="3">
                <a-form-item label="偏移">
                  <a-input-number v-model:value="row.offset" :min="0" style="width: 100%" />
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="类型 / 端序">
                  <a-select v-model:value="row.binType" style="width: 100%" :options="binTypeSelectOptions" />
                </a-form-item>
              </a-col>
              <a-col :span="3">
                <a-form-item label="×scale">
                  <a-input-number v-model:value="row.scale" :step="0.1" style="width: 100%" />
                </a-form-item>
              </a-col>
              <a-col :span="3">
                <a-form-item label="+bias">
                  <a-input-number v-model:value="row.bias" :step="1" style="width: 100%" />
                </a-form-item>
              </a-col>
            </template>
            <a-col :span="form.type === 'binary' ? 3 : 4">
              <a-form-item label="单位">
                <a-input v-model:value="row.unit" placeholder="C" />
              </a-form-item>
            </a-col>
            <a-col :span="form.type === 'binary' ? 5 : 6">
              <a-form-item label="valueId">
                <a-input v-model:value="row.valueId" placeholder="默认=名称" />
              </a-form-item>
            </a-col>
          </a-row>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useProtocolStore } from '@/stores'
import type { BinaryNumberType, FieldExtract, BinaryFieldDef, ProtocolRule, RuleType } from '@/protocol/types'
import { CHECKSUM_CATALOG, type ChecksumAlgo } from '@/protocol/checksum'
import { DEFAULT_FRAME_CONFIG, type LengthMode } from '@/protocol/binaryFramer'
import {
  BINARY_TYPE_OPTIONS,
  ENDIAN_OPTIONS,
  applyEndianToChecksumAlgo,
  checksumNeedsEndian,
  defaultEndianForChecksum,
  endianHint,
  type Endian,
} from '@/protocol/endianLabels'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'

const props = defineProps<{ channelId: string }>()
const protocolStore = useProtocolStore()
const connectionStore = useConnectionStore()

const MAX_FIELDS = 32
let fieldKeySeq = 0

interface FormFieldRow {
  key: number
  name: string
  group: number
  path: string
  asNumber: boolean
  unit: string
  valueId: string
  offset: number
  binType: BinaryNumberType
  scale: number
  bias: number
}

function newFieldRow(partial: Partial<FormFieldRow> = {}): FormFieldRow {
  return {
    key: ++fieldKeySeq,
    name: '',
    group: 1,
    path: '',
    asNumber: true,
    unit: '',
    valueId: '',
    offset: 0,
    binType: 'u16be',
    scale: 1,
    bias: 0,
    ...partial,
  }
}

const showRuleModal = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  type: 'regex' as RuleType,
  pattern: '',
  syncHeader: 'AA55',
  lengthMode: 'fixed' as LengthMode,
  fixedLength: 7,
  lengthOffset: 2,
  lengthSize: 1 as 1 | 2,
  lengthEndian: 'be' as Endian,
  lengthBias: 0,
  idleMs: 40,
  checksum: 'sum8' as ChecksumAlgo,
  checksumEndian: 'le' as Endian,
  fields: [newFieldRow()] as FormFieldRow[],
})

const binTypeSelectOptions = BINARY_TYPE_OPTIONS.map(o => ({
  value: o.value,
  label: o.label,
}))

const channelRules = computed(() => protocolStore.rulesForChannel(props.channelId))
const rows = computed(() => [...protocolStore.parsedForChannel(props.channelId)].reverse())
const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const checksumHint = computed(
  () => CHECKSUM_CATALOG.find(c => c.id === form.checksum)?.hint || '',
)

const helpText = computed(() => {
  if (form.type === 'regex') return '多捕获组示例：TEMP:([0-9.]+).*HUM:([0-9.]+) → 字段组 1 / 组 2'
  if (form.type === 'json') return '多路径示例：{"temp":36.6,"hum":40} → $.temp / $.hum'
  return 'HEX 示例：AA 55 00 E6 01 90 + sum8；字段偏移 2/4 为「无符号 16 位·大端」×0.1'
})

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 110 },
  { title: '规则', dataIndex: 'ruleName', width: 100 },
  { title: '内容', dataIndex: 'content', ellipsis: true },
  { title: '字段', key: 'fields', width: 280 },
]

function describeRule(item: ProtocolRule): string {
  if (item.type === 'binary') {
    const head = item.frame?.syncHeader || item.pattern || '(无头)'
    const n = item.binaryFields?.length ?? 0
    const cs = CHECKSUM_CATALOG.find(c => c.id === (item.frame?.checksum || 'none'))
    return `${head} · ${item.frame?.lengthMode || 'idle'} · ${n} 字段 · ${cs?.name || '无校验'}`
  }
  const n = item.fields.length
  if (n === 0) return item.pattern || '(无字段)'
  const names = item.fields.map(f => f.name).slice(0, 4).join(', ')
  const more = n > 4 ? ` 等 ${n} 个` : ''
  if (item.type === 'regex') return `${item.pattern} → ${names}${more}`
  return `${names}${more}`
}

function resetForm() {
  editingId.value = null
  form.name = ''
  form.type = 'regex'
  form.pattern = ''
  form.syncHeader = 'AA55'
  form.lengthMode = 'fixed'
  form.fixedLength = 7
  form.lengthOffset = 2
  form.lengthSize = 1
  form.lengthEndian = 'be'
  form.lengthBias = 0
  form.idleMs = 40
  form.checksum = 'sum8'
  form.checksumEndian = 'le'
  form.fields = [newFieldRow({ name: '', group: 1, asNumber: true })]
}

function onTypeChange() {
  if (form.fields.length === 0) form.fields = [newFieldRow()]
}

function onChecksumChange() {
  form.checksumEndian = defaultEndianForChecksum(form.checksum)
  form.checksum = applyEndianToChecksumAlgo(form.checksum, form.checksumEndian)
}

function onChecksumEndianChange() {
  form.checksum = applyEndianToChecksumAlgo(form.checksum, form.checksumEndian)
}

function addField() {
  if (form.fields.length >= MAX_FIELDS) return
  const last = form.fields[form.fields.length - 1]
  form.fields.push(
    newFieldRow({
      group: (last?.group || 0) + 1,
      offset: form.type === 'binary' ? (last?.offset ?? 0) + 2 : 0,
      binType: last?.binType || 'u16be',
      scale: last?.scale ?? 1,
      asNumber: true,
    }),
  )
}

function removeField(idx: number) {
  if (form.fields.length <= 1) return
  form.fields.splice(idx, 1)
}

function openCreate() {
  resetForm()
  showRuleModal.value = true
}

function openEdit(item: ProtocolRule) {
  editingId.value = item.id
  form.name = item.name
  form.type = item.type
  form.pattern = item.pattern || ''
  if (item.type === 'binary') {
    form.syncHeader = item.frame?.syncHeader || item.pattern || ''
    form.lengthMode = item.frame?.lengthMode || 'fixed'
    form.fixedLength = item.frame?.fixedLength || 7
    form.lengthOffset = item.frame?.lengthOffset ?? 2
    form.lengthSize = (item.frame?.lengthSize as 1 | 2) || 1
    form.lengthEndian = item.frame?.lengthEndian === 'le' ? 'le' : 'be'
    form.lengthBias = item.frame?.lengthBias ?? 0
    form.idleMs = item.frame?.idleMs ?? 40
    form.checksum = item.frame?.checksum || 'none'
    form.checksumEndian =
      item.frame?.checksumEndian || defaultEndianForChecksum(form.checksum)
    const bfs = item.binaryFields?.length
      ? item.binaryFields
      : [{ name: '', offset: 0, type: 'u16be' as BinaryNumberType, scale: 1 }]
    form.fields = bfs.map(f =>
      newFieldRow({
        name: f.name,
        offset: f.offset,
        binType: f.type,
        scale: f.scale ?? 1,
        bias: f.bias ?? 0,
        unit: f.unit || '',
        valueId: f.valueId || '',
      }),
    )
  } else {
    const fs = item.fields.length ? item.fields : [{ name: '', group: 1, as: 'number' as const }]
    form.fields = fs.map(f =>
      newFieldRow({
        name: f.name,
        group: f.group ?? 1,
        path: f.path || '',
        asNumber: f.as === 'number',
        unit: f.unit || '',
        valueId: f.valueId || '',
      }),
    )
  }
  showRuleModal.value = true
}

function applyPreset(kind: 'regexTemp' | 'jsonTemp' | 'binTemp') {
  if (kind === 'regexTemp') {
    form.name = '温湿度'
    form.type = 'regex'
    form.pattern = 'TEMP:([0-9.]+).*HUM:([0-9.]+)'
    form.fields = [
      newFieldRow({ name: 'temperature', group: 1, asNumber: true, unit: 'C', valueId: 'temperature' }),
      newFieldRow({ name: 'humidity', group: 2, asNumber: true, unit: '%', valueId: 'humidity' }),
    ]
    message.info('已填入正则多字段示例')
  } else if (kind === 'jsonTemp') {
    form.name = 'JSON温湿度'
    form.type = 'json'
    form.pattern = ''
    form.fields = [
      newFieldRow({ name: 'temperature', path: '$.temp', asNumber: true, unit: 'C', valueId: 'temperature' }),
      newFieldRow({ name: 'humidity', path: '$.hum', asNumber: true, unit: '%', valueId: 'humidity' }),
    ]
    message.info('已填入 JSON 多字段示例')
  } else {
    form.name = '温湿度帧'
    form.type = 'binary'
    form.syncHeader = 'AA55'
    form.lengthMode = 'fixed'
    form.fixedLength = 7
    form.idleMs = 40
    form.checksum = 'sum8'
    form.checksumEndian = 'le'
    form.fields = [
      newFieldRow({
        name: 'temperature',
        offset: 2,
        binType: 'u16be',
        scale: 0.1,
        unit: 'C',
        valueId: 'temperature',
      }),
      newFieldRow({
        name: 'humidity',
        offset: 4,
        binType: 'u16be',
        scale: 0.1,
        unit: '%',
        valueId: 'humidity',
      }),
    ]
    message.info('HEX 示例：AA5500E60190 + sum8（共 7 字节）')
  }
}

function buildRuleFromForm(id: string, enabled: boolean): ProtocolRule | null {
  if (!form.name.trim()) {
    message.warning('请填写名称')
    return null
  }
  if (form.fields.length === 0 || form.fields.length > MAX_FIELDS) {
    message.warning(`字段数需在 1–${MAX_FIELDS}`)
    return null
  }
  for (const row of form.fields) {
    if (!row.name.trim()) {
      message.warning('请填写所有字段名称')
      return null
    }
    if (form.type === 'json' && !row.path.trim()) {
      message.warning(`字段「${row.name}」请填写 JSON 路径`)
      return null
    }
  }

  if (form.type === 'binary') {
    const binaryFields: BinaryFieldDef[] = form.fields.map(row => ({
      name: row.name.trim(),
      offset: row.offset,
      type: row.binType,
      scale: row.scale,
      bias: row.bias,
      unit: row.unit,
      valueId: row.valueId.trim() || row.name.trim(),
    }))
    const checksum = applyEndianToChecksumAlgo(form.checksum, form.checksumEndian)
    return {
      id,
      name: form.name.trim(),
      type: 'binary',
      enabled,
      pattern: form.syncHeader.replace(/\s+/g, ''),
      fields: [],
      frame: {
        ...DEFAULT_FRAME_CONFIG,
        syncHeader: form.syncHeader.replace(/\s+/g, '') || undefined,
        lengthMode: form.lengthMode,
        fixedLength: form.fixedLength,
        lengthOffset: form.lengthOffset,
        lengthSize: form.lengthSize,
        lengthEndian: form.lengthEndian,
        lengthBias: form.lengthBias,
        idleMs: form.idleMs,
        checksum,
        checksumEndian: checksumNeedsEndian(checksum) ? form.checksumEndian : undefined,
      },
      binaryFields,
    }
  }

  if (form.type === 'regex' && !form.pattern.trim()) {
    message.warning('请填写正则表达式')
    return null
  }

  const fields: FieldExtract[] = form.fields.map(row => ({
    name: row.name.trim(),
    group: form.type === 'regex' ? row.group : undefined,
    path: form.type === 'json' ? row.path.trim() : undefined,
    as: row.asNumber ? 'number' : 'string',
    unit: row.unit,
    valueId: row.valueId.trim() || row.name.trim(),
  }))

  return {
    id,
    name: form.name.trim(),
    type: form.type,
    enabled,
    pattern: form.pattern,
    fields,
  }
}

function handleSubmit() {
  if (editingId.value) {
    const existing = protocolStore.rules.find(r => r.id === editingId.value)
    const rule = buildRuleFromForm(editingId.value, existing?.enabled ?? true)
    if (!rule) return
    protocolStore.updateRule(editingId.value, rule)
    message.success('规则已更新')
  } else {
    const rule = buildRuleFromForm(`rule-${Date.now()}`, true)
    if (!rule) return
    protocolStore.addRule(rule)
    message.success('规则已添加')
  }
  showRuleModal.value = false
  resetForm()
}

function handleExport() {
  if (rows.value.length === 0) {
    message.warning('当前无可导出数据')
    return
  }
  const content = JSON.stringify({
    channelId: props.channelId,
    rules: channelRules.value,
    records: rows.value,
  }, null, 2)
  void (async () => {
    try {
      const { path, via } = await exportTextToDisk({
        feature: '解析日志',
        channelId: props.channelId,
        channelLabel: channelLabel.value,
        ext: 'json',
        content,
      })
      if (via === 'appdir') {
        Modal.success({
          title: '导出完成',
          content: `文件已保存到：\n${path}`,
          okText: '打开目录',
          onOk: () => revealPath(path),
        })
      } else {
        message.success(`已触发下载：${path}`)
      }
    } catch (e: unknown) {
      message.error(String(e))
    }
  })()
}
</script>

<style scoped>
.parsed-log-view { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.help { margin-bottom: 4px; }
.toolbar { margin-bottom: 4px; }
.rule-list { max-height: 180px; overflow: auto; }
.result-table { flex: 1; }
.preset-label { font-size: 13px; color: rgba(0,0,0,0.45); }
.field-row {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 8px 10px 0;
  margin-bottom: 8px;
  background: #fafafa;
}
.field-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: rgba(0,0,0,0.65);
  margin-bottom: 4px;
}
.field-hint {
  font-size: 11px;
  color: rgba(0,0,0,0.45);
  line-height: 1.35;
  margin-top: 4px;
}
</style>
