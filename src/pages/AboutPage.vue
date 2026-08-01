<template>
  <div class="about-page">
    <a-card :bordered="false" class="about-card">
      <div class="about-header">
        <img src="/app-icon.png" alt="Serial Tools" class="app-logo" />
        <div class="header-text">
          <h1 class="app-name">Serial Tools</h1>
          <span class="app-desc">通信集成调试平台</span>
          <a-tag color="blue" class="ver-tag">{{ APP_VERSION_LABEL }}</a-tag>
          <span class="build-meta">{{ APP_GIT_HASH_SHORT }} · {{ APP_BUILD_DATE }}</span>
        </div>
      </div>

      <a-divider class="section-divider" />

      <div class="about-section">
        <h3>功能特性</h3>
        <a-row :gutter="[20, 16]">
          <a-col :span="12" v-for="feat in features" :key="feat.title">
            <div class="feature-item">
              <component :is="feat.icon" class="feat-icon" />
              <div>
                <div class="feature-title">{{ feat.title }}</div>
                <div class="feature-desc">{{ feat.desc }}</div>
              </div>
            </div>
          </a-col>
        </a-row>
      </div>

      <a-divider class="section-divider" />

      <div class="about-section">
        <h3>技术栈</h3>
        <a-space wrap :size="[8, 8]">
          <a-tag v-for="tech in techStack" :key="tech" color="geekblue">{{ tech }}</a-tag>
        </a-space>
      </div>

      <a-divider class="section-divider" />

      <div class="about-section about-footer">
        <div class="author-info">
          <span><UserOutlined /> mengplus（蒙蒙plus）</span>
          <a href="mailto:chengmeng_2@outlook.com"><MailOutlined /> chengmeng_2@outlook.com</a>
          <a class="qq-link" href="#" @click.prevent="joinQqGroup" title="点击尝试打开 QQ 加群，失败则复制群号">
            <TeamOutlined /> QQ群 {{ QQ_GROUP }}
          </a>
        </div>
        <div class="license-line">MIT · Copyright © 2026 mengplus</div>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import {
  UserOutlined, MailOutlined, TeamOutlined,
  SwapOutlined, CodeOutlined, FileTextOutlined, BugOutlined,
  HddOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { isTauri } from '@/api/tauri'
import { APP_VERSION_LABEL, APP_GIT_HASH_SHORT, APP_BUILD_DATE } from '@/buildInfo'

const QQ_GROUP = '790012859'
/** QQ 客户端加群协议（无邀请码时尽力打开群资料） */
const QQ_GROUP_URI =
  `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${QQ_GROUP}&card_type=group&source=qrcode`

const features = [
  { title: '多协议支持', desc: 'UART / TCP Client / TCP Server', icon: SwapOutlined },
  { title: '数据终端', desc: '事件驱动，UTF-8 / GBK / HEX', icon: CodeOutlined },
  { title: '端口转发', desc: '数据总线：点对点 / 广播 / 双向', icon: SwapOutlined },
  { title: '协议解析', desc: '正则 / JSON / 厂家二进制帧', icon: BugOutlined },
  { title: '系统日志', desc: '分级日志流；导出能力规划中', icon: FileTextOutlined },
  { title: '会话管理', desc: 'YAML 配置保存 / 加载', icon: HddOutlined },
]

const techStack = [
  'Rust', 'Tauri v2', 'Vue 3', 'TypeScript', 'Pinia', 'Ant Design Vue', 'tokio', 'serialport',
]

async function copyGroupId() {
  try {
    await navigator.clipboard.writeText(QQ_GROUP)
    message.success(`群号 ${QQ_GROUP} 已复制，可在 QQ 中搜索加群`)
  } catch {
    message.info(`QQ 群号：${QQ_GROUP}`)
  }
}

async function joinQqGroup() {
  let opened = false
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(QQ_GROUP_URI)
      opened = true
    } catch {
      // shell 可能不允许自定义协议，回退复制
    }
  }
  if (opened) {
    message.success('正在唤起 QQ…若未打开请手动搜索群号')
    // 同时复制，防止唤起失败
    try { await navigator.clipboard.writeText(QQ_GROUP) } catch { /* ignore */ }
  } else {
    await copyGroupId()
  }
}
</script>

<style scoped>
.about-page {
  max-width: 820px;
  margin: 0 auto;
}
.about-card {
  border-radius: 12px;
}
.about-card :deep(.ant-card-body) {
  padding: 28px 32px;
}
.about-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.app-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
}
.header-text {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.app-name {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: rgba(0, 0, 0, 0.88);
}
.app-desc {
  color: rgba(0, 0, 0, 0.45);
  font-size: 15px;
}
.ver-tag {
  margin: 0;
  font-size: 13px;
  line-height: 22px;
  padding: 0 10px;
}
.build-meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  font-family: ui-monospace, monospace;
}
.section-divider {
  margin: 20px 0;
}
.about-section h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 14px;
  color: rgba(0, 0, 0, 0.88);
}
.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.feat-icon {
  font-size: 18px;
  color: #1677ff;
  margin-top: 2px;
}
.feature-title {
  font-weight: 500;
  font-size: 14px;
  line-height: 1.4;
}
.feature-desc {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
  line-height: 1.4;
  margin-top: 2px;
}
.about-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.author-info {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
}
.author-info a {
  color: #1677ff;
}
.qq-link {
  cursor: pointer;
  user-select: none;
}
.license-line {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
