# 协议解析与多视图设计

> 状态：已采纳并实施中（Phase UI + A）  
> 日期：2026-08-01  
> 配套：[ARCHITECTURE.md](../ARCHITECTURE.md) · [ROADMAP.md](../ROADMAP.md) · [DESIGN-DECISIONS.md](../DESIGN-DECISIONS.md)

## 1. 目标

在通用自定义协议解析（字符串正则、JSON）之上，将「终端收发」升级为**通道优先的多视图工作区**：同一通道可并行打开多种交互视图；每个视图只绑定一个数据通道；配置可导入导出以便迁移。

## 2. 决策锁定

| 项 | 决策 |
|----|------|
| 解析引擎位置 | **前端**（方案 1）。后端继续只发原始 `rx-data` |
| 信息架构 | **一通道 → 多视图**；**一视图 → 仅一通道** |
| 普通收发日志 | = 该通道下的 **收发日志** 视图（非 VT100 终端） |
| 全局菜单 | **设置**=应用偏好；**工作区**=规则会话 / 数据目录 |
| 配置迁移 | 会话保存**解析规则**（+可选偏好）；不保存易变连接快照 |
| 规则作用域 | **方案 B**：不绑死 channelId；仅对当前工作区通道的 RX 生效 |
| 视图落盘 | 写入 `~/serial-tools-data/exports|channel-logs`，展示绝对路径 |
| 本阶段不做 | 后端解析管线、Framer 接线、完整 Modbus、真 VT100、单视图多通道 |

## 3. UI 信息架构

对标 VS Code / Postman：**先选通道，再在通道内开视图 Tab**。

```
┌─────────────┬──────────────────────────────────────────┐
│ 通道列表     │ 顶栏：当前通道摘要 +「添加视图」            │
│ (主导航)     ├──────────────────────────────────────────┤
│             │ Tab: 收发日志 | 解析日志 | 监控 | 图表 | …  │
│ ─────────── │                                          │
│ 连接管理     │          ChannelWorkspace                 │
│ 端口转发     │                                          │
│ 工作区       │ 会话落盘 / Workspace 导入导出（规划）       │
│ 系统日志     │                                          │
│ 设置 / 关于  │ 仅应用偏好（编码、波特率等）               │
└─────────────┴──────────────────────────────────────────┘
```

- 换通道：只能点侧栏其它通道。
- 跨通道对比：未来并排两个工作区；禁止单图表多通道 series。

## 4. 数据流

```
spawn_reader → rx_broadcast → event_bridge("rx-data")
                                    ↓
                                 rxHub（唯一订阅）
                          ┌─────────┼─────────┐
                          ↓         ↓         ↓
                    TerminalView  protocolEngine  （其它订 Rx 的视图）
                                   ↓
                            ParsedRecord / ValueSample
                                   ↓
                         ParsedLog / Monitor / Chart
```

视图订阅时必须带 `channelId` 过滤。

## 5. Workspace 模型（version: 1）

```yaml
version: 1
channels:
  - id: serial-COM3
    rules:
      - id: temp_regex
        type: regex          # regex | json
        pattern: "TEMP:([0-9.]+)"
        fields:
          - name: temperature
            group: 1
            as: number
            unit: "C"
            valueId: temperature
    views:
      - id: term-1
        type: terminal
        config: { encoding: utf8 }
      - id: parsed-1
        type: parsed_log
      - id: mon-1
        type: monitor
        config: { valueIds: [temperature] }
      - id: chart-1
        type: chart
        config: { series: [{ valueId: temperature }] }
activeChannelId: serial-COM3
```

约束：视图创建时注入且固定 `channelId`；规则归属通道。

## 6. 模块职责

| 模块 | 路径 | 职责 |
|------|------|------|
| rxHub | `src/stores/rxHub.ts` | 唯一订 `rx-data`；去重；扇出 |
| protocolEngine | `src/protocol/engine.ts` | regex/JSON 纯函数匹配 |
| protocolStore | `src/stores/protocolStore.ts` | 通道规则；订 hub；写解析缓冲 |
| valueBus | `src/stores/valueBus.ts` | `(channelId, valueId)` 时序 |
| workspaceStore | `src/stores/workspaceStore.ts` | 活动通道、视图 Tab 实例 |
| ChannelWorkspace | `src/pages/ChannelWorkspacePage.vue` | Tab 容器 |
| View 组件 | `src/views/*` | 单通道展示 |

## 7. 视图类型路线

| type | 阶段 | 说明 |
|------|------|------|
| `terminal` | A | 经典收发 |
| `parsed_log` | A | 匹配成功日志（含时间戳） |
| `monitor` | B | 本通道多数值卡片 |
| `chart` | B | 订本通道 valueId |
| `tx_list` | D | **每条独立定时器**（周期/次数/循环）+ 变量展开 + 可选 CRC |
| `chat` | E | 对话气泡 |
| VT100 | 另项 | 不阻塞前序 |

### 定时发送 v2（真实场景）

- 条目字段：`enabled` / `intervalMs` / `loop` / `count` / `payload`（无自动后缀）
- 变量：`src/protocol/txVars.ts` 的 `TX_VAR_CATALOG` 为查阅与展开的单一真相源；`{{seq…}}` 条目、`{{channel.seq…}}` 通道
- 调度：`txPlannerStore` 按 `channelId::itemId` 独立 interval；离开视图不停止
- 可选 `frameProfile`（CRC）在变量展开之后应用

`frameBuilder`（校验）挂在发送路径，Phase D。

## 8. 分阶段验收

- **UI+A**：侧栏通道 → 工作区 Tab（终端+解析日志）；regex/JSON 规则生效；一通道过滤正确。
- **B**：同通道监控+图表。
- **C**：Workspace 导入导出恢复 views/rules。
- **D/E**：定时发送、对话；VT100 另立。

## 9. 与旧 ROADMAP 的关系

原「后端 `protocol.rs` 做实」调整为：**前端引擎优先**；Rust `protocol.rs` 保持 stub，直至二进制协议需要后端时再迁。
