import { describe, expect, it } from 'vitest'
import { portDisplayName, portFullLabel } from './portLabel'

describe('portDisplayName', () => {
  it('extracts product Some("...") from UsbPort Debug', () => {
    const raw =
      'UsbPort { vid: 6790, pid: 21973, serial_number: Some("BD0442ABCD"), manufacturer: Some("wch.cn"), product: Some("USB-Enhanced-SERIAL-C CH344 (COM21)") }'
    expect(portDisplayName(raw)).toBe('USB-Enhanced-SERIAL-C CH344 (COM21)')
  })

  it('returns empty when product is None', () => {
    const raw =
      'UsbPort { vid: 1, pid: 2, serial_number: None, manufacturer: Some("ACME"), product: None }'
    expect(portDisplayName(raw)).toBe('')
  })

  it('keeps plain description unchanged', () => {
    expect(portDisplayName('USB Serial')).toBe('USB Serial')
  })

  it('returns empty for bare port type tags', () => {
    expect(portDisplayName('PciPort')).toBe('')
    expect(portDisplayName('BluetoothPort')).toBe('')
  })
})

describe('portFullLabel', () => {
  it('joins name and short product', () => {
    const raw =
      'UsbPort { vid: 1, pid: 2, serial_number: None, manufacturer: None, product: Some("USB-Enhanced-SERIAL-C CH344 (COM21)") }'
    expect(portFullLabel('COM21', raw)).toBe('COM21 — USB-Enhanced-SERIAL-C CH344 (COM21)')
  })

  it('returns name only when nothing extractable', () => {
    expect(portFullLabel('COM1', 'PciPort')).toBe('COM1')
  })
})
