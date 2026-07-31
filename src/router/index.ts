import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/connection' },
  { path: '/connection', name: 'connection', component: () => import('@/pages/ConnectionPage.vue'), meta: { title: '连接管理' } },
  {
    path: '/workspace/:channelId',
    name: 'workspace',
    component: () => import('@/pages/ChannelWorkspacePage.vue'),
    meta: { title: '通道工作区' },
  },
  // 兼容旧入口：重定向到连接页，由侧栏选通道进入工作区
  { path: '/terminal', redirect: '/connection' },
  { path: '/protocol', redirect: '/connection' },
  { path: '/forward', name: 'forward', component: () => import('@/pages/ForwardPage.vue'), meta: { title: '端口转发' } },
  { path: '/workspace-config', name: 'workspace-config', component: () => import('@/pages/WorkspacePage.vue'), meta: { title: '工作区' } },
  { path: '/log', name: 'log', component: () => import('@/pages/LogPage.vue'), meta: { title: '系统日志' } },
  { path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue'), meta: { title: '设置' } },
  { path: '/about', name: 'about', component: () => import('@/pages/AboutPage.vue'), meta: { title: '关于' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
