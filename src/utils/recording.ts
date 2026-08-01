/** 数据录制前端封装：后端命令 start/stop/list 的薄客户端 */

import { invoke, isTauri } from '@/api'

export type RecordingFormat = 'csv' | 'hex' | 'bin' | 'text'

export interface RecordingInfo {
  channel_id: string
  format: string
  output_dir: string
}

function assertTauri(): void {
  if (!isTauri()) throw new Error('数据录制仅支持桌面应用（tauri dev / 安装包）')
}

export async function startChannelRecording(
  channelId: string,
  format: RecordingFormat,
): Promise<RecordingInfo> {
  assertTauri()
  return invoke<RecordingInfo>('start_channel_recording', { channelId, format })
}

export async function stopChannelRecording(channelId: string): Promise<RecordingInfo> {
  assertTauri()
  return invoke<RecordingInfo>('stop_channel_recording', { channelId })
}

export async function listRecordings(): Promise<RecordingInfo[]> {
  return invoke<RecordingInfo[]>('list_recordings')
}
