import { describe, it, expect } from 'vitest'
import { formatDurationMs, formatLogLine } from './formatLogLine'
import type { DisplayConfig, TerminalLine } from '@/stores/terminalStore'

const baseLine = (partial: Partial<TerminalLine> = {}): TerminalLine => ({
  id: 1,
  timestamp: '12:00:00.000',
  direction: 'rx',
  channelId: 'serial-COM1',
  hex: '01',
  text: 'x',
  rawBytes: [1],
  ...partial,
})

const cfg = (partial: Partial<DisplayConfig> = {}): DisplayConfig => ({
  showTimestamp: true,
  showDuration: false,
  showDirection: true,
  showChannel: false,
  showTx: true,
  ...partial,
})

describe('formatDurationMs', () => {
  it('formats ms and seconds', () => {
    expect(formatDurationMs(12)).toBe('12ms')
    expect(formatDurationMs(1500)).toBe('1.50s')
  })
})

describe('formatLogLine', () => {
  it('includes start→end and duration when enabled', () => {
    const line = baseLine({
      timestampEnd: '12:00:00.045',
      durationMs: 45,
    })
    const text = formatLogLine(line, 'AA', cfg({ showDuration: true }))
    expect(text).toContain('[12:00:00.000→12:00:00.045]')
    expect(text).toContain('(45ms)')
    expect(text).toContain('RX')
  })
})
