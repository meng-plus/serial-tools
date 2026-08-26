/** 协议运行时管理器：包列表 / 实例生命周期 / 定时调度 / RX 分发 / 参数与数据导入导出 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import yaml from 'js-yaml'
import { invoke, isTauri } from '@/api'
import { useRxHub } from '@/stores/rxHub'
import { useValueBus } from '@/stores/valueBus'
import type { RxRecord } from '@/protocol/types'
import { defaultParams } from './manifest'
import {
  BUILTIN_PROTOCOL_IDS,
  loadBuiltinManifest,
  listUserPackages,
  loadProtocolModule,
} from './loader'
import { createContext, type ProtocolContextHandle, type RuntimeLogEntry } from './ctx'
import { upsertInstanceInfo, type ProtocolInfoEntry } from './infoMap'
import { upsertProgress, type ProtocolProgressEntry } from './progressMap'
import { shouldHotReload } from './devReload'
import type {
  ProtocolInstance,
  ProtocolModule,
  ProtocolPackage,
  VariableDef,
} from './types'

let instanceSeq = 0

interface TimerRecord {
  id: number
  kind: 'timeout' | 'interval'
}

/** 内置协议清单（与 loader.BUILTIN_PROTOCOL_IDS 同步维护） */
export function builtinProtocolIds(): string[] {
  return [...BUILTIN_PROTOCOL_IDS]
}

export const useProtocolRuntime = defineStore('protocolRuntime', () => {
  const packages = ref<ProtocolPackage[]>([])
  const instances = ref<ProtocolInstance[]>([])
  const logs = ref<RuntimeLogEntry[]>([])
  const loading = ref(false)
  const lastError = ref<string>('')
  const ready = ref(false)

  const rxHub = useRxHub()
  const valueBus = useValueBus()

  const moduleCache = new Map<string, ProtocolModule>()
  const ctxCache = new Map<string, ProtocolContextHandle>()
  const timersByInstance = new Map<string, TimerRecord[]>()
  const paramsByInstance = new Map<string, Record<string, unknown>>()
  const variablesByInstance = new Map<string, VariableDef[]>()
  const lastTickByInstance = new Map<string, number>()
  /** 实例查询结果（文本/状态），供 info_panel */
  const infoByInstance = ref<Record<string, Record<string, ProtocolInfoEntry>>>({})
  /** 长事务进度，供 progress 控件 */
  const progressByInstance = ref<Record<string, Record<string, ProtocolProgressEntry>>>({})

  let unsubRx: (() => void) | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let devPollTimer: ReturnType<typeof setInterval> | null = null
  const devMtimeById = new Map<string, number>()
  let hotReloadBusy = false

  // ---------- 包管理 ----------

  async function refreshPackages() {
    loading.value = true
    lastError.value = ''
    try {
      const builtins: ProtocolPackage[] = []
      for (const id of builtinProtocolIds()) {
        try {
          builtins.push(await loadBuiltinManifest(id))
        } catch (e) {
          lastError.value = `内置协议 ${id} 加载失败: ${e instanceof Error ? e.message : String(e)}`
        }
      }
      const users = await listUserPackages()
      const byId = new Map<string, ProtocolPackage>()
      for (const p of [...users, ...builtins]) byId.set(p.manifest.id, p)
      packages.value = [...byId.values()]
      syncDevPoll()
    } finally {
      loading.value = false
      ready.value = true
    }
  }

  function syncDevPoll() {
    const hasDev = packages.value.some(p => p.source === 'dev')
    if (hasDev && !devPollTimer && typeof window !== 'undefined') {
      devPollTimer = window.setInterval(() => {
        void pollDevMtimes()
      }, 1200)
    } else if (!hasDev && devPollTimer) {
      window.clearInterval(devPollTimer)
      devPollTimer = null
      devMtimeById.clear()
    }
  }

  async function pollDevMtimes() {
    if (!isTauri() || hotReloadBusy) return
    const devIds = packages.value.filter(p => p.source === 'dev').map(p => p.manifest.id)
    for (const id of devIds) {
      try {
        const mt = await invoke<number>('protocol_content_mtime', { id })
        const prev = devMtimeById.get(id)
        if (shouldHotReload(prev, mt)) {
          await hotReloadProtocol(id)
        }
        devMtimeById.set(id, mt)
      } catch {
        // 单包失败不影响其余
      }
    }
  }

  /** Dev：源文件变更后 dispose → 清缓存 → 重载 → 恢复运行中实例 */
  async function hotReloadProtocol(protocolId: string): Promise<void> {
    if (hotReloadBusy) return
    hotReloadBusy = true
    try {
      const runningIds = instances.value
        .filter(i => i.manifest.id === protocolId && i.enabled)
        .map(i => i.instanceId)
      for (const instanceId of runningIds) {
        await stopInstance(instanceId)
      }
      for (const inst of instances.value) {
        if (inst.manifest.id === protocolId) {
          moduleCache.delete(inst.instanceId)
          ctxCache.delete(inst.instanceId)
        }
      }
      await refreshPackages()
      const pkg = getPackage(protocolId)
      if (pkg) {
        for (const inst of instances.value) {
          if (inst.manifest.id === protocolId) {
            inst.manifest = pkg.manifest
            inst.variables = pkg.manifest.ui.variables || inst.variables
          }
        }
      }
      for (const instanceId of runningIds) {
        try {
          await startInstance(instanceId)
          pushLog('info', instanceId, protocolId, 'Dev 热重载完成')
        } catch (e) {
          pushLog(
            'error',
            instanceId,
            protocolId,
            `Dev 热重载启动失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
      if (runningIds.length === 0) {
        pushLog('info', '', protocolId, 'Dev 源文件已变更（当前无运行实例）')
      }
    } finally {
      hotReloadBusy = false
    }
  }

  function getPackage(protocolId: string): ProtocolPackage | undefined {
    return packages.value.find(p => p.manifest.id === protocolId)
  }

  async function installFromZip(bytes: Uint8Array, force = false): Promise<string> {
    if (!isTauri()) throw new Error('安装协议仅支持桌面应用')
    const data = Array.from(bytes)
    const info = await invoke<{ id: string; name: string; version: string }>(
      'install_protocol_zip',
      { data, force },
    )
    await refreshPackages()
    // 安装/覆盖后，同 id 协议实例须丢弃旧模块缓存，否则仍跑安装前的 Blob
    for (const inst of instances.value) {
      if (inst.manifest.id === info.id) {
        moduleCache.delete(inst.instanceId)
        ctxCache.delete(inst.instanceId)
      }
    }
    return info.id
  }

  /** Dev：链接本地协议文件夹（不复制；改源文件可热重载） */
  async function linkDevFolder(folderPath: string, force = false): Promise<string> {
    if (!isTauri()) throw new Error('Dev 文件夹加载仅支持桌面应用')
    const path = folderPath.trim()
    if (!path) throw new Error('请填写协议文件夹路径')
    const info = await invoke<{ id: string }>('link_protocol_dev', { path, force })
    await refreshPackages()
    for (const inst of instances.value) {
      if (inst.manifest.id === info.id) {
        moduleCache.delete(inst.instanceId)
        ctxCache.delete(inst.instanceId)
      }
    }
    // 建立基线 mtime，避免刚链接就误触发热重载
    try {
      const mt = await invoke<number>('protocol_content_mtime', { id: info.id })
      devMtimeById.set(info.id, mt)
    } catch {
      /* ignore */
    }
    return info.id
  }

  async function removePackage(protocolId: string): Promise<void> {
    await invoke('remove_protocol', { id: protocolId })
    const idx = instances.value.findIndex(i => i.manifest.id === protocolId)
    if (idx >= 0) await stopInstance(instances.value[idx].instanceId)
    await refreshPackages()
  }

  // ---------- 实例 ----------

  function instanceById(instanceId: string): ProtocolInstance | undefined {
    return instances.value.find(i => i.instanceId === instanceId)
  }

  async function createInstance(
    protocolId: string,
    channelId: string,
    initialParams?: Record<string, unknown>,
  ): Promise<ProtocolInstance> {
    const pkg = getPackage(protocolId)
    if (!pkg) throw new Error(`协议 ${protocolId} 未安装`)
    const instanceId = `pi-${++instanceSeq}`
    const params = { ...defaultParams(pkg.manifest), ...(initialParams || {}) }
    const inst: ProtocolInstance = {
      instanceId,
      manifest: pkg.manifest,
      channelId,
      enabled: false,
      params,
      status: 'idle',
      variables: pkg.manifest.ui.variables || [],
    }
    paramsByInstance.set(instanceId, params)
    variablesByInstance.set(instanceId, inst.variables)
    instances.value = [...instances.value, inst]
    return inst
  }

  async function removeInstance(instanceId: string): Promise<void> {
    await stopInstance(instanceId)
    instances.value = instances.value.filter(i => i.instanceId !== instanceId)
    paramsByInstance.delete(instanceId)
    variablesByInstance.delete(instanceId)
    // 删除实例必须清除模块/上下文缓存，否则重建同 id 实例会命中旧代码（改协议不生效）
    moduleCache.delete(instanceId)
    ctxCache.delete(instanceId)
    timersByInstance.delete(instanceId)
    lastTickByInstance.delete(instanceId)
    const { [instanceId]: _removed, ...restInfo } = infoByInstance.value
    infoByInstance.value = restInfo
    const { [instanceId]: _p, ...restProgress } = progressByInstance.value
    progressByInstance.value = restProgress
  }

  /**
   * 切换实例绑定的通道。若实例正在运行则先停止，再重建运行时上下文后按需重启。
   * ctx 在 createContext 时捕获 channelId，因此必须重建 module/ctx。
   */
  async function setInstanceChannel(instanceId: string, channelId: string): Promise<void> {
    const inst = instanceById(instanceId)
    if (!inst || inst.channelId === channelId) return
    const wasEnabled = inst.enabled
    if (wasEnabled) await stopInstance(instanceId)
    inst.channelId = channelId
    // 通道变了，旧 module/ctx 缓存的 channelId 已失效，需重建
    moduleCache.delete(instanceId)
    ctxCache.delete(instanceId)
    if (wasEnabled) await startInstance(instanceId)
  }

  function updateInstanceParams(instanceId: string, patch: Record<string, unknown>) {
    const inst = instanceById(instanceId)
    if (!inst) return
    const next = { ...paramsByInstance.get(instanceId), ...patch }
    paramsByInstance.set(instanceId, next)
    inst.params = { ...next }
  }

  async function setParams(instanceId: string, patch: Record<string, unknown>): Promise<void> {
    updateInstanceParams(instanceId, patch)
    const inst = instanceById(instanceId)
    if (!inst || !inst.enabled) return
    const module = moduleCache.get(instanceId)
    if (module?.setConfig) {
      try {
        await module.setConfig(patch)
      } catch (e) {
        pushLog('error', instanceId, inst.manifest.id, `setConfig 失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  // ---------- 生命周期 ----------

  function pushLog(level: RuntimeLogEntry['level'], instanceId: string, protocolId: string, msg: string) {
    logs.value.push({
      ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      instanceId,
      protocolId,
      msg,
    })
    if (logs.value.length > 2000) logs.value.splice(0, logs.value.length - 1500)
  }

  async function startInstance(instanceId: string): Promise<void> {
    const inst = instanceById(instanceId)
    if (!inst || inst.enabled) return
    const pkg = getPackage(inst.manifest.id)
    if (!pkg) throw new Error('协议包缺失')

    try {
      let module = moduleCache.get(instanceId)
      if (!module) {
        module = await loadProtocolModule(pkg)
      }
      const ctx = createContext({
        instanceId,
        protocolId: inst.manifest.id,
        channelId: inst.channelId,
        getParam: key => paramsByInstance.get(instanceId)?.[key],
        setParam: patch => {
          void setParams(instanceId, patch)
        },
        emitInfo: sample => {
          const cur = infoByInstance.value[instanceId] || {}
          infoByInstance.value = {
            ...infoByInstance.value,
            [instanceId]: upsertInstanceInfo(cur, sample),
          }
        },
        emitProgress: sample => {
          const cur = progressByInstance.value[instanceId] || {}
          progressByInstance.value = {
            ...progressByInstance.value,
            [instanceId]: upsertProgress(cur, sample),
          }
        },
        getQueries: () => instanceById(instanceId)?.manifest.ui.queries,
        pushLog: entry =>
          pushLog(entry.level, entry.instanceId, entry.protocolId, entry.msg),
        registerTimer: (kind, cb, ms) => {
          const id = kind === 'interval'
            ? window.setInterval(cb, ms)
            : window.setTimeout(cb, ms)
          const list = timersByInstance.get(instanceId) || []
          list.push({ id, kind })
          timersByInstance.set(instanceId, list)
          return id
        },
      })
      moduleCache.set(instanceId, module)
      ctxCache.set(instanceId, ctx)
      inst.error = undefined
      await module.init(ctx)
      inst.enabled = true
      inst.status = 'running'
      inst.startedAt = new Date().toISOString()
      if (module.getVariables) {
        const vars = module.getVariables() || []
        variablesByInstance.set(instanceId, vars)
        inst.variables = vars
      }
    } catch (e) {
      inst.status = 'error'
      inst.error = e instanceof Error ? e.message : String(e)
      pushLog('error', instanceId, inst.manifest.id, `启动失败: ${inst.error}`)
      throw e
    }
  }

  async function stopInstance(instanceId: string): Promise<void> {
    const inst = instanceById(instanceId)
    if (!inst) return
    const module = moduleCache.get(instanceId)
    if (module?.dispose) {
      try {
        module.dispose()
      } catch (e) {
        pushLog('error', instanceId, inst.manifest.id, `dispose 失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    for (const t of timersByInstance.get(instanceId) || []) {
      if (t.kind === 'interval') window.clearInterval(t.id)
      else window.clearTimeout(t.id)
    }
    timersByInstance.set(instanceId, [])
    lastTickByInstance.delete(instanceId)
    // 取消未完成的 ctx.request，再丢弃 module/ctx
    ctxCache.get(instanceId)?._dispose()
    moduleCache.delete(instanceId)
    ctxCache.delete(instanceId)
    inst.enabled = false
    inst.status = 'idle'
  }

  async function toggleInstance(instanceId: string): Promise<boolean> {
    const inst = instanceById(instanceId)
    if (!inst) return false
    if (inst.enabled) {
      await stopInstance(instanceId)
      return false
    }
    await startInstance(instanceId)
    return true
  }

  // ---------- 动作 / 数据 ----------

  async function runAction(instanceId: string, actionId: string, args: Record<string, unknown>) {
    const inst = instanceById(instanceId)
    if (!inst || !inst.enabled) return
    const module = moduleCache.get(instanceId)
    if (!module?.runAction) {
      pushLog('warn', instanceId, inst.manifest.id, `动作 ${actionId} 未实现`)
      return
    }
    try {
      await module.runAction(actionId, args)
    } catch (e) {
      pushLog('error', instanceId, inst.manifest.id, `动作 ${actionId} 失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 导出协议参数为 YAML/JSON 文本 */
  function exportParamsText(instanceId: string, format: 'yaml' | 'json' = 'yaml'): string {
    const inst = instanceById(instanceId)
    if (!inst) return ''
    const payload = { protocolId: inst.manifest.id, version: inst.manifest.version, params: inst.params }
    return format === 'json' ? JSON.stringify(payload, null, 2) : yaml.dump(payload, { lineWidth: 100, noRefs: true })
  }

  /** 解析导入文本并合并参数（JSON/YAML/CSV），返回实例 id */
  async function importParamsText(instanceId: string, text: string, csvForKey?: string): Promise<void> {
    const inst = instanceById(instanceId)
    if (!inst) return
    const trimmed = text.trim()
    if (csvForKey && inst.manifest.ui.params?.some(p => p.key === csvForKey && p.type === 'table')) {
      const rows = parseCsvTable(text)
      await setParams(instanceId, { [csvForKey]: rows })
      return
    }
    const data = trimmed.startsWith('{')
      ? JSON.parse(trimmed)
      : yaml.load(trimmed)
    const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
    const params = (obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)
      ? obj.params as Record<string, unknown>
      : obj) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const p of inst.manifest.ui.params || []) {
      if (p.key in params) patch[p.key] = coerceParam(p.type, params[p.key])
    }
    await setParams(instanceId, patch)
  }

  /** 导出实例读取到的数据（valueBus 中 ruleId 匹配本协议）：CSV + JSON 文本 */
  function exportData(instanceId: string): { csv: string; json: string; valueIds: string[] } | null {
    const inst = instanceById(instanceId)
    if (!inst) return null
    const samplesByKey = valueBus.series
    const all: { valueId: string; timestamp: string; value: number; unit: string }[] = []
    const valueIds = new Set<string>()
    for (const key of Object.keys(samplesByKey)) {
      const prefix = `${inst.channelId}::`
      if (!key.startsWith(prefix)) continue
      const valueId = key.slice(prefix.length)
      for (const s of samplesByKey[key]) {
        if (s.ruleId !== inst.manifest.id) continue
        valueIds.add(valueId)
        all.push({ valueId, timestamp: s.timestamp, value: s.value, unit: s.unit })
      }
    }
    if (all.length === 0) return null
    all.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    const csvLines = ['时间,变量,值,单位']
    for (const r of all) csvLines.push(`${r.timestamp},${r.valueId},${r.value},${r.unit}`)
    const json = JSON.stringify({ protocolId: inst.manifest.id, channelId: inst.channelId, exportedAt: new Date().toISOString(), rows: all }, null, 2)
    return { csv: csvLines.join('\n'), json, valueIds: [...valueIds] }
  }

  // ---------- RX 分发与调度 ----------

  function handleRx(record: RxRecord) {
    for (const inst of instances.value) {
      if (!inst.enabled || inst.channelId !== record.channelId) continue
      const module = moduleCache.get(inst.instanceId)
      if (!module) continue
      inst.lastRxAt = new Date().toISOString()
      try {
        if (inst.manifest.role === 'slave' && module.match) {
          if (module.match(record as never)) module.handle?.(record as never)
        } else if (module.onRx) {
          module.onRx(record as never)
        }
      } catch (e) {
        pushLog('error', inst.instanceId, inst.manifest.id, `onRx 异常: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  function tick() {
    const now = Date.now()
    for (const inst of instances.value) {
      if (!inst.enabled) continue
      const module = moduleCache.get(inst.instanceId)
      if (!module?.onTick) continue
      const last = lastTickByInstance.get(inst.instanceId) || 0
      if (now - last < 50) continue
      lastTickByInstance.set(inst.instanceId, now)
      try {
        module.onTick(now)
      } catch (e) {
        pushLog('error', inst.instanceId, inst.manifest.id, `onTick 异常: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  async function init() {
    if (ready.value) return
    await refreshPackages()
    unsubRx = rxHub.subscribe(handleRx, { direction: 'rx', debounceMs: 0 })
    tickTimer = window.setInterval(tick, 50)
  }

  function dispose() {
    for (const inst of instances.value) {
      if (inst.enabled) void stopInstance(inst.instanceId)
    }
    unsubRx?.()
    unsubRx = null
    if (tickTimer) window.clearInterval(tickTimer)
    tickTimer = null
    if (devPollTimer) window.clearInterval(devPollTimer)
    devPollTimer = null
    devMtimeById.clear()
    moduleCache.clear()
    ctxCache.clear()
    ready.value = false
  }

  function getInstanceInfo(instanceId: string): Record<string, ProtocolInfoEntry> {
    return infoByInstance.value[instanceId] || {}
  }

  function getInstanceProgress(instanceId: string): Record<string, ProtocolProgressEntry> {
    return progressByInstance.value[instanceId] || {}
  }

  function clearLogs() {
    logs.value = []
  }

  return {
    packages,
    instances,
    logs,
    loading,
    lastError,
    ready,
    infoByInstance,
    progressByInstance,
    refreshPackages,
    getPackage,
    installFromZip,
    linkDevFolder,
    hotReloadProtocol,
    removePackage,
    createInstance,
    removeInstance,
    setInstanceChannel,
    setParams,
    getInstanceInfo,
    getInstanceProgress,
    startInstance,
    stopInstance,
    toggleInstance,
    runAction,
    exportParamsText,
    importParamsText,
    exportData,
    init,
    dispose,
    clearLogs,
  }
})

function coerceParam(type: string, v: unknown): unknown {
  if (type === 'number') return typeof v === 'number' ? v : Number(v)
  if (type === 'bool') return v === true || v === 'true' || v === 1
  if (type === 'file') {
    // 导入的文件参数只保留元数据，字节需重新选择（token 在新会话无效）
    if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
      return { name: (v as { name: string }).name, size: Number((v as { size?: unknown }).size) || 0, token: '' }
    }
    return { name: '', size: 0, token: '' }
  }
  return v
}

/** 简单 CSV 解析：首行表头，其余数据行（引号/逗号基本支持） */
export function parseCsvTable(text: string): Record<string, unknown>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of text) {
    if (inQuote) {
      if (ch === '"') {
        if (cur.endsWith('"')) cur = cur.slice(0, -1) + '"'
        else inQuote = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.includes('\r\n')) continue
      if (cur !== '' || row.length > 0) {
        row.push(cur)
        rows.push(row)
      }
      cur = ''
      row = []
    } else {
      cur += ch
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur)
    rows.push(row)
  }
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.trim())
  return rows.slice(1).map(r => {
    const obj: Record<string, unknown> = {}
    header.forEach((h, i) => {
      const raw = (r[i] ?? '').trim()
      obj[h] = raw === '' ? undefined : tryNumber(raw)
    })
    return obj
  })
}

function tryNumber(s: string): string | number {
  const n = Number(s)
  return s !== '' && !Number.isNaN(n) ? n : s
}
