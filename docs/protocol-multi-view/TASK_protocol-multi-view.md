# 协议多视图 — 任务拆分

> 对应设计：[DESIGN_protocol-multi-view.md](./DESIGN_protocol-multi-view.md)

| ID | 阶段 | 交付 | 状态 |
|----|------|------|------|
| UI | 通道工作区壳 | 侧栏通道列表、`ChannelWorkspace`、视图 Tab | **已完成** |
| A | 总线+引擎 | rxHub、protocolEngine、valueBus、收发/解析/监控 | **已完成** |
| B | 监控+图表 | ChartView（vue-echarts 订 valueId）+ 监控刷新 | **已完成** |
| C | Workspace I/O | version:1 整包导入导出（规则已可会话保存） | **已完成** |
| D | 发送编排 | txPlanner、frameBuilder、TxListView | **已完成** |
| D2 | 定时发送 v2 | 每条独立周期/次数/变量目录+展开 | **已完成** |
| E | 对话/VT100 | ChatView + Vt100View（xterm） | **已完成** |
| DOC | 文档对齐 | DESIGN / TASK / ARCHITECTURE / ROADMAP | **已完成** |

## Phase E 文件

- `src/views/ChatView.vue` — 气泡对话
- `src/views/Vt100View.vue` — `@xterm/xterm` + FitAddon
- `ViewType` 增加 `vt100`

## Phase C / D 文件

- `src/workspace/{schema,io}.ts` — Workspace 整包（条目级 timer 字段 + 旧包迁移）
- `src/protocol/frame.ts` — CRC16-Modbus / sum8 / applyFrame
- `src/protocol/txVars.ts` — 变量目录 + expand
- `src/stores/txPlannerStore.ts` — 按条目独立定时器
- `src/views/TxListView.vue` — 启停/变量说明 Drawer
- `WorkspacePage` 整包导出/导入；`ChannelWorkspace` 启用定时发送 Tab
