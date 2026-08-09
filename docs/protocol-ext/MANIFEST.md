# manifest.yaml 字段全解

manifest 由前端 `src/protocol-ext/manifest.ts` 解析（js-yaml）。字段要求参考 `src/protocol-ext/types.ts` 的 `ProtocolManifest`。

## 必填字段

```yaml
id: modbus-rtu-master      # 唯一标识：^[a-z0-9_-]+$（小写字母/数字/下划线/连字符），须与包目录名一致
name: Modbus RTU 主站      # 显示名称（中文）
version: 1.0.0            # 语义化版本；同版本或降级安装需「强制安装」
apiVersion: 1             # ABI 版本，当前为 1；高于运行时的协议会被拒绝
role: master              # passive | master | slave
entry: main.js            # 入口文件（相对包根目录）
```

## 可选字段

```yaml
description: 周期轮询读取 RTU 从站寄存器   # 管理页展示的说明

# 支持通道类型（安装后按此过滤「创建实例」时的通道选择）
channelTypes:
  - serial
  - tcp_client

# 能力声明（当前仅文档性，后续用于能力校验）
capabilities:
  - send
  - storage
  - chart
```

## ui 参数表（params）

声明式参数表单，前端 `ParamForm.vue` 渲染。

| 参数项 | 说明 |
|--------|------|
| `key` | 参数名，运行时 `ctx.getParam(key)` 读取 |
| `label` | 中文标签 |
| `group` | 可选：参数分组名；同名参数在表单中归入同一分组（参数过多的协议用），未声明归默认分组 |
| `type` | `number` / `text` / `bool` / `select` / `table` / `multiline` / `password` / `file` |
| `default` | 默认值 |
| `min/max/step` | number 类型 |
| `options` | select 选项：`- { value: ..., label: ... }` |
| `columns` | table 列定义：`- { key, label, type, default }` |
| `placeholder` | 输入占位 |
| `accept` | file 类型的原生文件过滤（如 `.bin,.hex`） |

```yaml
ui:
  params:
    - key: poll
      label: 轮询表
      type: table
      columns:
        - { key: name, label: 名称, type: text, default: "" }
        - { key: addr, label: 从站地址, type: number, default: 1 }
    - key: cycle_ms
      label: 轮询周期
      type: number
      default: 500
      min: 100
      max: 60000
    - key: byte_order
      label: 字节序
      type: select
      default: be
      options:
        - { value: be, label: 大端 }
        - { value: le, label: 小端 }
```

> 注意：YAML 不支持流式映射（`{ ... }`）内嵌块级序列。多行 select 选项请使用块级写法（见上方示例），否则解析会失败。

### file 参数

选择本地文件（固件 / 配置等二进制）。运行时用 `ctx.getFile(key)` 读取字节。

```yaml
- key: firmware
  label: 升级文件
  type: file
  accept: ".bin,.hex"
```

- 参数值只保存 `{ name, size, token }` 元数据，真实字节在运行时瞬态缓存，**不写入工作区**，重启后需重新选择。
- `ctx.getFile(key)` 返回 `{ name, bytes }`；未选择或缓存失效返回 `null`，协议需自行提示。

## ui 参数预设（presets，可选）

同一协议不同传感器/型号的默认参数集。创建实例时可快速选择预设，自动填充参数（仍可手动微调）。

```yaml
ui:
  presets:
    - id: hx711_50kg
      label: HX711 50kg 称重传感器
      params:
        gain: 128
        scale: 2100.5
        filter: 10
    - id: hx711_5kg
      label: HX711 5kg 称重传感器
      params:
        gain: 128
        scale: 920.3
        filter: 20
```

- `id`：预设唯一标识（`^[a-z0-9_-]+$`）
- `label`：显示名称（如传感器型号）
- `params`：覆盖式默认参数（未声明的字段回退到 `ui.params` 的 `default`）
- 创建实例向导步骤 3（参数配置）顶部出现「传感器型号 / 预设」下拉框；选择后自动填充对应默认参数
- 预设只是参数默认值的具名集合，不改变协议逻辑（main.js 完全复用）

## ui 变量表（variables，可选）

运行时可用变量（供监控 / 图表下拉、协议面板绑定）：

```yaml
ui:
  variables:
    - { key: temp, label: 温度, unit: ℃ }
```

也可由实现体 `getVariables()` 动态返回；二者并集可用。

## ui 动作表（actions，可选）

协议实例面板按钮 / 管理页触发：

```yaml
ui:
  actions:
    - id: read_all
      label: 立即读取一轮
```

## ui 分组表（groups，可选）

参数 / 数据分区（卡片）定义。实例面板按本表渲染**分区卡片**：每个分组一张卡片，卡片头显示分组名 + 组内动作按钮，卡片体展示归属该组的寄存器网格控件。

```yaml
ui:
  groups:
    - id: device_a          # 分组 id；params[].group 与 dashboard[].group 引用它
      label: 设备A          # 卡片标题
      buttons:              # 可选：组内功能按钮（读取 / 写入数据，手动触发）
        - id: read_all
          label: 读取全部
          kind: read         # read=读取 / write=写入（仅 UI 语义）
          action: read_all   # 触发的 ui.actions 动作 id；缺省回退到按钮 id
          args: { addr: "{addr}" }   # 可选：动作参数，支持 {addr} 等占位替换
        - id: write_cfg
          label: 写入配置
          kind: write
          action: write_cfg
```

- `params[].group`：参数表单的分组（可读性），同时决定参数属于哪个分区卡片。
- `dashboard[].group`：控件归属哪个分区；未声明 group 的控件归「默认分区」。
- 未声明 `groups` 时面板保持单一网格（向后兼容）。

## ui 仪表盘模板（dashboard，可选）

协议实例面板的数据区模板。无模板时按角色自动生成（master/slave 为 `register_grid` 网格，passive 为变量网格 + 动作按钮行）。

支持控件类型：

| 控件 | 说明 |
|------|------|
| `register_grid` | 寄存器网格，双击可写值（见下方示例） |
| `value` | 数据卡片：最新值 + 单位，点「历史」查看最近 200 条记录 |
| `chart` | 波形图（echarts 折线，事件驱动刷新），绑定单个 valueId |
| `info_panel` | 查询结果面板：展示 `emitInfo` 文本/状态（`keys` 过滤字段） |
| `progress` | 长事务进度条：绑定 `progressId`（对应 `ctx.emitProgress.id`） |
| `button` | 动作按钮（触发 `ui.actions` 中定义的动作） |

## ui.queries（可选，声明式查询绑定）

协议在 `onRx` 中解析出结构化 `data` 后调用 `ctx.applyQuery(actionId, data)`，框架按绑定写
`emitInfo` / `setParam`，减少样板代码。`from` 支持点分路径；`format`：`text`（默认）/
`hex` / `hex_size` / `bool_cn`。

```yaml
ui:
  queries:
    - action: q4201
      info:
        - { from: upgrade.addr_start, key: upgrade_addr_start, label: APP起始地址, format: hex }
      setParam:
        firmware_start: { from: upgrade.addr_start, format: hex }
```

```yaml
ui:
  dashboard:
    - id: d1
      type: register_grid
      row: 0
      col: 0
      w: 12
      h: 8
      group: device_a       # 可选：归属的分区组 id
      title: 寄存器
      grid:
        label: 寄存器
        paramKey: poll
        editable: true
        writeAction: write_reg
        writeArgs: { addr: "{addr}", reg: "{reg}", value: "{value}" }
    - id: c1
      type: value            # 数据卡片
      row: 0
      col: 0
      w: 4
      h: 3
      group: device_a
      title: 温度
      valueIds: [temp]
    - id: info1
      type: info_panel       # 查询结果（emitInfo）
      row: 3
      col: 0
      w: 12
      h: 3
      group: device_a
      title: 设备信息
      keys: [product_name, soft_version]
    - id: ch1
      type: chart            # 波形图
      row: 0
      col: 4
      w: 8
      h: 6
      group: device_a
      title: 温度波形
      valueIds: [temp]
      maxPoints: 200
```

## 完整最小示例

```yaml
id: my-protocol
name: 我的协议
description: 一个最小协议包
version: 1.0.0
apiVersion: 1
role: passive
entry: main.js
channelTypes:
  - serial
ui:
  params:
    - key: prefix
      label: 帧前缀
      type: text
      default: "AA"
```
