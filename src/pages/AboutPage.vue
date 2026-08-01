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

      <a-divider class="section-divider" />

      <div class="about-actions">
        <a-button :loading="checking" @click="handleCheckUpdate">
          <template #icon><SyncOutlined /></template>
          检查更新
        </a-button>
        <a-button @click="openIssues(true)">
          <template #icon><BugOutlined /></template>
          报告问题
        </a-button>
        <a-button @click="openIssues(false)">
          <template #icon><BulbOutlined /></template>
          提交需求
        </a-button>
        <a-button @click="openProject">
          <template #icon><GithubOutlined /></template>
          版本发布页
        </a-button>
      </div>
      <div class="about-actions-tip">
        新版与工单均在 GitHub 发布与跟踪，点此前往：
        <a href="#" @click.prevent="openProject">github.com/meng-plus/serial-tools</a>
      </div>
    </a-card>

    <a-modal
      v-model:open="updateModal.open"
      :title="updateModal.release ? `发现新版本 ${updateModal.release.tag_name}` : '检查更新'"
      ok-text="前往下载"
      cancel-text="取消"
      @ok="goDownload"
    >
      <p v-if="updateModal.release" class="update-meta">
        当前版本 {{ APP_VERSION_LABEL }}，最新版发布于 {{ releaseDate(updateModal.release.published_at) }}
      </p>
      <pre v-if="updateModal.release?.body" class="update-body">{{ updateModal.release.body }}</pre>
      <p v-else class="update-meta">可在版本发布页查看更新详情。</p>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import {
  UserOutlined, MailOutlined, TeamOutlined,
  SwapOutlined, CodeOutlined, FileTextOutlined, BugOutlined,
  HddOutlined, GithubOutlined, BulbOutlined, SyncOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { isTauri } from '@/api/tauri'
import { APP_VERSION_LABEL, APP_GIT_HASH_SHORT, APP_BUILD_DATE } from '@/buildInfo'
import {
  GITHUB_ISSUES_URL,
  GITHUB_RELEASES_URL,
  checkForUpdate,
  openExternal,
  type GitHubRelease,
} from '@/utils/updater'

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

// ── 更新检查 & 问题反馈 ──────────────────────────────────────

const checking = ref(false)
const updateModal = reactive<{
  open: boolean
  release: GitHubRelease | null
}>({
  open: false,
  release: null,
})

async function handleCheckUpdate() {
  if (checking.value) return
  checking.value = true
  try {
    const result = await checkForUpdate(APP_VERSION_LABEL)
    if (result.hasUpdate && result.latest) {
      updateModal.release = result.latest
      updateModal.open = true
    } else if (result.error) {
      message.warning(`检查更新失败：${result.error}，可前往 GitHub 查看最新版本`)
    } else {
      message.success(`当前已是最新版本 ${APP_VERSION_LABEL}`)
    }
  } finally {
    checking.value = false
  }
}

function goDownload() {
  updateModal.open = false
  if (updateModal.release?.html_url) {
    openExternal(updateModal.release.html_url)
  } else {
    openExternal(GITHUB_RELEASES_URL)
  }
}

function releaseDate(iso: string | undefined): string {
  if (!iso) return '未知'
  return new Date(iso).toLocaleDateString()
}

async function openIssues(isBug: boolean) {
  const title = isBug ? '[Bug] ' : '[Feature] '
  await openExternal(`${GITHUB_ISSUES_URL}/new?title=${encodeURIComponent(title)}`)
}

function openProject() {
  openExternal(GITHUB_RELEASES_URL)
}

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
.about-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.about-actions-tip {
  margin-top: 12px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
.about-actions-tip a {
  color: #1677ff;
}
.update-meta {
  margin: 0 0 12px;
  color: rgba(0, 0, 0, 0.65);
}
.update-body {
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  padding: 12px;
  margin: 0;
}
</style>
