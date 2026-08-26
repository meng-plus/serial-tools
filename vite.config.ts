import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { resolveBuildInfo } from './scripts/resolve-build-info.mjs'

const buildInfo = resolveBuildInfo()

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(buildInfo.version),
    __APP_GIT_HASH__: JSON.stringify(buildInfo.gitHash),
    __APP_BUILD_DATE__: JSON.stringify(buildInfo.buildDate),
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('ant-design-vue') || id.includes('@ant-design/icons-vue')) {
            return 'antd'
          }
          if (id.includes('echarts') || id.includes('vue-echarts')) {
            return 'echarts'
          }
          if (id.includes('@xterm')) {
            return 'xterm'
          }
          if (id.includes('/vue/') || id.includes('vue-router') || id.includes('pinia')) {
            return 'vue-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
