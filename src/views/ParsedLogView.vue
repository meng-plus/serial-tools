<template>
  <div class="parsed-log-view">
    <a-alert
      type="info"
      show-icon
      class="help"
      message="怎么测：先选示例填好规则并保存 → 在「收发日志」向本通道发送下方示例报文 → 匹配结果出现在本页表格。"
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
      width="560px"
      @ok="handleSubmit"
      @cancel="resetForm"
    >
      <a-space wrap style="margin-bottom: 12px">
        <span class="preset-label">填入示例：</span>
        <a-button size="small" @click="applyPreset('regexTemp')">正则 · 温度</a-button>
        <a-button size="small" @click="applyPreset('jsonTemp')">JSON · 温度</a-button>
      </a-space>

      <a-alert
        v-if="form.type === 'regex'"
        type="success"
        show-icon
        style="margin-bottom: 12px"
        :message="regexHelp"
      />
      <a-alert
        v-else
        type="success"
        show-icon
        style="margin-bottom: 12px"
        :message="jsonHelp"
      />

      <a-form layout="vertical">
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="例: 温度" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.type">
            <a-select-option value="regex">正则（文本里抠数字/片段）</a-select-option>
            <a-select-option value="json">JSON（整行是 JSON 对象）</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item v-if="form.type === 'regex'" label="正则表达式" required>
          <a-input v-model:value="form.pattern" placeholder="TEMP:([0-9.]+)" />
          <div class="field-hint">用圆括号 () 包住要提取的部分，默认取第 1 个捕获组。</div>
        </a-form-item>
        <a-form-item v-else label="过滤路径（可选）">
          <a-input v-model:value="form.pattern" placeholder="留空；或以 $.status 要求该字段存在" />
        </a-form-item>
        <a-form-item label="字段名" required>
          <a-input v-model:value="form.fieldName" placeholder="temperature" />
        </a-form-item>
        <a-form-item v-if="form.type === 'regex'" label="捕获组序号">
          <a-input-number v-model:value="form.group" :min="1" />
          <div class="field-hint">对应正则里第几个 ()，一般填 1。</div>
        </a-form-item>
        <a-form-item v-else label="JSON 路径" required>
          <a-input v-model:value="form.path" placeholder="$.temp 或 temp" />
          <div class="field-hint">根级键写 temp 或 $.temp；嵌套如 $.sensor.temp。</div>
        </a-form-item>
        <a-form-item label="转为数值（供监控/图表）">
          <a-switch v-model:checked="form.asNumber" />
        </a-form-item>
        <a-form-item label="单位">
          <a-input v-model:value="form.unit" placeholder="C" />
        </a-form-item>
        <a-form-item label="valueId">
          <a-input v-model:value="form.valueId" placeholder="默认与字段名相同" />
          <div class="field-hint">监控页按此 ID 显示；可不填。</div>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConnectionStore, useProtocolStore } from '@/stores'
import type { ProtocolRule } from '@/protocol/types'
import { exportTextToDisk, revealPath } from '@/utils/diskLog'

const props = defineProps<{ channelId: string }>()
const protocolStore = useProtocolStore()
const connectionStore = useConnectionStore()

const showRuleModal = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  type: 'regex' as 'regex' | 'json',
  pattern: '',
  fieldName: '',
  group: 1,
  path: '',
  asNumber: true,
  unit: '',
  valueId: '',
})

const channelRules = computed(() => protocolStore.rulesForChannel(props.channelId))
const rows = computed(() => [...protocolStore.parsedForChannel(props.channelId)].reverse())
const channelLabel = computed(() => {
  const ch = connectionStore.channelList.find(c => c.channelId === props.channelId)
  return ch?.portName || props.channelId
})

const regexHelp = computed(
  () =>
    '测试发送（收发日志，UTF-8 文本）：TEMP:23.5 OK\n' +
    '期望提取 temperature=23.5 C',
)
const jsonHelp = computed(
  () =>
    '测试发送（收发日志，UTF-8 文本）：{"temp":36.6,"unit":"C"}\n' +
    '路径填 $.temp，期望提取 36.6',
)

const columns = [
  { title: '时间', dataIndex: 'timestamp', width: 110 },
  { title: '规则', dataIndex: 'ruleName', width: 100 },
  { title: '内容', dataIndex: 'content', ellipsis: true },
  { title: '字段', key: 'fields', width: 220 },
]

function describeRule(item: ProtocolRule): string {
  const f = item.fields[0]
  if (!f) return item.pattern || '(无字段)'
  if (item.type === 'regex') {
    return `${item.pattern} → 组${f.group ?? 1} → ${f.name}`
  }
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
}

function openCreate() {
  resetForm()
  showRuleModal.value = true
}

function openEdit(item: ProtocolRule) {
  editingId.value = item.id
  const f = item.fields[0]
  form.name = item.name
  form.type = item.type
  form.pattern = item.pattern || ''
  form.fieldName = f?.name || ''
  form.group = f?.group ?? 1
  form.path = f?.path || ''
  form.asNumber = f?.as === 'number'
  form.unit = f?.unit || ''
  form.valueId = f?.valueId || ''
  showRuleModal.value = true
}

function applyPreset(kind: 'regexTemp' | 'jsonTemp') {
  if (kind === 'regexTemp') {
    form.name = '温度'
    form.type = 'regex'
    form.pattern = 'TEMP:([0-9.]+)'
    form.fieldName = 'temperature'
    form.group = 1
    form.path = ''
    form.asNumber = true
    form.unit = 'C'
    form.valueId = 'temperature'
    message.info('已填入正则示例，保存后请发送：TEMP:23.5 OK')
  } else {
    form.name = 'JSON温度'
    form.type = 'json'
    form.pattern = ''
    form.fieldName = 'temperature'
    form.group = 1
    form.path = '$.temp'
    form.asNumber = true
    form.unit = 'C'
    form.valueId = 'temperature'
    message.info('已填入 JSON 示例，保存后请发送：{"temp":36.6}')
  }
}

function buildRuleFromForm(id: string, enabled: boolean): ProtocolRule | null {
  if (!form.name.trim() || !form.fieldName.trim()) {
    message.warning('请填写名称和字段名')
    return null
  }
  if (form.type === 'regex' && !form.pattern.trim()) {
    message.warning('请填写正则表达式')
    return null
  }
  if (form.type === 'json' && !(form.path || form.fieldName).trim()) {
    message.warning('请填写 JSON 路径')
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
.field-hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 4px; }
</style>
