<template>
  <div class="register-grid">
      <div class="rg-hint" v-if="grid.editable && grid.writeAction">
        双击「值」单元格可写值 / 编辑；支持 <code>&#123;&#123;seq&#125;&#125;</code> <code>&#123;&#123;time:ms&#125;&#125;</code> <code>&#123;&#123;rand:4&#125;&#125;</code> 变量。
      </div>
    <a-table
      size="small"
      :data-source="rows"
      :columns="columns"
      :pagination="false"
      row-key="__rk__"
      :scroll="{ x: true }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'value'">
          <span
            class="rg-value"
            :class="{ editable: canEdit }"
            :title="canEdit ? '双击修改' : ''"
            @dblclick="canEdit && openEdit(record)"
          >
            {{ formatVal(record.valueSample) }}
          </span>
        </template>
        <span v-else-if="column.key === 'name'">{{ record.name || '—' }}</span>
        <span v-else-if="column.key === 'device'">{{ record.device }}</span>
        <span v-else-if="column.key === 'addr'">{{ record.addr }}</span>
        <span v-else-if="column.key === 'unit'">{{ record.unit || '' }}</span>
        <span v-else>{{ record.row?.[column.key] ?? '—' }}</span>
      </template>
    </a-table>

    <a-empty v-if="rows.length === 0" description="暂无可展示的数据（可到参数区添加）" />

    <a-modal
      v-model:open="editOpen"
      :title="editing?.name ? `修改 ${editing.name}` : '修改值'"
      width="460px"
      :confirm-loading="writing"
      @ok="confirmWrite"
    >
      <a-form layout="vertical">
        <a-form-item label="寄存器地址">
          <a-input :value="editingAddrLabel" disabled />
        </a-form-item>
        <a-form-item label="新值（支持变量，如 &#123;&#123;seq&#125;&#125; &#123;&#123;time:ms&#125;&#125; &#123;&#123;rand:4&#125;&#125;）">
          <a-input v-model:value="editValue" placeholder="输入数值或变量表达式" @press-enter="confirmWrite" />
        </a-form-item>
        <div v-if="instanceOptions.length" class="var-hint">
          引用变量实时值：
          <a-select
            size="small"
            style="width: 220px"
            placeholder="选择变量填入其当前值"
            allow-clear
            :options="instanceOptions"
            @change="onPickVar"
          />
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { useValueBus } from '@/stores/valueBus'
import { useProtocolRuntime } from '@/protocol-ext/manager'
import { expandTxPayload } from '@/protocol/txVars'
import type { ValueSample } from '@/protocol/types'
import type { RegisterGridDef, ProtocolInstance } from '@/protocol-ext/types'

const props = defineProps<{
  channelId: string
  instanceId: string
  grid: RegisterGridDef
}>()

const valueBus = useValueBus()
const runtime = useProtocolRuntime()

const instance = computed<ProtocolInstance | undefined>(() =>
  runtime.instances.find(i => i.instanceId === props.instanceId),
)

const canEdit = computed(() => !!props.grid.editable && !!props.grid.writeAction)

interface GridRow {
  __rk__: string
  /** 展示名（源行 name，无则用变量 label） */
  name: string
  /** 设备/从站地址（用于写值） */
  device: string
  /** 寄存器地址（用于写值 / valuePattern） */
  addr: number | string
  /** 展开后每个寄存器的独立标识（含 region） */
  reg: number | string
  unit: string
  row: Record<string, unknown>
  valueId: string
  valueSample: ValueSample | undefined
}

/** 单值 key（主站 style name_start；或直接变量 key） */
function defaultValueId(name: string, reg: number | string): string {
  return `${name}_${reg}`
}

/** 依据参数行生成网格行；支持按 count 展开为多个寄存器 */
function expandParamRow(prefix: string, r: Record<string, unknown>, idx: number): GridRow[] {
  const deviceMap = props.grid.valuePattern ? '' : r.device
  const device = String(r.addr ?? r.device ?? deviceMap ?? '')
  // 寄存器基址：start 或 reg
  const base = Number(r.reg ?? r.start ?? 0)
  const count = Math.max(1, Number(r.count ?? 1) || 1)
  const name = String(r.name ?? r.label ?? `d${base}`)
  const units = String(r.unit ?? '')
  const out: GridRow[] = []
  for (let i = 0; i < count; i++) {
    const reg = base + i
    const valueId =
      props.grid.valuePattern
        ? props.grid.valuePattern
            .replace(/\{addr\}/g, String(reg))
            .replace(/\{device\}/g, device)
            .replace(/\{name\}/g, name)
        : defaultValueId(name, reg)
    out.push({
      __rk__: `${prefix}:${idx}:${i}`,
      name: count > 1 ? `${name}[${reg}]` : name,
      device,
      reg,
      addr: reg,
      unit: units,
      row: { ...r, __reg: reg, __device: device },
      valueId,
      valueSample: valueId ? valueBus.getLatest(props.channelId, valueId) : undefined,
    })
  }
  return out
}

/** 行数据：优先 paramKey 表格参数；否则用实例 variables */
const rows = computed<GridRow[]>(() => {
  const grid = props.grid
  const paramRows = grid.paramKey
    ? (instance.value?.params?.[grid.paramKey] as Record<string, unknown>[] | undefined)
    : undefined
  const list: GridRow[] = []

  if (Array.isArray(paramRows)) {
    paramRows.forEach((r, i) => list.push(...expandParamRow(grid.paramKey || 'p', r, i)))
  } else {
    for (const v of instance.value?.variables || []) {
      list.push({
        __rk__: v.key,
        name: v.label,
        device: '',
        reg: v.addr != null ? v.addr : '—',
        addr: v.addr != null ? v.addr : '—',
        unit: v.unit || '',
        row: {},
        valueId: v.key,
        valueSample: valueBus.getLatest(props.channelId, v.key),
      })
    }
  }
  return list
})

const columns = computed(() => {
  const cols: { title: string; key: string; width?: number }[] = []
  const override = props.grid.columns
  if (override && override.length) {
    for (const c of override) {
      const title = c.label || c.key
      if (c.key === 'name' || c.key === 'addr' || c.key === 'value' || c.key === 'unit' || c.key === 'device') {
        cols.push({ title, key: c.key, width: c.key === 'value' ? 90 : undefined })
      } else {
        cols.push({ title, key: c.key })
      }
    }
    return cols
  }
  cols.push({ title: '名称', key: 'name' })
  if (rows.value.some(r => r.device !== '')) cols.push({ title: '设备', key: 'device', width: 70 })
  cols.push({ title: '地址', key: 'addr', width: 70 })
  cols.push({ title: '值', key: 'value', width: 100 })
  if (rows.value.some(r => r.unit)) cols.push({ title: '单位', key: 'unit', width: 70 })
  return cols
})

function formatVal(s?: ValueSample): string {
  if (!s) return '—'
  const n = Number(s.value)
  return Number.isNaN(n) ? String(s.value) : String(n)
}

// ---------- 双击写值 / 编辑 ----------

const editOpen = ref(false)
const writing = ref(false)
const editing = ref<GridRow | null>(null)
const editValue = ref('')

let counter = 0

const instanceOptions = computed(() =>
  (instance.value?.variables || []).map(v => ({ value: v.key, label: `${v.label} (${v.key})` })),
)

function openEdit(row: GridRow) {
  editing.value = row
  editValue.value = ''
  editOpen.value = true
}

const editingAddrLabel = computed(() => {
  const e = editing.value
  if (!e) return ''
  const parts = []
  if (e.device !== '' && String(e.device) !== '—') parts.push(`从站 ${e.device}`)
  parts.push(`地址 ${e.reg}`)
  return parts.join(' · ')
})

function onPickVar(key: string | undefined) {
  if (!key || !editing.value) return
  const s = valueBus.getLatest(props.channelId, key)
  if (s) editValue.value = String(s.value)
}

async function confirmWrite() {
  const row = editing.value
  const actionId = props.grid.writeAction
  if (!row || !actionId) return
  const input = editValue.value.trim()
  if (!input) {
    message.warning('请输入值')
    return
  }
  writing.value = true
  try {
    const { payload } = expandTxPayload(input, {
      format: 'text',
      itemSeq: ++counter,
      channelSeq: 0,
    })
    const args = buildArgs(props.grid, row, payload)
    await runtime.runAction(props.instanceId, actionId, args)
    editOpen.value = false
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e))
  } finally {
    writing.value = false
  }
}

/** writeArgs 占位替换：{addr}/{reg}/{device}/{value}/{row.<key>} */
function buildArgs(grid: RegisterGridDef, row: GridRow, rawValue: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [k, tmpl] of Object.entries(grid.writeArgs || {})) {
    args[k] = tmpl
      .replace(/\{addr\}/g, String(row.reg))
      .replace(/\{reg\}/g, String(row.reg))
      .replace(/\{device\}/g, String(row.device))
      .replace(/\{value\}/g, rawValue)
      .replace(/\{row\.([A-Za-z0-9_]+)\}/g, (_, key: string) => {
        const v = row.row?.[key]
        if (v === '__reg' || v === '__device') return ''
        return v == null ? '' : String(v)
      })
  }
  if (!('value' in args)) args.value = rawValue
  return args
}
</script>

<style scoped>
.register-grid { width: 100%; }
.rg-value { font-family: Consolas, monospace; cursor: default; }
.rg-value.editable { cursor: copy; color: #1677ff; }
.rg-value.editable:hover { text-decoration: underline; }
.var-hint { color: rgba(0, 0, 0, 0.45); font-size: 12px; display: flex; align-items: center; gap: 8px; }
</style>