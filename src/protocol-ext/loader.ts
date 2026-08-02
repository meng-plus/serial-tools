/** 协议包加载：内置（public）与用户安装（数据目录）统一为「读文本 → 动态 import」 */

import { invoke, isTauri } from '@/api'
import { parseManifest } from './manifest'
import type { ProtocolModule, ProtocolPackage } from './types'

/** 随应用打包的内置协议 id（新增内置协议时在此登记） */
export const BUILTIN_PROTOCOL_IDS: string[] = [
  'modbus-rtu-master',
  'modbus-rtu-slave',
  'modbus-tcp-master',
  'modbus-tcp-slave',
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

/** 读取内置包 manifest（用于列表展示；不校验用户输入） */
export async function loadBuiltinManifest(id: string): Promise<ProtocolPackage> {
  const mf = parseManifest(await fetchText(builtinBase(id) + 'manifest.yaml'))
  return { manifest: mf, source: 'builtin' }
}

/** 用户安装包列表（仅 Tauri 环境可用） */
export async function listUserPackages(): Promise<ProtocolPackage[]> {
  if (!isTauri()) return []
  try {
    const list = await invoke<{ id: string; valid: boolean }[]>('list_protocols')
    const out: ProtocolPackage[] = []
    for (const item of list) {
      if (!item.valid) continue
      try {
        const mf = parseManifest(await invoke<string>('read_protocol_file', { id: item.id, relPath: 'manifest.yaml' }))
        out.push({ manifest: mf, source: 'user' })
      } catch {
        // 单个包损坏不影响其余
      }
    }
    return out
  } catch {
    return []
  }
}

/** 读取协议实现体文本（builtin 走 fetch；user 走 IPC） */
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

/**
 * 动态加载 main.js（ESM 默认导出）。每次传入新代码都会生成新 Blob URL，
 * 避免模块缓存导致「重载不生效」。
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
    const m = (mod as { default?: unknown }).default
    if (!m || typeof m !== 'object') {
      throw new Error('main.js 未导出默认对象（需 export default {...}）')
    }
    if (typeof (m as { init?: unknown }).init !== 'function') {
      throw new Error('main.js 缺少 init(ctx) 生命周期方法')
    }
    return m as ProtocolModule
  } finally {
    URL.revokeObjectURL(url)
  }
}
