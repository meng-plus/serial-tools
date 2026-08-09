/** 协议包加载：内置（public）与用户安装（数据目录）统一为「读文本 → 动态 import」 */

import { invoke, isTauri } from '@/api'
import { parseManifest } from './manifest'
import { collectModuleGraph, importModuleGraph } from './moduleGraph'
import type { ProtocolModule, ProtocolPackage } from './types'

/** 随应用打包的内置协议 id（新增内置协议时在此登记；仅保留示例参考实现） */
export const BUILTIN_PROTOCOL_IDS: string[] = [
  'modbus-rtu-master',
  'modbus-rtu-slave',
]

function builtinBase(id: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}protocols/builtin/${id}/`
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`加载失败 ${resp.status} ${url}`)
  return resp.text()
}

function assertProtocolModule(mod: unknown, protocolId: string): ProtocolModule {
  const m = (mod as { default?: unknown }).default
  if (!m || typeof m !== 'object') {
    throw new Error(`${protocolId}: main.js 未导出默认对象（需 export default {...}）`)
  }
  if (typeof (m as { init?: unknown }).init !== 'function') {
    throw new Error(`${protocolId}: main.js 缺少 init(ctx) 生命周期方法`)
  }
  return m as ProtocolModule
}

/** 读取内置包 manifest（用于列表展示；不校验用户输入） */
export async function loadBuiltinManifest(id: string): Promise<ProtocolPackage> {
  const mf = parseManifest(await fetchText(builtinBase(id) + 'manifest.yaml'))
  return { manifest: mf, source: 'builtin' }
}

/** 用户安装包列表（含 Dev 链接；仅 Tauri 环境可用） */
export async function listUserPackages(): Promise<ProtocolPackage[]> {
  if (!isTauri()) return []
  try {
    const list = await invoke<
      { id: string; valid: boolean; is_dev?: boolean; isDev?: boolean; dev_path?: string | null; devPath?: string | null }[]
    >('list_protocols')
    const out: ProtocolPackage[] = []
    for (const item of list) {
      if (!item.valid) continue
      try {
        const mf = parseManifest(await invoke<string>('read_protocol_file', { id: item.id, relPath: 'manifest.yaml' }))
        const isDev = item.is_dev === true || item.isDev === true
        const devPath = item.dev_path || item.devPath || undefined
        out.push({
          manifest: mf,
          source: isDev ? 'dev' : 'user',
          dir: isDev && devPath ? devPath : undefined,
        })
      } catch {
        // 单个包损坏不影响其余
      }
    }
    return out
  } catch {
    return []
  }
}

/** 读取协议实现体文本（builtin 走 fetch；user 走 IPC）——单文件场景仍可用 */
export async function readEntrySource(pkg: ProtocolPackage): Promise<string> {
  const entry = pkg.manifest.entry || 'main.js'
  if (pkg.source === 'builtin') {
    return fetchText(builtinBase(pkg.manifest.id) + entry)
  }
  return invoke<string>('read_protocol_file', {
    id: pkg.manifest.id,
    relPath: entry,
  })
}

/** 读取协议包内说明文档（README.md）；缺失时返回空串 */
export async function readPackageDoc(pkg: ProtocolPackage): Promise<string> {
  try {
    if (pkg.source === 'builtin') {
      return await fetchText(builtinBase(pkg.manifest.id) + 'README.md')
    }
    return await invoke<string>('read_protocol_file', {
      id: pkg.manifest.id,
      relPath: 'README.md',
    })
  } catch {
    return ''
  }
}

/**
 * 动态加载单文件 main.js（ESM 默认导出）。保留给测试/简单场景。
 * 生产路径请用 loadProtocolModule（支持包内相对 import）。
 */
export async function loadModuleFromSource(
  code: string,
  protocolId: string,
): Promise<ProtocolModule> {
  const withSourceUrl =
    code + `\n//# sourceURL=serial-tools/protocols/${protocolId}/main.js`
  const blob = new Blob([withSourceUrl], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    const mod = await import(/* @vite-ignore */ url)
    return assertProtocolModule(mod, protocolId)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 加载完整协议包（支持 main.js 相对 import 同包其它 .js）。
 * - builtin：真实 HTTP URL，浏览器原生解析相对路径
 * - user：IPC 读模块图 → data/Blob URL 链接后 import
 */
export async function loadProtocolModule(pkg: ProtocolPackage): Promise<ProtocolModule> {
  const entry = (pkg.manifest.entry || 'main.js').replace(/^\.\//, '')
  const protocolId = pkg.manifest.id

  if (pkg.source === 'builtin') {
    const url = builtinBase(protocolId) + entry
    const mod = await import(/* @vite-ignore */ url)
    return assertProtocolModule(mod, protocolId)
  }

  const readText = (rel: string) =>
    invoke<string>('read_protocol_file', { id: protocolId, relPath: rel })
  const sources = await collectModuleGraph(entry, readText)
  const mod = await importModuleGraph(sources, entry, `serial-tools/protocols/${protocolId}`)
  return assertProtocolModule(mod, protocolId)
}
