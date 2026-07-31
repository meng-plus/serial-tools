<template>
  <div class="about-page">
    <a-card :bordered="false" class="about-card">
      <div class="about-header">
        <div class="app-icon">
          <ApiOutlined style="font-size: 48px; color: #1677ff" />
        </div>
        <h1 class="app-name">Serial Tools</h1>
        <p class="app-desc">通信集成调试平台</p>
        <a-tag color="blue">v0.1.0</a-tag>
      </div>

      <a-divider />

      <div class="about-section">
        <h3>功能特性</h3>
        <a-row :gutter="[16, 12]">
          <a-col :span="12" v-for="feat in features" :key="feat.title">
            <div class="feature-item">
              <component :is="feat.icon" style="font-size: 18px; color: #1677ff; margin-right: 8px" />
              <div>
                <div class="feature-title">{{ feat.title }}</div>
                <div class="feature-desc">{{ feat.desc }}</div>
              </div>
            </div>
          </a-col>
        </a-row>
      </div>

      <a-divider />

      <div class="about-section">
        <h3>技术栈</h3>
        <a-space wrap>
          <a-tag v-for="tech in techStack" :key="tech" color="geekblue">{{ tech }}</a-tag>
        </a-space>
      </div>

      <a-divider />

      <div class="about-section">
        <h3>关于作者</h3>
        <div class="author-info">
          <div class="author-row">
            <UserOutlined style="margin-right: 8px" />
            <span class="author-name">mengplus（蒙蒙plus）</span>
          </div>
          <div class="author-row">
            <MailOutlined style="margin-right: 8px" />
            <a href="mailto:chengmeng_2@outlook.com">chengmeng_2@outlook.com</a>
          </div>
          <div class="author-row">
            <LinkOutlined style="margin-right: 8px" />
            <a href="https://gitea.mengplus.top/gltech/serial-tools" target="_blank" rel="noopener">
              Gitea 仓库
            </a>
          </div>
        </div>
      </div>

      <a-divider />

      <div class="about-section">
        <h3>开源许可</h3>
        <p class="license-text">本项目基于 MIT 许可证开源。</p>
        <p class="copyright">Copyright © 2026 mengplus</p>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import {
  ApiOutlined, UserOutlined, MailOutlined, LinkOutlined,
  SwapOutlined, CodeOutlined, FileTextOutlined, BugOutlined,
  HddOutlined,
} from '@ant-design/icons-vue'

const features = [
  { title: '多协议支持', desc: 'UART / TCP / UDP / MQTT', icon: SwapOutlined },
  { title: '数据终端', desc: 'XShell 风格，UTF-8/GBK/HEX 切换', icon: CodeOutlined },
  { title: '端口转发', desc: '任意通道间桥接，单向/双向', icon: SwapOutlined },
  { title: '协议解析', desc: 'Modbus RTU/TCP、JSON、正则', icon: BugOutlined },
  { title: '日志录制', desc: 'BIN/CSV/HEX 多格式导出', icon: FileTextOutlined },
  { title: '会话管理', desc: 'YAML 配置保存/加载', icon: HddOutlined },
]

const techStack = [
  'Rust', 'Tauri v2', 'Vue 3', 'TypeScript', 'Pinia', 'Ant Design Vue', 'tokio', 'serialport',
]
</script>

<style scoped>
.about-page {
  max-width: 720px;
  margin: 0 auto;
}
.about-card {
  border-radius: 12px;
}
.about-header {
  text-align: center;
  padding: 20px 0 0;
}
.app-icon {
  margin-bottom: 12px;
}
.app-name {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 4px;
  color: rgba(0, 0, 0, 0.88);
}
.app-desc {
  color: rgba(0, 0, 0, 0.45);
  margin: 0 0 12px;
}
.about-section h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: rgba(0, 0, 0, 0.88);
}
.feature-item {
  display: flex;
  align-items: flex-start;
}
.feature-title {
  font-weight: 500;
  font-size: 13px;
}
.feature-desc {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
.author-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.author-row {
  display: flex;
  align-items: center;
  color: rgba(0, 0, 0, 0.65);
}
.author-name {
  font-weight: 600;
  font-size: 15px;
  color: rgba(0, 0, 0, 0.88);
}
.license-text {
  color: rgba(0, 0, 0, 0.65);
  margin-bottom: 4px;
}
.copyright {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
</style>
