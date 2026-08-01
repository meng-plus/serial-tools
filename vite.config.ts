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
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
