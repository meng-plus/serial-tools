# 协议面板可用性重构（方案 2）设计

> 状态：已确认（用户选 C + A + 方案 2，不做拖拽布局）  
> 日期：2026-08-08  
> 样板：任一支持 info_panel 的主站协议；从站仅跟 ABI，面板可后置

## 1. 目标

解决协议实例面板「查了没展示、关键参数不回写、布局像寄存器工具不适配 示例协议」的问题：

1. **查询结果可见**：设备信息、升级支持等文本/状态有固定展示区  
2. **参数自动回写**：`q4201` 应答后自动更新 `firmware_start`（及容量参数）  
3. **数值通道干净**：传感器等仍走 `emitVar` → 监控/图表  
4. **框架通用**：ABI + 面板控件可被其它协议复用；示例协议 为第一落地样板

## 2. 非目标（本轮不做）

- 拖拽 / 自由栅格布局引擎  
- 多设备复杂路由可视化编辑  
- 从站面板大改  
- 改写 Modbus 面板外观（保持兼容即可）

## 3. 信息架构

协议实例面板自上而下：

| 区域 | 职责 |
|------|------|
| 顶栏 | 协议名、状态、启停、切通道、打开参数配置 |
| 动作区 | 按 `ui.groups` 分区按钮（读/写）；去掉顶栏重复平铺全部 actions |
| **查询结果区（新）** | `emitInfo` 文本/状态字段；按 group 或扁平列表展示 |
| 数值区 | 现有 `value` / `chart` / `register_grid`（仅数值） |
| 参数 | 仍在参数配置页/抽屉；回写后表单立即可见 |

## 4. ABI 增量

### 4.1 `ctx.setParam(patch)`

- 签名：`setParam(patch: Record<string, unknown>): void`（同步即可；内部复用 runtime `setParams`）  
- 行为：合并实例参数 → 更新 UI 绑定 → 若实例运行中调用 `setConfig(patch)`  
- 用途：`q4201` 后写 `firmware_start`、`firmware_capacity`  
- 约束：禁止写 `file` 类型的二进制；只写元数据/标量/表

### 4.2 `ctx.emitInfo({ key, text, label?, level? })`

- `key`：稳定 id（如 `product_name`、`upgrade_supported`）  
- `text`：展示字符串（地址用 `0x4000` 形式）  
- `label?`：缺省时可用 manifest `variables` / 结果表声明  
- `level?`：`info` \| `warn` \| `error`（影响样式）  
- **不进入** `valueBus`；进入实例级 `infoByInstance` 映射（最近值 + 时间戳）

### 4.3 `emitVar`

- 保持 **仅数值**（`value: number`）  
- 示例协议 设备信息字符串改走 `emitInfo`，不再误塞 `emitVar`

## 5. 面板控件

### 5.1 `info_panel`（dashboard 新类型）

```yaml
- id: device-info
  type: info_panel
  group: device_info
  title: 查询结果
  keys: [product_name, soft_version, hardware_version, protocol_version, factory_sn]
```

- 渲染：标签 + 文本 + 更新时间；空为 `--`  
- 无 `keys` 时展示该实例全部 info（或按 group 过滤，首版可用显式 keys）

### 5.2 顶栏 actions

- 若存在 `ui.groups[].buttons`，顶栏不再重复渲染全部 `ui.actions`（避免双份按钮）  
- 无 groups 时保持现状（兼容 Modbus）

## 6. 示例主站落地

### 6.1 参数

| key | 说明 |
|-----|------|
| `firmware_start` | APP 起始；`q4201` 自动回写为 `0x…` |
| `firmware_capacity` | 新建；分区容量（字节或 `0x…`）；可只读展示/可编辑 |

### 6.2 查询 → 展示 / 回写

| 动作 | emitInfo | setParam |
|------|----------|----------|
| q0101～q0105 | 产品名/版本/出厂号 | — |
| q1001 / q1010 | 可选一行摘要；明细仍 emitVar | — |
| q4201 | 是否支持、起始、容量、softver | `firmware_start`、`firmware_capacity` |

### 6.3 Dashboard 布局（示意）

- `device_info`：`info_panel`（设备字段）+ 组按钮  
- `sensor_data`：`register_grid` / value（测量值）+ 组按钮  
- `firmware`：`info_panel`（升级支持/地址/容量）+ 组按钮；参数区含文件与地址

### 6.4 下载固件按钮

- 在 firmware 分组增加「下载固件」→ `s4281`（现 actions 已有，补到 group buttons）

## 7. 数据流

```
查询应答 → main.js 解析
  ├─ 文本/状态 → emitInfo → infoStore → info_panel
  ├─ 数值 → emitVar → valueBus → value/chart/grid
  └─ 需落参数 → setParam → params + ParamForm + setConfig
```

## 8. 测试

- 单元：`setParam` 合并与 `setConfig` 调用；`emitInfo` 覆盖同 key  
- 示例协议 loop：`查询应答` 后 params 含正确 `目标参数`；info 含支持标志  
- 面板：纯逻辑测 info 选取（无 DOM）；不引入 jsdom  

## 9. 文档

- 更新 `docs/protocol-ext/ABI.md`、`MANIFEST.md`  
- 示例协议 `README` 补充结果区与回写说明  

## 10. 验收

1. 点「查询升级支持」后：结果区显示支持/地址/容量；参数「APP起始地址」自动变为应答值  
2. 点设备信息各查询：结果区出现对应字符串，无需看 log  
3. 传感器查询仍能在数值区看到量  
4. Modbus 等旧包面板不回归（无 info_panel 时行为与现网一致）  
5. 不做拖拽布局  
