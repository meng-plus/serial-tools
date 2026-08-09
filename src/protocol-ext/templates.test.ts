import { describe, it, expect } from 'vitest'
import { loadProtocol, makeTestContext } from './testing'

/**
 * 模板包冒烟测试：保证 public/protocols/templates/ 下三个自定义模板的 main.js
 * 始终可加载、可 init、可响应核心调用，不因模板结构调整而悄悄变坏。
 * 用户从模板复制新协议时，可以参照本文件为协议包编写配套测试。
 */

const TEMPLATE_ROOT = '../../public/protocols/templates'

interface TemplateMod {
  init(ctx: unknown): void
  dispose?(): void
  onRx?(frame: { bytes: number[] }): void
  onTick?(now: number): void
  setConfig?(patch: Record<string, unknown>): void
  match?(frame: { bytes: number[] }): boolean
  handle?(frame: { bytes: number[] }): void
  runAction?(actionId: string, args?: Record<string, unknown>): void
  getVariables?(): { key: string; label: string }[]
}

function load(path: string): Promise<TemplateMod> {
  return loadProtocol<TemplateMod>(`${TEMPLATE_ROOT}/${path}/main.js`)
}

const MASTER_PARAMS: Record<string, unknown> = {
  command: '01 03 00 00 00 0A',
  cycle_ms: 500,
  timeout_ms: 300,
  retry: 2,
}

const SLAVE_PARAMS: Record<string, unknown> = {
  addr: 1,
  coils: [
    { addr: 0, value: 1, name: 'coil0' },
    { addr: 1, value: 0, name: 'coil1' },
  ],
  registers: [
    { reg: 0, value: 100, name: 'reg0', unit: 'V' },
    { reg: 1, value: 200, name: 'reg1', unit: 'V' },
  ],
}

describe('模板包冒烟（custom-master）', () => {
  it('init 可加载且不抛错', async () => {
    const mod = await load('custom-master')
    const h = makeTestContext({ params: MASTER_PARAMS })
    expect(() => mod.init(h.ctx)).not.toThrow()
  })

  it('onRx 接收合法帧不抛错', async () => {
    const mod = await load('custom-master')
    const h = makeTestContext({ params: MASTER_PARAMS })
    mod.init(h.ctx)
    expect(() => mod.onRx?.({ bytes: [0x01, 0x03, 0x04, 0x00, 0x0a, 0x00, 0x14] })).not.toThrow()
  })

  it('runAction / getVariables 可用', async () => {
    const mod = await load('custom-master')
    const h = makeTestContext({ params: MASTER_PARAMS })
    mod.init(h.ctx)
    expect(() => mod.runAction?.('poll_once')).not.toThrow()
    expect(Array.isArray(mod.getVariables?.())).toBe(true)
  })
})

describe('模板包冒烟（custom-slave）', () => {
  it('init 可加载且不抛错', async () => {
    const mod = await load('custom-slave')
    const h = makeTestContext({ params: SLAVE_PARAMS })
    expect(() => mod.init(h.ctx)).not.toThrow()
  })

  it('match / handle 链路可用', async () => {
    const mod = await load('custom-slave')
    const h = makeTestContext({ params: SLAVE_PARAMS })
    mod.init(h.ctx)
    const frame = { bytes: [0x01, 0x03, 0x00, 0x00, 0x00, 0x01] }
    expect(typeof mod.match?.(frame)).toBe('boolean')
    expect(() => mod.handle?.(frame)).not.toThrow()
  })
})

describe('模板包冒烟（custom-passive）', () => {
  it('init 可加载且不抛错', async () => {
    const mod = await load('custom-passive')
    const h = makeTestContext({ params: { sep: '\\r\\n' } })
    expect(() => mod.init(h.ctx)).not.toThrow()
  })

  it('onRx 接收数据不抛错', async () => {
    const mod = await load('custom-passive')
    const h = makeTestContext({ params: { sep: '\\r\\n' } })
    mod.init(h.ctx)
    expect(() => mod.onRx?.({ bytes: [0x68, 0x00, 0x01] })).not.toThrow()
  })
})
