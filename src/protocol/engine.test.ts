import { describe, it, expect } from 'vitest'
import { matchRule, matchAllRules } from './engine'
import type { ProtocolRule, RxRecord } from './types'

function rx(text: string, channelId = 'serial-COM3'): RxRecord {
  return {
    channelId,
    timestamp: '12:00:00.000',
    direction: 'rx',
    hex: '',
    text,
    bytes: [],
    seq: 1,
  }
}

describe('protocol engine regex', () => {
  const rule: ProtocolRule = {
    id: 'r1',
    name: 'temp',
    type: 'regex',
    enabled: true,
    pattern: 'TEMP:([0-9.]+)',
    fields: [{ name: 'temperature', group: 1, as: 'number', unit: 'C', valueId: 'temperature' }],
  }

  it('extracts number field', () => {
    const fields = matchRule(rule, rx('TEMP:23.5 OK'))
    expect(fields).toEqual([
      { name: 'temperature', value: '23.5', unit: 'C', numberValue: 23.5, valueId: 'temperature' },
    ])
  })

  it('applies on any channel (no channel bind)', () => {
    const fields = matchRule(rule, rx('TEMP:1', 'tcp-ephemeral'))
    expect(fields?.[0].numberValue).toBe(1)
  })

  it('ignores disabled', () => {
    expect(matchRule({ ...rule, enabled: false }, rx('TEMP:1'))).toBeNull()
  })
})

describe('protocol engine json', () => {
  const rule: ProtocolRule = {
    id: 'j1',
    name: 'json temp',
    type: 'json',
    enabled: true,
    pattern: '',
    fields: [{ name: 'temp', path: '$.temp', as: 'number', valueId: 'temp' }],
  }

  it('extracts via path', () => {
    const fields = matchRule(rule, rx('{"temp":36.6}'))
    expect(fields?.[0].numberValue).toBe(36.6)
  })

  it('returns null on invalid json', () => {
    expect(matchRule(rule, rx('not-json'))).toBeNull()
  })
})

describe('matchAllRules', () => {
  it('skips tx', () => {
    const rule: ProtocolRule = {
      id: 'r',
      name: 'r',
      type: 'regex',
      enabled: true,
      pattern: 'A',
      fields: [],
    }
    const hits = matchAllRules([rule], { ...rx('A', 'c'), direction: 'tx' })
    expect(hits).toEqual([])
  })
})
