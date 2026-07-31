import { describe, it, expect } from 'vitest'
import { buildExportFilename, sanitizeFilePart, formatExportTime } from './exportFile'

describe('exportFile', () => {
  it('sanitizes channel ids', () => {
    expect(sanitizeFilePart('serial-COM3')).toBe('serial-COM3')
    expect(sanitizeFilePart('tcp_server-0.0.0.0:5000')).toBe('tcp_server-0.0.0.0-5000')
  })

  it('builds default name with feature channel time', () => {
    const name = buildExportFilename({
      feature: '收发日志',
      channelLabel: 'COM3',
      ext: 'txt',
      when: new Date(2026, 7, 1, 12, 30, 45),
    })
    expect(name).toBe('收发日志_COM3_20260801_123045.txt')
  })

  it('formatExportTime is local compact', () => {
    const s = formatExportTime(new Date(2026, 0, 2, 3, 4, 5))
    expect(s).toBe('20260102_030405')
  })
})
