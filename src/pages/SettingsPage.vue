<template>
  <div class="settings-page">
    <a-card title="全局设置" size="small" :bordered="false" style="max-width: 480px">
      <a-form layout="vertical">
        <a-form-item label="收发日志默认编码">
          <a-select v-model:value="settings.encoding" style="width: 220px">
            <a-select-option value="utf-8">UTF-8</a-select-option>
            <a-select-option value="gbk">GBK（含 GB2312）</a-select-option>
            <a-select-option value="hex">HEX</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="收发日志最大行数">
          <a-input-number v-model:value="settings.maxLines" :min="100" :max="100000" :step="1000" style="width: 220px" />
        </a-form-item>
        <a-form-item label="默认发送后缀">
          <a-select v-model:value="settings.defaultSuffix" style="width: 220px">
            <a-select-option value="none">无</a-select-option>
            <a-select-option value="cr">CR</a-select-option>
            <a-select-option value="lf">LF</a-select-option>
            <a-select-option value="crlf">CRLF</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="默认波特率">
          <a-select v-model:value="settings.defaultBaudRate" style="width: 220px">
            <a-select-option v-for="b in baudRates" :key="b" :value="b">{{ b }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-button type="primary" @click="handleSaveSettings">保存设置</a-button>
      </a-form>
      <a-alert
        style="margin-top: 16px"
        type="info"
        show-icon
        message="会话与工作区导入导出请到侧栏「工作区」。"
      />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useTerminalStore } from '@/stores'

const terminalStore = useTerminalStore()
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

onMounted(() => {
  const saved = localStorage.getItem('serial-tools-settings')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      Object.assign(settings, parsed)
      if ((settings.encoding as string) === 'gb2312') settings.encoding = 'gbk'
    } catch { /* ignore */ }
  }
  if ((terminalStore.encoding as string) === 'gb2312') {
    terminalStore.encoding = 'gbk'
  }
})
</script>
