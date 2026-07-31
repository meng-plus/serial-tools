import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/connection' },
  { path: '/connection', name: 'connection', component: () => import('@/pages/ConnectionPage.vue'), meta: { title: '连接管理' } },
  { path: '/terminal', name: 'terminal', component: () => import('@/pages/TerminalPage.vue'), meta: { title: '终端' } },
  { path: '/protocol', name: 'protocol', component: () => import('@/pages/ProtocolPage.vue'), meta: { title: '协议解析' } },
  { path: '/forward', name: 'forward', component: () => import('@/pages/ForwardPage.vue'), meta: { title: '端口转发' } },
  { path: '/log', name: 'log', component: () => import('@/pages/LogPage.vue'), meta: { title: '系统日志' } },
  { path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue'), meta: { title: '设置' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
