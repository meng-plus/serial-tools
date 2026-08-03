<template>
  <div class="settings-page">
    <a-card title="全局设置" size="small" :bordered="false" style="max-width: 560px">
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
        <a-divider>串口超时分包（默认）</a-divider>
        <a-form-item label="字节间超时 byte_timeout（ms）">
          <a-input-number v-model:value="settings.serialByteTimeoutMs" :min="5" :max="5000" :step="10" style="width: 220px" />
          <div class="hint">两字节间隔超过此值视为一包结束。仅串口生效。</div>
        </a-form-item>
        <a-form-item label="帧超时 frame_timeout（ms）">
          <a-input-number v-model:value="settings.serialFrameTimeoutMs" :min="20" :max="10000" :step="10" style="width: 220px" />
          <div class="hint">从首字节起超时强制断包。通道顶栏可覆盖。</div>
        </a-form-item>
        <a-button type="primary" @click="handleSaveSettings">保存设置</a-button>
      </a-form>
      <a-alert style="margin-top: 16px" type="info" show-icon message="会话与工作区导入导出请到侧栏「工作区」。" />
    </a-card>

    <a-card title="快捷键" size="small" :bordered="false" style="max-width: 560px; margin-top: 16px">
      <a-table size="small" :pagination="false" :columns="shortcutCols" :data-source="shortcuts" row-key="k" />
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useTerminalStore } from '@/stores'
import { loadAppSettings, saveAppSettings, type AppSettings } from '@/utils/appSettings'

const terminalStore = useTerminalStore()
const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

const settings = reactive<AppSettings>({ ...loadAppSettings() })

const shortcutCols = [
  { title: '场景', dataIndex: 'scene', width: 140 },
  { title: '快捷键', dataIndex: 'keys', width: 180 },
  { title: '说明', dataIndex: 'desc' },
]

const shortcuts = [
  { k: '1', scene: '发送', keys: 'Enter', desc: '发送；Shift+Enter 换行' },
  { k: '2', scene: '历史', keys: '↑ / ↓', desc: '光标在开头时翻历史' },
  { k: '3', scene: '字号', keys: 'Ctrl+滚轮', desc: '视图内字体 10–28' },
  { k: '4', scene: '清屏', keys: 'Ctrl+L', desc: '清空显示，不断开' },
  { k: '5', scene: 'VT100 复制', keys: 'Ctrl+Shift+C', desc: '有选区时 Ctrl+C 亦可' },
  { k: '6', scene: 'VT100 粘贴', keys: 'Ctrl+Shift+V', desc: '粘贴到终端并发送' },
  { k: '7', scene: '视图全屏', keys: 'F11', desc: '当前视图沉浸铺满窗口；再按 F11 或 Esc 退出' },
]

function handleSaveSettings() {
  saveAppSettings({ ...settings })
  terminalStore.encoding = settings.encoding
  terminalStore.maxLines = settings.maxLines
  message.success('设置已保存')
}

onMounted(() => {
  Object.assign(settings, loadAppSettings())
  if ((terminalStore.encoding as string) === 'gb2312') terminalStore.encoding = 'gbk'
})
</script>

<style scoped>
.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 4px; }
</style>
