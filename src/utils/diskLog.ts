import { invoke, isTauri } from '@/api'
import { buildExportFilename, downloadTextFile } from './exportFile'

/** 写入应用数据目录 exports/，返回绝对路径；非 Tauri 则浏览器下载并返回提示文案 */
export async function exportTextToDisk(opts: {
  feature: string
  channelId?: string
  channelLabel?: string
  ext: string
  content: string
}): Promise<{ path: string; via: 'appdir' | 'browser' }> {
  const filename = buildExportFilename({
    feature: opts.feature,
    channelId: opts.channelId,
    channelLabel: opts.channelLabel,
    ext: opts.ext,
  })
  if (isTauri()) {
    const path = await invoke<string>('write_export_file', {
      filename,
      content: opts.content,
    })
    return { path, via: 'appdir' }
  }
  downloadTextFile(filename, opts.content)
  return { path: `浏览器默认下载目录 / ${filename}`, via: 'browser' }
}

export async function createRealtimeLogFile(opts: {
  feature: string
  channelId: string
  channelLabel?: string
  header: string
}): Promise<string> {
  const filename = buildExportFilename({
    feature: opts.feature,
    channelId: opts.channelId,
    channelLabel: opts.channelLabel,
    ext: 'txt',
  })
  if (!isTauri()) {
    throw new Error('实时落盘仅支持桌面应用（tauri dev / 安装包）')
  }
  return invoke<string>('create_channel_log_file', {
    filename,
    header: opts.header,
  })
}

export async function appendRealtimeLog(path: string, line: string): Promise<void> {
  await invoke('append_channel_log', { path, line })
}

export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) return
  // 浏览器下载路径无法打开；appdir 可 reveal
  if (path.includes('浏览器')) return
  await invoke('reveal_in_folder', { path })
}
