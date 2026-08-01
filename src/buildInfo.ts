/** 构建期由 Vite define 注入；关于页 / 页脚共用 */

declare const __APP_VERSION__: string
declare const __APP_GIT_HASH__: string
declare const __APP_BUILD_DATE__: string

export const APP_VERSION = __APP_VERSION__
export const APP_GIT_HASH = __APP_GIT_HASH__
export const APP_BUILD_DATE = __APP_BUILD_DATE__

export const APP_GIT_HASH_SHORT =
  APP_GIT_HASH === 'dev' ? 'dev' : APP_GIT_HASH.slice(0, 7)

export const APP_VERSION_LABEL = `v${APP_VERSION}`
