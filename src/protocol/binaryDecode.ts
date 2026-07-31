import type { BinaryFieldDef, ParsedField } from './types'

function readU16(bytes: number[], offset: number, le: boolean): number {
  if (le) return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8)
  return ((bytes[offset] & 0xff) << 8) | (bytes[offset + 1] & 0xff)
}

function readU32(bytes: number[], offset: number, le: boolean): number {
  if (le) {
    return (
      (bytes[offset] & 0xff) |
      ((bytes[offset + 1] & 0xff) << 8) |
      ((bytes[offset + 2] & 0xff) << 16) |
      ((bytes[offset + 3] & 0xff) << 24)
    ) >>> 0
  }
  return (
    (((bytes[offset] & 0xff) << 24) |
      ((bytes[offset + 1] & 0xff) << 16) |
      ((bytes[offset + 2] & 0xff) << 8) |
      (bytes[offset + 3] & 0xff)) >>> 0
  )
}

function readF32(bytes: number[], offset: number, le: boolean): number {
  const buf = new ArrayBuffer(4)
  const view = new DataView(buf)
  for (let i = 0; i < 4; i++) view.setUint8(i, bytes[offset + i] & 0xff)
  return view.getFloat32(0, le)
}

function typeSize(t: BinaryFieldDef['type']): number {
  if (t === 'u8' || t === 'i8') return 1
  if (t.startsWith('u16') || t.startsWith('i16')) return 2
  return 4
}

function readRaw(bytes: number[], field: BinaryFieldDef): number | null {
  const need = typeSize(field.type)
  if (field.offset + need > bytes.length) return null
  const t = field.type
  switch (t) {
    case 'u8':
      return bytes[field.offset] & 0xff
    case 'i8': {
      const v = bytes[field.offset] & 0xff
      return v > 127 ? v - 256 : v
    }
    case 'u16le':
      return readU16(bytes, field.offset, true)
    case 'u16be':
      return readU16(bytes, field.offset, false)
    case 'i16le': {
      const v = readU16(bytes, field.offset, true)
      return v > 0x7fff ? v - 0x10000 : v
    }
    case 'i16be': {
      const v = readU16(bytes, field.offset, false)
      return v > 0x7fff ? v - 0x10000 : v
    }
    case 'u32le':
      return readU32(bytes, field.offset, true)
    case 'u32be':
      return readU32(bytes, field.offset, false)
    case 'i32le': {
      const v = readU32(bytes, field.offset, true)
      return v > 0x7fffffff ? v - 0x100000000 : v
    }
    case 'i32be': {
      const v = readU32(bytes, field.offset, false)
      return v > 0x7fffffff ? v - 0x100000000 : v
    }
    case 'f32le':
      return readF32(bytes, field.offset, true)
    case 'f32be':
      return readF32(bytes, field.offset, false)
    default:
      return null
  }
}

/** 从完整帧按字段表解码 */
export function decodeBinaryFields(bytes: number[], fields: BinaryFieldDef[]): ParsedField[] {
  const out: ParsedField[] = []
  for (const f of fields) {
    const raw = readRaw(bytes, f)
    if (raw == null || !Number.isFinite(raw)) continue
    const scale = f.scale ?? 1
    const bias = f.bias ?? 0
    const value = raw * scale + bias
    out.push({
      name: f.name,
      value: String(value),
      unit: f.unit || '',
      numberValue: value,
      valueId: f.valueId || f.name,
    })
  }
  return out
}
