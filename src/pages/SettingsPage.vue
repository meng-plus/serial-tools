<template>
  <div class="settings-page">
    <a-row :gutter="16">
      <a-col :span="12">
        <a-card title="全局设置" size="small" :bordered="false">
          <a-form layout="vertical">
            <a-form-item label="终端编码">
              <a-select v-model:value="settings.encoding" style="width: 200px">
                <a-select-option value="utf-8">UTF-8</a-select-option>
                <a-select-option value="gbk">GBK（含 GB2312）</a-select-option>
                <a-select-option value="hex">HEX</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="终端最大行数">
              <a-input-number v-model:value="settings.maxLines" :min="100" :max="100000" :step="1000" style="width: 200px" />
            </a-form-item>
            <a-form-item label="默认发送后缀">
              <a-select v-model:value="settings.defaultSuffix" style="width: 200px">
                <a-select-option value="none">无</a-select-option>
                <a-select-option value="cr">CR</a-select-option>
                <a-select-option value="lf">LF</a-select-option>
                <a-select-option value="crlf">CRLF</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="默认波特率">
              <a-select v-model:value="settings.defaultBaudRate" style="width: 200px">
                <a-select-option v-for="b in baudRates" :key="b" :value="b">{{ b }}</a-select-option>
              </a-select>
            </a-form-item>
            <a-button type="primary" @click="handleSaveSettings">保存设置</a-button>
          </a-form>
        </a-card>
      </a-col>

      <a-col :span="12">
        <a-card title="会话管理" size="small" :bordered="false">
          <template #extra>
            <a-button size="small" type="primary" @click="showSaveModal = true">保存当前会话</a-button>
          </template>
          <a-list :data-source="sessionStore.sessions" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>{{ item.name }}</template>
                  <template #description>修改: {{ item.modified }}</template>
                </a-list-item-meta>
                <template #actions>
                  <a-button size="small" @click="handleLoadSession(item.name)">加载</a-button>
                  <a-popconfirm title="确认删除?" @confirm="sessionStore.remove(item.name)">
                    <a-button size="small" danger>删除</a-button>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-if="sessionStore.sessions.length === 0" description="暂无保存的会话" />
        </a-card>
      </a-col>
    </a-row>

    <a-modal v-model:open="showSaveModal" title="保存会话" @ok="handleSaveSession">
      <a-form layout="vertical">
        <a-form-item label="会话名称">
          <a-input v-model:value="saveName" placeholder="例: 工位1-串口调试" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useSessionStore, useTerminalStore, useConnectionStore } from '@/stores'

const sessionStore = useSessionStore()
const terminalStore = useTerminalStore()
const connectionStore = useConnectionStore()

const showSaveModal = ref(false)
const saveName = ref('')
const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

const settings = reactive({
  encoding: 'utf-8' as 'utf-8' | 'gbk' | 'hex',
  maxLines: 10000,
  defaultSuffix: 'none',
  defaultBaudRate: 115200,
})

function handleSaveSettings() {
  localStorage.setItem('serial-tools-settings', JSON.stringify(settings))
  terminalStore.encoding = settings.encoding
  terminalStore.maxLines = settings.maxLines
  message.success('设置已保存')
}

async function handleSaveSession() {
  if (!saveName.value) {
    message.warning('请输入会话名称')
    return
  }
  const sessionData = {
    settings: { ...settings },
    connections: Array.from(connectionStore.channels.values()).map(c => ({
      channel_id: c.channelId,
      transport_type: c.transportType,
      port_name: c.portName,
    })),
  }
  await sessionStore.save(saveName.value, JSON.stringify(sessionData))
  showSaveModal.value = false
  saveName.value = ''
  message.success('会话已保存')
}

async function handleLoadSession(name: string) {
  try {
    const content = await sessionStore.load(name)
    const data = JSON.parse(content)
    if (data.settings) {
      Object.assign(settings, data.settings)
      if ((settings.encoding as string) === 'gb2312') settings.encoding = 'gbk'
      terminalStore.encoding = settings.encoding
      terminalStore.maxLines = settings.maxLines
    }
    message.success(`会话 "${name}" 已加载`)
  } catch (e: any) {
    message.error(String(e))
  }
}

onMounted(async () => {
  const saved = localStorage.getItem('serial-tools-settings')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      Object.assign(settings, parsed)
      // GBK 已覆盖 GB2312，迁移旧设置
      if ((settings.encoding as string) === 'gb2312') {
        settings.encoding = 'gbk'
      }
    } catch { /* ignore */ }
  }
  if ((terminalStore.encoding as string) === 'gb2312') {
    terminalStore.encoding = 'gbk'
  }
  await sessionStore.loadList()
})
</script>
