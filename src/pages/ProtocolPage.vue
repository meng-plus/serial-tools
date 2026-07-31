<template>
  <div class="protocol-page">
    <a-row :gutter="16">
      <a-col :span="8">
        <a-card title="解析规则" size="small" :bordered="false">
          <template #extra>
            <a-button size="small" type="primary" @click="showRuleModal = true">添加规则</a-button>
          </template>
          <a-list :data-source="rules" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>{{ item.name }}</template>
                  <template #description>
                    <a-tag size="small">{{ item.type }}</a-tag>
                    <span v-if="item.type === 'modbus_rtu'">Slave: {{ item.config.slaveId }}</span>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-switch v-model:checked="item.enabled" size="small" />
                  <a-button size="small" danger text @click="removeRule(item.id)">删除</a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-if="rules.length === 0" description="暂无规则" />
        </a-card>
      </a-col>

      <a-col :span="16">
        <a-card title="解析结果" size="small" :bordered="false">
          <template #extra>
            <a-space>
              <a-select v-model:value="filterChannel" style="width: 160px" placeholder="全部通道" allowClear size="small">
                <a-select-option v-for="ch in connectedChannels" :key="ch.channelId" :value="ch.channelId">
                  {{ ch.channelId }}
                </a-select-option>
              </a-select>
              <a-button size="small" @click="fetchResults">刷新</a-button>
              <a-button size="small" @click="handleClear">清空</a-button>
            </a-space>
          </template>
          <a-table
            :columns="resultColumns"
            :data-source="parsedResults"
            :pagination="{ pageSize: 50 }"
            size="small"
            :scroll="{ y: 400 }"
            row-key="timestamp"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'fields'">
                <a-tag v-for="f in record.fields" :key="f.name" size="small">
                  {{ f.name }}={{ f.value }}{{ f.unit }}
                </a-tag>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-col>
    </a-row>

    <a-modal v-model:open="showRuleModal" title="添加解析规则" @ok="handleAddRule" width="500px">
      <a-form layout="vertical" :model="newRule">
        <a-form-item label="规则名称">
          <a-input v-model:value="newRule.name" placeholder="例: Modbus Slave 1" />
        </a-form-item>
        <a-form-item label="协议类型">
          <a-select v-model:value="newRule.type">
            <a-select-option value="modbus_rtu">Modbus RTU</a-select-option>
            <a-select-option value="modbus_tcp">Modbus TCP</a-select-option>
            <a-select-option value="json">JSON</a-select-option>
            <a-select-option value="regex">正则表达式</a-select-option>
          </a-select>
        </a-form-item>
        <template v-if="newRule.type === 'modbus_rtu' || newRule.type === 'modbus_tcp'">
          <a-form-item label="Slave ID">
            <a-input-number v-model:value="newRule.config.slaveId" :min="1" :max="247" />
          </a-form-item>
        </template>
        <template v-if="newRule.type === 'regex'">
          <a-form-item label="正则表达式">
            <a-input v-model:value="newRule.config.pattern" placeholder="TEMP:(\\d+\\.\\d+)" />
          </a-form-item>
        </template>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { invoke } from '@/api'
import { useConnectionStore } from '@/stores'

const connectionStore = useConnectionStore()
const connectedChannels = computed(() => connectionStore.connectedChannels)

interface ProtocolRule {
  id: string
  name: string
  type: string
  enabled: boolean
  config: Record<string, any>
}

const rules = ref<ProtocolRule[]>([])
const parsedResults = ref<any[]>([])
const filterChannel = ref<string | undefined>(undefined)
const showRuleModal = ref(false)

const newRule = reactive({
  name: '',
  type: 'modbus_rtu',
  config: {} as Record<string, any>,
})

const resultColumns = [
  { title: '时间', dataIndex: 'timestamp', width: 120 },
  { title: '来源', dataIndex: 'source', width: 100 },
  { title: '规则', dataIndex: 'rule_id', width: 120 },
  { title: '内容', dataIndex: 'content', ellipsis: true },
  { title: '字段', key: 'fields', width: 200 },
]

function handleAddRule() {
  rules.value.push({
    id: Date.now().toString(),
    name: newRule.name || `${newRule.type} 规则`,
    type: newRule.type,
    enabled: true,
    config: { ...newRule.config },
  })
  showRuleModal.value = false
  newRule.name = ''
  newRule.config = {}
}

function removeRule(id: string) {
  rules.value = rules.value.filter(r => r.id !== id)
}

async function fetchResults() {
  try {
    parsedResults.value = await invoke('get_parsed_results', { limit: 200 })
  } catch { /* ignore */ }
}

async function handleClear() {
  await invoke('clear_parsed')
  parsedResults.value = []
}

onMounted(fetchResults)
</script>
