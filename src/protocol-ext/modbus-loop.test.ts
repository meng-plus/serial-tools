import { describe, it, expect } from 'vitest'
import { buildProtocolUtils } from './utils'
import type { ProtocolContext } from './types'

/**
 * 主从完整链路闭环测试：不依赖真实串口，把 master 与 slave 的 sendHex 互相喂给对方，
 * 模拟同一 RTU 总线上的一问一答，验证读 / 从站面板改值 / 主站双击写值全链路。
 */

const utils = buildProtocolUtils()

const SLAVE_URL = '../../public/protocols/builtin/modbus-rtu-slave/main.js'
const MASTER_URL = '../../public/protocols/builtin/modbus-rtu-master/main.js'

type Frame = { bytes: number[] }

interface SlaveLike {
  init(ctx: ProtocolContext): void
  dispose(): void
  match(frame: Frame): boolean
  handle(frame: Frame): void
  runAction(actionId: string, args?: Record<string, unknown>): void
  setConfig?(patch: Record<string, unknown>): void
}

interface MasterLike {
  init(ctx: ProtocolContext): void
  dispose(): void
  onRx(frame: Frame): void
  runAction(actionId: string, args?: Record<string, unknown>): void
  onTick?(now: number): void
}

const SLAVE_PARAMS: Record<string, unknown> = {
  addr: 1,
  coils: [
    { addr: 0, value: 1, name: 'k1' },
    { addr: 1, value: 0, name: 'k2' },
  ],
  registers: [
    { reg: 0, value: 100, name: 'r0', unit: 'V' },
    { reg: 1, value: 200, name: 'r1', unit: 'V' },
  ],
  byte_order: 'be',
}

const MASTER_PARAMS: Record<string, unknown> = {
  poll: [{ name: 'dev1', addr: 1, func: 3, start: 0, count: 2 }],
  cycle_ms: 0, // 关闭自动轮询，测试手动驱动
  timeout_ms: 200,
  retry: 2,
  byte_order: 'be',
}

/**
 * 构建虚拟总线闭环。
 * slave.sendHex → 自动喂回 master.onRx；master.sendHex → 自动喂给 slave.handle。
 * 返回两个实例对象与各自的 emitVar 记录。
 */
function makeLoop() {
  const masterEmitted: { valueId: string; value: number; unit?: string }[] = []
  const slaveEmitted: { valueId: string; value: number; unit?: string }[] = []
  const masterSent: string[] = []
  const slaveSent: string[] = []

  const peer = { master: null as MasterLike | null, slave: null as SlaveLike | null }

  const slaveCtx = {
    channelId: 'serial-loop',
    instanceId: 'pi-slave',
    sendHex: async (hex: string) => {
      slaveSent.push(hex)
      // 从站应答 → 主站收
      if (peer.master) peer.master.onRx({ bytes: utils.hexToBytes(hex) })
      return { bytesSent: hex.length / 2, seq: 1 }
    },
    emitVar: (s: { valueId: string; value: number; unit?: string }) => slaveEmitted.push(s),
    log: () => {},
    getParam: (k: string) => SLAVE_PARAMS[k],
    timer: { setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} },
    utils,
  } as unknown as ProtocolContext

  const masterCtx = {
    channelId: 'serial-loop',
    instanceId: 'pi-master',
    sendHex: async (hex: string) => {
      masterSent.push(hex)
      // 主站请求 → 从站收
      if (peer.slave) peer.slave.handle({ bytes: utils.hexToBytes(hex) })
      return { bytesSent: hex.length / 2, seq: 1 }
    },
    emitVar: (s: { valueId: string; value: number; unit?: string }) => masterEmitted.push(s),
    log: () => {},
    getParam: (k: string) => MASTER_PARAMS[k],
    timer: { setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} },
    utils,
  } as unknown as ProtocolContext

  return { masterEmitted, slaveEmitted, masterSent, slaveSent, slaveCtx, masterCtx, peer }
}

describe('modbus-rtu 主从闭环（虚拟总线）', () => {
  it('主站轮询 → 从站应答 → 主站 emitVar 读到正确寄存器值', async () => {
    const slaveMod = (await import(SLAVE_URL)).default as unknown
    const masterMod = (await import(MASTER_URL)).default as unknown
    const slave = slaveMod as SlaveLike
    const master = masterMod as MasterLike

    const loop = makeLoop()
    slave.init(loop.slaveCtx)
    master.init(loop.masterCtx)
    loop.peer.slave = slave
    loop.peer.master = master

    // 主站手动发起一轮轮询（cycle_ms=0，不自动）
    master.onRx({ bytes: [] }) // no-op 防御
    // 直接调用主站内部：通过 runAction read_all 触发一轮
    master.runAction('read_all')

    // 主站请求应到达从站并产生应答
    expect(loop.masterSent.length).toBeGreaterThan(0)
    expect(loop.slaveSent.length).toBeGreaterThan(0)

    // 主站应已 emitVar 两个寄存器值（从站初始 100 / 200）
    expect(loop.masterEmitted).toContainEqual({ valueId: 'dev1_0', value: 100 })
    expect(loop.masterEmitted).toContainEqual({ valueId: 'dev1_1', value: 200 })
  })

  it('从站面板 set_value 改寄存器 → 主站再读一次读到新值', async () => {
    const slaveMod = (await import(SLAVE_URL)).default as unknown
    const masterMod = (await import(MASTER_URL)).default as unknown
    const slave = slaveMod as SlaveLike
    const master = masterMod as MasterLike

    const loop = makeLoop()
    slave.init(loop.slaveCtx)
    master.init(loop.masterCtx)
    loop.peer.slave = slave
    loop.peer.master = master

    master.runAction('read_all')
    expect(loop.masterEmitted).toContainEqual({ valueId: 'dev1_0', value: 100 })

    // 从站面板双击改寄存器 0 = 42
    slave.runAction('set_value', { kind: 'reg', addr: 0, value: '42' })

    // 主站再轮询一轮 → 读到 42
    loop.masterEmitted.length = 0
    master.runAction('read_all')
    expect(loop.masterEmitted).toContainEqual({ valueId: 'dev1_0', value: 42 })
  })

  it('主站双击 write_reg(FC06) 写寄存器 → 从站内存更新 → 读回确认', async () => {
    const slaveMod = (await import(SLAVE_URL)).default as unknown
    const masterMod = (await import(MASTER_URL)).default as unknown
    const slave = slaveMod as SlaveLike
    const master = masterMod as MasterLike

    const loop = makeLoop()
    slave.init(loop.slaveCtx)
    master.init(loop.masterCtx)
    loop.peer.slave = slave
    loop.peer.master = master

    // 主站双击写值：从站地址 1，寄存器 0，值 77
    master.runAction('write_reg', { addr: '1', reg: 0, value: '77' })

    // 主站应发出 FC06 请求
    expect(loop.masterSent.length).toBe(1)
    const req = utils.hexToBytes(loop.masterSent[0])
    expect(req.slice(0, 6)).toEqual([0x01, 0x06, 0x00, 0x00, 0x00, 0x4d]) // 77=0x4d

    // 从站收到并应答（回显）
    expect(loop.slaveSent.length).toBe(1)
    expect(utils.hexToBytes(loop.slaveSent[0]).slice(0, 6)).toEqual([0x01, 0x06, 0x00, 0x00, 0x00, 0x4d])

    // 等待主站 _writeReg 触发读回（异步微任务）
    await new Promise(resolve => setTimeout(resolve, 0))
    // 主站读到新值 77
    expect(loop.masterEmitted).toContainEqual({ valueId: 'dev1_0', value: 77 })
  })

  it('主站 write_reg 写越界地址 → 从站返回异常码 02 链路不崩', async () => {
    const slaveMod = (await import(SLAVE_URL)).default as unknown
    const masterMod = (await import(MASTER_URL)).default as unknown
    const slave = slaveMod as SlaveLike
    const master = masterMod as MasterLike

    const loop = makeLoop()
    slave.init(loop.slaveCtx)
    master.init(loop.masterCtx)
    loop.peer.slave = slave
    loop.peer.master = master

    // 写寄存器 99（从站最大 1）→ 从站异常应答（0x86 02）
    master.runAction('write_reg', { addr: '1', reg: 99, value: '5' })
    expect(loop.slaveSent.length).toBe(1)
    const resp = utils.hexToBytes(loop.slaveSent[0])
    expect(resp.slice(0, 3)).toEqual([0x01, 0x86, 0x02])
  })

  it('从站面板改线圈 → 从站自身数据表与应答链路同步（FC01 响应）', async () => {
    const slaveMod = (await import(SLAVE_URL)).default as unknown
    const slave = slaveMod as SlaveLike

    const loop = makeLoop()
    slave.init(loop.slaveCtx)

    const readCoils = (): number[] => {
      const body = [0x01, 0x01, 0x00, 0x00, 0x00, 0x02]
      const crc = utils.crc16Modbus(body)
      return [...body, crc & 0xff, (crc >> 8) & 0xff]
    }

    // 构造 FC01 读线圈 0-1 请求并入站 → 初始应答（线圈 0=1、1=0 → 字节 0b01 = 0x01）
    slave.handle({ bytes: readCoils() })
    expect(loop.slaveSent.length).toBe(1)
    expect(utils.hexToBytes(loop.slaveSent[0]).slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x01])

    // 从站面板双击改线圈 1 = 1 → 立即推送
    slave.runAction('set_value', { kind: 'coil', addr: 1, value: '1' })
    expect(loop.slaveEmitted).toContainEqual({ valueId: 'coil_1', value: 1 })

    // 再读线圈 0-1 → 应答反映新值（线圈 0=1、1=1 → 字节 0b11 = 0x03）
    loop.slaveSent.length = 0
    slave.handle({ bytes: readCoils() })
    expect(loop.slaveSent.length).toBe(1)
    expect(utils.hexToBytes(loop.slaveSent[0]).slice(0, 4)).toEqual([0x01, 0x01, 0x01, 0x03])
  })
})
