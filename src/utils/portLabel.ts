/**
 * 串口 description 来自后端 `format!("{:?}", port_type)` 的 Debug 文本。
 * 展示时只取 product: Some("...") 中的短名，避免整段 UsbPort { ... }。
 */

/** 从 Debug 描述中提取 product 短名 */
export function portDisplayName(rawDescription: string | undefined | null): string {
  const raw = (rawDescription || '').trim()
  if (!raw) return ''

  const product = raw.match(/product:\s*Some\("((?:\\.|[^"\\])*)"\)/)
  if (product?.[1]) {
    return product[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim()
  }

  // 非 Debug 短串（兼容测试桩 / 已是可读名）
  if (!/UsbPort|PciPort|BluetoothPort|Unknown\b|Some\(/.test(raw)) return raw

  return ''
}

/** 下拉选项文案：COM21 — USB-Enhanced-SERIAL-C CH344 (COM21) */
export function portFullLabel(name: string, description?: string | null): string {
  const short = portDisplayName(description)
  return short ? `${name} — ${short}` : name
}
