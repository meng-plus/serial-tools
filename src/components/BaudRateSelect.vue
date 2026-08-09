<template>
  <a-select
    :value="modelValue"
    show-search
    :options="options"
    :style="style"
    :placeholder="placeholder"
    :filter-option="filterOption"
    @update:value="onSelect"
    @search="onSearch"
    @blur="commitSearch"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { message } from 'ant-design-vue'
import { baudRateSelectOptions, parseBaudRate } from '@/utils/baudRate'

const props = withDefaults(
  defineProps<{
    modelValue: number
    style?: string | Record<string, string>
    placeholder?: string
  }>(),
  {
    style: 'width: 100%',
    placeholder: '选择或输入波特率',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const searchText = ref('')

const options = computed(() =>
  baudRateSelectOptions(props.modelValue, parseBaudRate(searchText.value)),
)

function filterOption(input: string, option: { label?: string; value?: number }) {
  const q = input.trim()
  if (!q) return true
  if (option?.value != null && String(option.value) === q) return true
  return String(option?.label ?? '').includes(q)
}

function onSearch(v: string) {
  searchText.value = v
}

function onSelect(v: number) {
  emit('update:modelValue', v)
  searchText.value = ''
}

function commitSearch() {
  const raw = searchText.value.trim()
  if (!raw) return
  const n = parseBaudRate(raw)
  if (n == null) {
    message.warning('请输入有效的正整数波特率')
    searchText.value = ''
    return
  }
  if (n !== props.modelValue) emit('update:modelValue', n)
  searchText.value = ''
}
</script>
