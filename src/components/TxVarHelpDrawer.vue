<template>
  <a-drawer
    :open="open"
    title="变量说明"
    width="520"
    placement="right"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <p class="hint">{{ hint }}</p>

    <a-collapse :bordered="false" :default-active-key="['序号', '校验']">
      <a-collapse-panel v-for="cat in TX_VAR_CATEGORIES" :key="cat" :header="cat">
        <a-list :data-source="varsByCategory[cat]" size="small" bordered>
          <template #renderItem="{ item: v }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <code>{{ v.token }}</code>
                  <a-tag size="small" style="margin-left: 8px">{{ v.scope }}</a-tag>
                </template>
                <template #description>
                  <div>{{ v.description }}</div>
                  <div class="ex">文本：<code>{{ v.textExample }}</code></div>
                  <div class="ex">HEX：<code>{{ v.hexExample }}</code></div>
                </template>
              </a-list-item-meta>
              <template #actions>
                <a @click="emit('insert', v.token)">插入</a>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-collapse-panel>
    </a-collapse>
  </a-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  TX_VAR_CATALOG,
  TX_VAR_CATEGORIES,
  type TxVarCategory,
} from '@/protocol/txVars'

withDefaults(
  defineProps<{
    open: boolean
    /** 抽屉顶部说明，可按场景定制 */
    hint?: string
  }>(),
  {
    hint: '点击「插入」写入当前输入内容末尾。条目序号与通道序号相互独立。',
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  insert: [token: string]
}>()

const varsByCategory = computed(() => {
  const map: Record<TxVarCategory, typeof TX_VAR_CATALOG> = {
    序号: [],
    时间: [],
    校验: [],
    随机: [],
  }
  for (const v of TX_VAR_CATALOG) {
    map[v.category].push(v)
  }
  return map
})
</script>

<style scoped>
.hint {
  color: rgba(0, 0, 0, 0.45);
  margin-bottom: 12px;
}
.ex {
  margin-top: 4px;
  font-size: 12px;
}
code {
  font-size: 12px;
}
</style>
