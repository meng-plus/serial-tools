// @ts-nocheck — 解析器测试：读真实 hex 文件断言，无需严格 node 类型
import { describe, it, expect } from 'vitest'
import { parseIntelHex, parseHexLine, hexToBin } from './hexParser'
import { readFileSync } from 'node:fs'

describe('Intel HEX 解析', () => {
  it('解析基本数据行', () => {
    // :10000000F82000100D1F0000351F0000391F0000F0
    const rec = parseHexLine(':10000000F82000100D1F0000351F0000391F0000F0', 0)
    expect(rec).not.toBeNull()
    expect(rec!.type).toBe(0)
    expect(rec!.addr).toBe(0x0000)
    expect(rec!.data.length).toBe(16)
    expect(rec!.data[0]).toBe(0xf8)
  })

  it('扩展线性地址（type 04）影响后续地址', () => {
    // 真实文件的行：扩展线性地址 0x0001（base=0x10000）+ 数据
    const text = ':020000040001F9\n:10000000810000EB42018A1E1B1F31462846C04773'
    const res = parseIntelHex(text)
    expect(res.map.has(0x10000)).toBe(true)
    expect(res.minAddr).toBe(0x10000)
    expect(res.segments[0].start).toBe(0x10000)
    expect(res.segments[0].bytes[0]).toBe(0x81)
  })

  it('EOF 停止解析', () => {
    const text = ':10000000F82000100D1F0000351F0000391F0000F0\n:00000001FF'
    const res = parseIntelHex(text)
    expect(res.segments.length).toBe(1)
    expect(res.segments[0].start).toBe(0)
    expect(res.segments[0].bytes.length).toBe(16)
  })

  it('解析真实固件 hex 文件并裁剪 APP 区（>=0x4000）', () => {
    const fs = require('node:fs') as { existsSync: (p: string) => boolean }
    const realFile = 'target/1-01-9903Z1V2-[2]-[KJ428-Z(A)]-V2.01-20260428.hex'
    if (!fs.existsSync(realFile)) {
      console.warn('真实 hex 固件不存在（target/ 被 git 忽略），跳过裁剪测试')
      return
    }
    const text = readFileSync(realFile, 'utf8')
    const res = parseIntelHex(text)
    expect(res.warnings.length).toBe(0)
    expect(res.segments.length).toBeGreaterThan(0)
    // 文件含 boot（0x0000~0x3FFF）和 APP（>=0x4000）
    expect(res.minAddr).toBe(0x0) // boot 起始
    expect(res.maxAddr).toBeGreaterThan(0x4000) // 有 APP 区
    // 裁剪 APP 区：从 0x4000 开始
    const appBin = hexToBin(res, 0x4000, 0x1000)
    expect(appBin.length).toBe(0x1000)
    // 至少有些字节不是 0xFF（有真实数据）
    expect(appBin.some(b => b !== 0xff)).toBe(true)
  })

  it('内联 hex 片段：base=0 + offset 0x4000 定位 APP 区', () => {
    // 00 记录：0x0000 处 boot 数据 DEADBEEF
    // type 04: base=0x0000 (扩展线性地址)
    // 00 记录：offset 0x4000 → 实际地址 0x4000，数据 11223344
    const text =
      ':04000000DEADBEEFC4\n' + // 0x0000: DE AD BE EF
      ':020000040000FA\n' +     // type04 base=0x0000
      ':044000001122334412'     // 0x4000: 11 22 33 44
    const res = parseIntelHex(text)
    expect(res.map.get(0x0)).toBe(0xde)
    expect(res.map.get(0x4000)).toBe(0x11)
    // 裁剪 APP 区：从 0x4000 取 4 字节
    const appBin = hexToBin(res, 0x4000, 4)
    expect(appBin).toEqual([0x11, 0x22, 0x33, 0x44])
  })
})
