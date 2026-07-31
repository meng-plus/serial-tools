<template>
  <div class="parsed-log-view">
    <a-alert
      type="info"
      show-icon
      class="help"
      message="怎么测：保存规则 → 在「收发日志」用 HEX/文本发送示例报文 → 匹配结果出现在本页。二进制规则会自动分帧（定界符 + 超时兜底）。"
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
      width="640px"
      @ok="handleSubmit"
      @cancel="resetForm"
    >
      <a-space wrap style="margin-bottom: 12px">
        <span class="preset-label">填入示例：</span>
        <a-button size="small" @click="applyPreset('regexTemp')">正则 · 温度</a-button>
        <a-button size="small" @click="applyPreset('jsonTemp')">JSON · 温度</a-button>
        <a-button size="small" @click="applyPreset('binTemp')">二进制 · AA55 温湿度</a-button>
      </a-space>

      <a-alert type="success" show-icon style="margin-bottom: 12px" :message="helpText" />

      <a-form layout="vertical">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="例: 温度" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.type">
            <a-select-option value="regex">正则（文本）</a-select-option>
            <a-select-option value="json">JSON（文本）</a-select-option>
            <a-select-option value="binary">二进制（厂家帧）</a-select-option>
          </a-select>
        </a-form-item>

        <template v-if="form.type === 'regex'">
          <a-form-item label="正则表达式" required>
            <a-input v-model:value="form.pattern" placeholder="TEMP:([0-9.]+)" />
          </a-form-item>
          <a-form-item label="字段名" required>
            <a-input v-model:value="form.fieldName" />
          </a-form-item>
          <a-form-item label="捕获组序号">
            <a-input-number v-model:value="form.group" :min="1" />
          </a-form-item>
        </template>

        <template v-else-if="form.type === 'json'">
          <a-form-item label="过滤路径（可选）">
            <a-input v-model:value="form.pattern" placeholder="留空或 $.status" />
          </a-form-item>
          <a-form-item label="字段名" required>
            <a-input v-model:value="form.fieldName" />
          </a-form-item>
          <a-form-item label="JSON 路径" required>
            <a-input v-model:value="form.path" placeholder="$.temp" />
          </a-form-item>
        </template>

        <template v-else>
          <a-form-item label="同步头 HEX（可选）">
            <a-input v-model:value="form.syncHeader" placeholder="AA55" />
          </a-form-item>
          <a-form-item label="长度模式">
            <a-select v-model:value="form.lengthMode">
              <a-select-option value="fixed">定长</a-select-option>
              <a-select-option value="field">长度域</a-select-option>
              <a-select-option value="idle">仅超时拼包</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item v-if="form.lengthMode === 'fixed'" label="定长（字节）">
            <a-input-number v-model:value="form.fixedLength" :min="1" />
          </a-form-item>
          <template v-if="form.lengthMode === 'field'">
            <a-form-item label="长度域偏移">
              <a-input-number v-model:value="form.lengthOffset" :min="0" />
            </a-form-item>
            <a-form-item label="长度域字节数">
              <a-select v-model:value="form.lengthSize" style="width: 120px">
                <a-select-option :value="1">1</a-select-option>
                <a-select-option :value="2">2</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="lengthBias（总长=域值+bias）">
              <a-input-number v-model:value="form.lengthBias" />
            </a-form-item>
          </template>
          <a-form-item label="静默超时 idleMs">
            <a-input-number v-model:value="form.idleMs" :min="10" :step="10" />
          </a-form-item>
          <a-form-item label="校验算法">
            <a-select v-model:value="form.checksum" style="width: 100%">
              <a-select-option v-for="c in CHECKSUM_CATALOG" :key="c.id" :value="c.id">
                {{ c.name }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-divider>字段 1</a-divider>
          <a-form-item label="字段名" required>
            <a-input v-model:value="form.fieldName" />
          </a-form-item>
          <a-form-item label="偏移">
            <a-input-number v-model:value="form.binOffset" :min="0" />
          </a-form-item>
          <a-form-item label="类型">
            <a-select v-model:value="form.binType" style="width: 100%">
              <a-select-option v-for="t in BIN_TYPES" :key="t" :value="t">{{ t }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="scale（×）">
            <a-input-number v-model:value="form.scale" :step="0.1" />
          </a-form-item>
          <a-divider>字段 2（可选）</a-divider>
          <a-form-item label="字段名">
            <a-input v-model:value="form.fieldName2" placeholder="留空则只有一个字段" />
          </a-form-item>
          <a-form-item label="偏移">
            <a-input-number v-model:value="form.binOffset2" :min="0" />
          </a-form-item>
          <a-form-item label="类型">
            <a-select v-model:value="form.binType2" style="width: 100%">
              <a-select-option v-for="t in BIN_TYPES" :key="t" :value="t">{{ t }}</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="scale（×）">
            <a-input-number v-model:value="form.scale2" :step="0.1" />
          </a-form-item>
        </template>

        <a-form-item v-if="form.type !== 'binary'" label="转为数值（供监控/图表）">
          <a-switch v-model:checked="form.asNumber" />
        </a-form-item>
        <a-form-item label="单位">
          <a-input v-model:value="form.unit" placeholder="C" />
        </a-form-item>
        <a-form-item label="valueId（字段1）">
          <a-input v-model:value="form.valueId" placeholder="默认与字段名相同" />
        </a-form-item>
        <a-form-item v-if="form.type === 'binary' && form.fieldName2" label="单位（字段2）">
          <a-input v-model:value="form.unit2" />
        </a-form-item>
        <a-form-item v-if="form.type === 'binary' && form.fieldName2" label="valueId（字段2）">
          <a-input v-model:value="form.valueId2" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useProtocolStore } from '@/stores'
import type { BinaryNumberType, ProtocolRule, RuleType } from '@/protocol/types'
import { CHECKSUM_CATALOG, type ChecksumAlgo } from '@/protocol/checksum'
import { DEFAULT_FRAME_CONFIG, type LengthMode } from '@/protocol/binaryFramer'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'

const props = defineProps<{ channelId: string }>()
const protocolStore = useProtocolStore()
const connectionStore = useConnectionStore()

const BIN_TYPES: BinaryNumberType[] = [
  'u8', 'i8', 'u16le', 'u16be', 'i16le', 'i16be',
  'u32le', 'u32be', 'i32le', 'i32be', 'f32le', 'f32be',
]

const showRuleModal = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  type: 'regex' as RuleType,
  pattern: '',
  fieldName: '',
  group: 1,
  path: '',
  asNumber: true,
  unit: '',
  valueId: '',
  syncHeader: 'AA55',
  lengthMode: 'fixed' as LengthMode,
  fixedLength: 7,
  lengthOffset: 2,
  lengthSize: 1 as 1 | 2,
  lengthBias: 0,
  idleMs: 40,
  checksum: 'sum8' as ChecksumAlgo,
  binOffset: 2,
  binType: 'u16be' as BinaryNumberType,
  scale: 0.1,
  fieldName2: '',
  binOffset2: 4,
  binType2: 'u16be' as BinaryNumberType,
  scale2: 0.1,
  unit2: '',
  valueId2: '',
})

const channelRules = computed(() => protocolStore.rulesForChannel(props.channelId))
const rows = computed(() => [...protocolStore.parsedForChannel(props.channelId)].reverse())
const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const helpText = computed(() => {
  if (form.type === 'regex') return '测试发送 UTF-8：TEMP:23.5 OK → temperature=23.5'
  if (form.type === 'json') return '测试发送：{"temp":36.6}，路径 $.temp'
  return '测试发送 HEX：AA 55 00 E6 01 90 + sum8；头 AA55，定长含校验。字段偏移 2/4 为 u16be×0.1 → 23.0C / 40.0%'
})

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 110 },
  { title: '规则', dataIndex: 'ruleName', width: 100 },
  { title: '内容', dataIndex: 'content', ellipsis: true },
  { title: '字段', key: 'fields', width: 220 },
]

function describeRule(item: ProtocolRule): string {
  if (item.type === 'binary') {
    const head = item.frame?.syncHeader || item.pattern || '(无头)'
    const n = item.binaryFields?.length ?? 0
    return `${head} · ${item.frame?.lengthMode || 'idle'} · ${n} 字段 · ${item.frame?.checksum || 'none'}`
  }
  const f = item.fields[0]
  if (!f) return item.pattern || '(无字段)'
  if (item.type === 'regex') return `${item.pattern} → 组${f.group ?? 1} → ${f.name}`
  return `${f.path || f.name} → ${f.name}`
}

function resetForm() {
  editingId.value = null
  form.name = ''
  form.type = 'regex'
  form.pattern = ''
  form.fieldName = ''
  form.group = 1
  form.path = ''
  form.asNumber = true
  form.unit = ''
  form.valueId = ''
  form.syncHeader = 'AA55'
  form.lengthMode = 'fixed'
  form.fixedLength = 7
  form.idleMs = 40
  form.checksum = 'sum8'
  form.binOffset = 2
  form.binType = 'u16be'
  form.scale = 0.1
  form.fieldName2 = ''
  form.binOffset2 = 4
  form.binType2 = 'u16be'
  form.scale2 = 0.1
  form.unit2 = ''
  form.valueId2 = ''
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
    const f = item.binaryFields?.[0]
    const f2 = item.binaryFields?.[1]
    form.syncHeader = item.frame?.syncHeader || item.pattern || ''
    form.lengthMode = item.frame?.lengthMode || 'fixed'
    form.fixedLength = item.frame?.fixedLength || 7
    form.lengthOffset = item.frame?.lengthOffset ?? 2
    form.lengthSize = (item.frame?.lengthSize as 1 | 2) || 1
    form.lengthBias = item.frame?.lengthBias ?? 0
    form.idleMs = item.frame?.idleMs ?? 40
    form.checksum = item.frame?.checksum || 'none'
    form.fieldName = f?.name || ''
    form.binOffset = f?.offset ?? 0
    form.binType = f?.type || 'u16be'
    form.scale = f?.scale ?? 1
    form.unit = f?.unit || ''
    form.valueId = f?.valueId || ''
    form.fieldName2 = f2?.name || ''
    form.binOffset2 = f2?.offset ?? 0
    form.binType2 = f2?.type || 'u16be'
    form.scale2 = f2?.scale ?? 1
    form.unit2 = f2?.unit || ''
    form.valueId2 = f2?.valueId || ''
  } else {
    const f = item.fields[0]
    form.fieldName = f?.name || ''
    form.group = f?.group ?? 1
    form.path = f?.path || ''
    form.asNumber = f?.as === 'number'
    form.unit = f?.unit || ''
    form.valueId = f?.valueId || ''
  }
  showRuleModal.value = true
}

function applyPreset(kind: 'regexTemp' | 'jsonTemp' | 'binTemp') {
  if (kind === 'regexTemp') {
    form.name = '温度'
    form.type = 'regex'
    form.pattern = 'TEMP:([0-9.]+)'
    form.fieldName = 'temperature'
    form.group = 1
    form.asNumber = true
    form.unit = 'C'
    form.valueId = 'temperature'
    message.info('已填入正则示例')
  } else if (kind === 'jsonTemp') {
    form.name = 'JSON温度'
    form.type = 'json'
    form.pattern = ''
    form.fieldName = 'temperature'
    form.path = '$.temp'
    form.asNumber = true
    form.unit = 'C'
    form.valueId = 'temperature'
    message.info('已填入 JSON 示例')
  } else {
    form.name = '温湿度帧'
    form.type = 'binary'
    form.syncHeader = 'AA55'
    form.lengthMode = 'fixed'
    form.fixedLength = 7
    form.idleMs = 40
    form.checksum = 'sum8'
    form.fieldName = 'temperature'
    form.binOffset = 2
    form.binType = 'u16be'
    form.scale = 0.1
    form.unit = 'C'
    form.valueId = 'temperature'
    form.fieldName2 = 'humidity'
    form.binOffset2 = 4
    form.binType2 = 'u16be'
    form.scale2 = 0.1
    form.unit2 = '%'
    form.valueId2 = 'humidity'
    message.info('HEX 示例：AA5500E60190 + sum8（共 7 字节）')
  }
}

function buildRuleFromForm(id: string, enabled: boolean): ProtocolRule | null {
  if (!form.name.trim()) {
    message.warning('请填写名称')
    return null
  }
  if (form.type === 'binary') {
    if (!form.fieldName.trim()) {
      message.warning('请填写至少一个字段名')
      return null
    }
    const binaryFields = [
      {
        name: form.fieldName.trim(),
        offset: form.binOffset,
        type: form.binType,
        scale: form.scale,
        unit: form.unit,
        valueId: form.valueId.trim() || form.fieldName.trim(),
      },
    ]
    if (form.fieldName2.trim()) {
      binaryFields.push({
        name: form.fieldName2.trim(),
        offset: form.binOffset2,
        type: form.binType2,
        scale: form.scale2,
        unit: form.unit2,
        valueId: form.valueId2.trim() || form.fieldName2.trim(),
      })
    }
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
        lengthBias: form.lengthBias,
        idleMs: form.idleMs,
        checksum: form.checksum,
      },
      binaryFields,
    }
  }
  if (!form.fieldName.trim()) {
    message.warning('请填写名称和字段名')
    return null
  }
  if (form.type === 'regex' && !form.pattern.trim()) {
    message.warning('请填写正则表达式')
    return null
  }
  return {
    id,
    name: form.name.trim(),
    type: form.type,
    enabled,
    pattern: form.pattern,
    fields: [{
      name: form.fieldName.trim(),
      group: form.type === 'regex' ? form.group : undefined,
      path: form.type === 'json' ? (form.path.trim() || form.fieldName.trim()) : undefined,
      as: form.asNumber ? 'number' : 'string',
      unit: form.unit,
      valueId: form.valueId.trim() || form.fieldName.trim(),
    }],
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
</style>
