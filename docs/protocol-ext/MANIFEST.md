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

## ui 变量表（variables，可选）

运行时可用变量（供监控 / 图表下拉、仪表盘绑定）：

```yaml
ui:
  variables:
    - { key: temp, label: 温度, unit: ℃ }
```

也可由实现体 `getVariables()` 动态返回；二者并集可用。

## ui 动作表（actions，可选）

仪表盘按钮 / 管理页触发：

```yaml
ui:
  actions:
    - id: read_all
      label: 立即读取一轮
```

## ui 仪表盘模板（dashboard，可选）

初始布局控件（安装后「新建仪表盘」可自动带入）：

```yaml
ui:
  dashboard:
    - { id: d1, type: value, row: 0, col: 0, w: 4, h: 2, title: 温度, valueIds: ["temp"] }
    - { id: b1, type: button, row: 0, col: 4, w: 2, h: 1, title: 读取, actionId: read_all }
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
