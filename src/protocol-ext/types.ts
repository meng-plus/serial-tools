/** 协议扩展系统：类型与 ABI 定义 */

import type { RxRecord } from '@/protocol/types'

/** 当前 ABI 版本（协议包的 apiVersion 必须等于或低于此值） */
export const PROTOCOL_API_VERSION = 1

export type ProtocolRole = 'passive' | 'master' | 'slave'

export type ParamType =
  | 'number'
  | 'text'
  | 'bool'
  | 'select'
  | 'table'
  | 'multiline'
  | 'password'
  | 'file'

export interface ParamColumnDef {
  key: string
  label: string
  type?: ParamType
  default?: unknown
}

export interface ParamDef {
  key: string
  label: string
  type: ParamType
  /** 可选：参数分组（同名 group 在表单中归入同一分组，便于参数过多的协议） */
  group?: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  /** select 选项 */
  options?: { value: string; label: string }[]
  /** table 列定义 */
  columns?: ParamColumnDef[]
  placeholder?: string
  /** file 参数的文件选择过滤（原生 input accept，如 ".bin,.hex"） */
  accept?: string
}

/** file 参数值：仅存元数据，真实字节在运行时瞬态缓存（token 关联） */
export interface FileParamValue {
  name: string
  size: number
  token: string
}

export interface VariableDef {
  key: string
  label: string
  unit?: string
  decimals?: number
  /** 可选：变量绑定的地址（寄存器网格按此定位/排序） */
  addr?: number
}

/** 参数预设：同一协议不同传感器/型号的默认参数集（创建实例时可快速选择） */
export interface PresetDef {
  id: string
  label: string
  /** 覆盖式默认参数（未声明的字段回退到 ui.params 的 default） */
  params?: Record<string, unknown>
}

export interface ActionDef {
  id: string
  label: string
  params?: ParamDef[]
}

/** 分组动作按钮：读取 / 写入数据（功能触发，非配置项） */
export interface GroupButtonDef {
  id: string
  label: string
  /** read=读取数据 / write=写入数据（UI 语义标注） */
  kind?: 'read' | 'write'
  /** 触发的动作 id（对应 ui.actions 中定义的 action） */
  action?: string
  /** 动作参数（支持 {addr} 等占位替换） */
  args?: Record<string, string>
}

/** 参数 / 数据分区（卡片）定义：param.group 引用本组的 id */
export interface GroupDef {
  id: string
  label: string
  /** 组内功能按钮（读取 / 写入数据，手动触发） */
  buttons?: GroupButtonDef[]
}

export type ControlType =
  | 'value'
  | 'button'
  | 'table'
  | 'chart'
  | 'text'
  | 'register_grid'
  | 'info_panel'
  | 'progress'

/** 寄存器网格控件声明：行结构 + 实时值模式 + 双击写值映射（通用，不限定 Modbus） */
export interface RegisterGridDef {
  label: string
  /** 行结构来自哪个 table 参数（如从站 registers / 主站 poll）；缺省则用实例 variables */
  paramKey?: string
  /** 每行实时值变量 key 模式，支持 {addr} 占位，如 "reg_{addr}" */
  valuePattern?: string
  /** 覆盖列定义（key 取值：name/addr/value/unit 或参数表列 key+value） */
  columns?: { key: string; label: string }[]
  /** 双击写值 / 编辑触发的 runAction id */
  writeAction?: string
  /** 动作参数映射：{addr}/{value}/{row.*} 占位替换为实际值 */
  writeArgs?: Record<string, string>
  /** 是否允许双击写值 / 编辑 */
  editable?: boolean
}

export interface DashboardControl {
  id: string
  type: ControlType
  row: number
  col: number
  w: number
  h: number
  /** 可选：归属的分区组 id（ui.groups 中声明；未声明归默认分区） */
  group?: string
  title?: string
  /** value / chart / table 绑定的变量 key（多个用逗号分隔的 valueIds） */
  valueIds?: string[]
  /** chart 曲线的最大点数（截断历史缓冲窗口） */
  maxPoints?: number
  /** button 触发的动作 id */
  actionId?: string
  actionParams?: Record<string, unknown>
  text?: string
  /** register_grid 专用声明 */
  grid?: RegisterGridDef
  /** info_panel：要展示的 info key 列表；缺省展示该实例全部 */
  keys?: string[]
  /** progress：进度条 id（对应 ctx.emitProgress.id） */
  progressId?: string
}

/** 声明式查询结果绑定（ui.queries） */
export interface QueryInfoBinding {
  from: string
  key: string
  label?: string
  format?: 'text' | 'hex' | 'hex_size' | 'bool_cn'
  level?: 'info' | 'warn' | 'error'
}

export interface QuerySetParamBinding {
  from: string
  format?: 'text' | 'hex' | 'hex_size' | 'bool_cn'
}

export interface QueryBindingDef {
  /** 对应 ui.actions[].id / runAction 的 actionId */
  action: string
  info?: QueryInfoBinding[]
  setParam?: Record<string, QuerySetParamBinding>
}

export interface ProtocolManifest {
  id: string
  name: string
  description?: string
  version: string
  apiVersion: number
  role: ProtocolRole
  entry: string
  channelTypes: string[]
  capabilities: string[]
  ui: {
    params?: ParamDef[]
    variables?: VariableDef[]
    actions?: ActionDef[]
    /** 参数预设（同一协议不同传感器/型号的默认参数集） */
    presets?: PresetDef[]
    /** 可选：参数 / 数据分区（卡片）定义；param.group 与 dashboard.group 引用其 id */
    groups?: GroupDef[]
    dashboard?: DashboardControl[]
    /**
     * 声明式查询结果绑定：协议 parse 出结构化 data 后调 ctx.applyQuery(action, data)，
     * 框架按 from 路径写 emitInfo / setParam。
     */
    queries?: QueryBindingDef[]
  }
}

/** 已安装协议包（内置 / zip 安装 / Dev 文件夹链接） */
export interface ProtocolPackage {
  manifest: ProtocolManifest
  /** 来源：builtin=随应用打包 / user=zip 安装 / dev=本地文件夹链接 */
  source: 'builtin' | 'user' | 'dev'
  /** Dev 源目录绝对路径；其余为空 */
  dir?: string
}

/** 协议实现体（main.js 的 ESM 默认导出） */
export interface ProtocolModule {
  init(ctx: ProtocolContext): void | Promise<void>
  dispose?(): void
  /** 通道收到数据 */
  onRx?(frame: RxRecord): void
  /** 定时驱动（运行时统一每 50ms 调用，协议自判时间间隔） */
  onTick?(now: number): void
  /** 参数变更即时生效 */
  setConfig?(patch: Record<string, unknown>): void | Promise<void>
  /** 从站：报文匹配 */
  match?(frame: RxRecord): boolean
  /** 从站：匹配后处理 / 应答 */
  handle?(frame: RxRecord): void | Promise<void>
  /** 仪表盘按钮动作 */
  runAction?(actionId: string, args: Record<string, unknown>): void | Promise<void>
  getVariables?(): VariableDef[]
}

/** 注入协议实现的上下文 */
export interface ProtocolContext {
  channelId: string
  instanceId: string
  /** 经后端 send_data 发送 hex（无后缀追加） */
  sendHex(hex: string): Promise<{ bytesSent: number; seq: number }>
  /** 推送数值样本 → valueBus（监控 / 图表 / 数据导出） */
  emitVar(sample: { valueId: string; value: number; unit?: string; timestamp?: string }): void
  log(level: 'info' | 'warn' | 'error', msg: string): void
  getParam(key: string): unknown
  /**
   * 回写实例参数（合并 patch → 同步表单；运行中触发 setConfig）。
   * 用于查询结果落到可编辑配置（如 APP 起始地址）。
   */
  setParam(patch: Record<string, unknown>): void
  /**
   * 推送文本/状态查询结果 → 面板 info_panel（不进入数值 valueBus）。
   */
  emitInfo(sample: { key: string; text: string; label?: string; level?: 'info' | 'warn' | 'error' }): void
  /**
   * 推送长事务进度 → 面板 progress 控件（OTA / 文件传输）。
   */
  emitProgress(sample: { id: string; current: number; total: number; label?: string; done?: boolean }): void
  /**
   * 按 manifest.ui.queries 将结构化结果绑定到 emitInfo / setParam。
   * 无匹配绑定定义时返回 false。
   */
  applyQuery(actionId: string, data: Record<string, unknown>): boolean
  /**
   * 主站请求–应答：发送 hex，等待 match 命中本通道 rx；支持 timeout / retry。
   * 实例停止时未完成的 request 会以「已取消」拒绝。
   */
  request(opts: {
    hex: string
    match: (frame: { bytes: number[]; hex: string; channelId: string }) => boolean
    timeout?: number
    retry?: number
  }): Promise<{ bytes: number[]; hex: string }>
  /**
   * 读取 file 参数的真实字节。参数值只存元数据 { name, size, token }，
   * 这里按 token 从运行时瞬态缓存取回字节；未选择或缓存失效时返回 null。
   */
  getFile(key: string): { name: string; bytes: number[] } | null
  /**
   * 保存二进制到磁盘（Tauri 写入 exports/ 并返回绝对路径；浏览器触发下载）。
   */
  saveFile(name: string, bytes: number[]): Promise<string>
  /** 定时器：dispose 时自动清理 */
  timer: {
    setTimeout(cb: () => void, ms: number): number
    setInterval(cb: () => void, ms: number): number
    clearTimeout(id: number): void
    clearInterval(id: number): void
  }
  utils: ProtocolUtils
}

/** ctx.utils：封装通用字节 / 校验 / 分帧工具，协议实现可直接使用 */
export interface ProtocolUtils {
  hexToBytes(hex: string): number[]
  bytesToHex(bytes: number[]): string
  /** 无空格小写 */
  bytesToHexCompact(bytes: number[]): string
  /** CRC16-Modbus（小端） */
  crc16Modbus(bytes: number[]): number
  /** CRC16-XMODEM（poly 0x1021，初值 0x0000），YMODEM 文件传输用 */
  crc16Xmodem(bytes: number[]): number
  appendChecksum(payload: number[], algo: string, endian?: 'le' | 'be'): number[]
  computeChecksum(algo: string, cover: number[]): number
  verifyFrameChecksum(frame: number[], algo: string, endian?: 'le' | 'be'): boolean
  /** 从帧按 offset + 类型解码数值（复用二进制规则引擎） */
  decodeBinary(
    bytes: number[],
    fields: { name: string; offset: number; type: string; scale?: number; bias?: number; unit?: string }[],
  ): { name: string; value: string; unit: string; numberValue?: number; valueId?: string }[]
  /** 读写整数 / 浮点（le/be） */
  u16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  i16(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  u32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  f32(bytes: number[], offset: number, endian?: 'le' | 'be'): number
  /** 把数值按类型写入数组（追加模式），返回附加字节 */
  encodeU16(value: number, endian?: 'le' | 'be'): number[]
  encodeU32(value: number, endian?: 'le' | 'be'): number[]
}

/** 运行中的协议实例（绑定某通道） */
export interface ProtocolInstance {
  instanceId: string
  manifest: ProtocolManifest
  channelId: string
  enabled: boolean
  params: Record<string, unknown>
  status: 'idle' | 'running' | 'error'
  error?: string
  variables: VariableDef[]
  startedAt?: string
  lastRxAt?: string
}
