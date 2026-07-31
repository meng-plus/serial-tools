<template>
  <div class="protocol-page">
    <a-result
      status="info"
      title="协议解析已迁至通道工作区"
      sub-title="请在侧栏打开通道 →「解析日志」视图配置正则 / JSON / 厂家二进制规则。本页路由仅保留兼容跳转。"
    >
      <template #extra>
        <a-button type="primary" @click="$router.push('/connection')">前往连接管理</a-button>
      </template>
    </a-result>
  </div>
</template>

<style scoped>
.protocol-page { padding: 48px 24px; }
</style>
