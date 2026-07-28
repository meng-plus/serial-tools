<template>
  <div>
    <a-card title="设置" :bordered="false">
      <a-form layout="vertical">
        <a-form-item label="缓冲区大小">
          <a-input-number v-model:value="settings.bufferSize" :min="100" :max="100000" />
        </a-form-item>
        <a-form-item label="自动刷新间隔 (ms)">
          <a-input-number v-model:value="settings.refreshInterval" :min="100" :max="5000" :step="100" />
        </a-form-item>
        <a-form-item label="编码">
          <a-select v-model:value="settings.encoding" style="width: 200px">
            <a-select-option value="utf-8">UTF-8</a-select-option>
            <a-select-option value="gbk">GBK</a-select-option>
            <a-select-option value="ascii">ASCII</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
      <a-button type="primary" @click="handleSave">保存</a-button>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import { message } from 'ant-design-vue'

const settings = reactive({
  bufferSize: 10000,
  refreshInterval: 1000,
  encoding: 'utf-8',
})

function handleSave() {
  localStorage.setItem('serial-tools-settings', JSON.stringify(settings))
  message.success('设置已保存')
}
</script>
