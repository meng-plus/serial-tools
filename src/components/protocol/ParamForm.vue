<template>
  <div class="param-form">
    <div v-for="p in params" :key="p.key" class="param-row">
      <div class="param-label">{{ p.label }}</div>
      <div class="param-control">
        <!-- number -->
        <a-input-number
          v-if="p.type === 'number'"
          :value="toNumber(modelValue[p.key])"
          :min="p.min"
          :max="p.max"
          :step="p.step"
          style="width: 100%"
          @change="(v: number | null) => update(p.key, v ?? 0)"
        />
        <!-- text -->
        <a-input
          v-else-if="p.type === 'text'"
          :value="toText(modelValue[p.key])"
          :placeholder="p.placeholder"
          @change="(e: Event) => update(p.key, (e.target as HTMLInputElement).value)"
        />
        <!-- bool -->
        <a-switch
          v-else-if="p.type === 'bool'"
          :checked="!!modelValue[p.key]"
          @change="(v: boolean) => update(p.key, !!v)"
        />
        <!-- select -->
        <a-select
          v-else-if="p.type === 'select'"
          :value="toText(modelValue[p.key])"
          :options="p.options || []"
          style="width: 100%"
          @change="(v: string) => update(p.key, v)"
        />
        <!-- multiline -->
        <a-textarea
          v-else-if="p.type === 'multiline'"
          :value="toText(modelValue[p.key])"
          :rows="4"
          :placeholder="p.placeholder"
          @change="(e: Event) => update(p.key, (e.target as HTMLTextAreaElement).value)"
        />
        <!-- password -->
        <a-input-password
          v-else-if="p.type === 'password'"
          :value="toText(modelValue[p.key])"
          :placeholder="p.placeholder"
          @change="(e: Event) => update(p.key, (e.target as HTMLInputElement).value)"
        />
        <!-- table -->
        <div v-else-if="p.type === 'table'" class="table-wrap">
          <a-table
            size="small"
            :columns="tableColumns(p)"
            :data-source="toRows(modelValue[p.key])"
            :pagination="false"
            row-key="__row__"
          >
            <template #bodyCell="{ column, record }">
              <a-input
                v-if="column.key !== '__actions__'"
                :value="toText(record[column.key])"
                @change="(e: Event) => updateCell(p, record, column.key as string, (e.target as HTMLInputElement).value)"
              />
            </template>
          </a-table>
          <a-button size="small" type="dashed" block style="margin-top: 4px" @click="addRow(p)">
            添加行
          </a-button>
        </div>
        <span v-else class="unsupported">不支持的类型</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ParamDef } from '@/protocol-ext/types'

const props = defineProps<{
  params: ParamDef[]
  modelValue: Record<string, unknown>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, unknown>): void
}>()

function toText(v: unknown): string {
  return v == null ? '' : String(v)
}

function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

function toRows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map((r, i) => ({ ...(r as Record<string, unknown>), __row__: i })) : []
}

function update(key: string, v: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: v })
}

function tableColumns(p: ParamDef) {
  const cols: { title: string; dataIndex?: string; key: string; ellipsis?: boolean; width?: number }[] =
    (p.columns || []).map(c => ({
      title: c.label,
      dataIndex: c.key,
      key: c.key,
      ellipsis: true,
    }))
  cols.push({ title: '', dataIndex: '__actions__', key: '__actions__', width: 60 })
  return cols
}

function addRow(p: ParamDef) {
  const rows = toRows(props.modelValue[p.key])
  const row: Record<string, unknown> = {}
  for (const c of p.columns || []) row[c.key] = c.default ?? ''
  rows.push(row)
  update(p.key, rows)
}

function updateCell(p: ParamDef, record: Record<string, unknown>, key: string, value: string) {
  const rows = toRows(props.modelValue[p.key])
  const idx = rows.findIndex(r => r.__row__ === record.__row__)
  if (idx < 0) return
  rows[idx] = { ...rows[idx], [key]: value }
  update(p.key, rows)
}
</script>

<style scoped>
.param-form { display: flex; flex-direction: column; gap: 12px; }
.param-row { display: flex; flex-direction: column; gap: 4px; }
.param-label { font-size: 13px; color: rgba(0, 0, 0, 0.65); }
.param-control { width: 100%; }
.table-wrap :deep(.ant-table-cell) { padding: 2px 4px !important; }
.unsupported { color: rgba(0, 0, 0, 0.35); font-size: 12px; }
</style>
