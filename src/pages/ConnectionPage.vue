<template>
  <div>
    <a-card title="通信连接" :bordered="false">
      <a-form layout="vertical">
        <a-form-item label="连接类型">
          <a-select v-model:value="form.conn_type" style="width: 200px">
            <a-select-option value="serial">串口 (UART/RS485)</a-select-option>
            <a-select-option value="tcp_client">TCP 客户端</a-select-option>
            <a-select-option value="tcp_server">TCP 服务端</a-select-option>
            <a-select-option value="mqtt">MQTT</a-select-option>
          </a-select>
        </a-form-item>

        <template v-if="form.conn_type === 'serial'">
          <a-form-item label="串口">
            <a-select v-model:value="form.port" style="width: 300px" placeholder="选择串口">
              <a-select-option v-for="p in connectionStore.ports" :key="p.name" :value="p.name">
                {{ p.name }} - {{ p.description }}
              </a-select-option>
            </a-select>
            <a-button style="margin-left: 8px" @click="connectionStore.loadPorts()">刷新</a-button>
          </a-form-item>
          <a-form-item label="波特率">
            <a-select v-model:value="form.baud_rate" style="width: 200px">
              <a-select-option :value="9600">9600</a-select-option>
              <a-select-option :value="19200">19200</a-select-option>
              <a-select-option :value="38400">38400</a-select-option>
              <a-select-option :value="57600">57600</a-select-option>
              <a-select-option :value="115200">115200</a-select-option>
              <a-select-option :value="230400">230400</a-select-option>
              <a-select-option :value="460800">460800</a-select-option>
              <a-select-option :value="921600">921600</a-select-option>
            </a-select>
          </a-form-item>
        </template>

        <template v-if="form.conn_type === 'tcp_client'">
          <a-form-item label="主机地址">
            <a-input v-model:value="form.host" style="width: 300px" placeholder="192.168.1.100" />
          </a-form-item>
          <a-form-item label="端口">
            <a-input-number v-model:value="form.tcp_port" :min="1" :max="65535" style="width: 200px" />
          </a-form-item>
        </template>
      </a-form>

      <a-space>
        <a-button type="primary" :loading="connecting" @click="handleConnect">
          {{ connectionStore.connected ? '断开' : '连接' }}
        </a-button>
        <a-tag :color="connectionStore.connected ? 'success' : 'default'">
          {{ connectionStore.connected ? '已连接' : '未连接' }}
        </a-tag>
      </a-space>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useConnectionStore } from '@/stores'

const connectionStore = useConnectionStore()
const connecting = ref(false)

const form = reactive({
  conn_type: 'serial',
  port: '',
  baud_rate: 115200,
  host: '192.168.1.100',
  tcp_port: 5000,
})

async function handleConnect() {
  connecting.value = true
  try {
    if (connectionStore.connected) {
      await connectionStore.disconnect()
    } else {
      await connectionStore.connect({
        conn_type: form.conn_type,
        port: form.port,
        baud_rate: form.baud_rate,
        host: form.host,
        tcp_port: form.tcp_port,
      })
    }
  } finally {
    connecting.value = false
  }
}
</script>
