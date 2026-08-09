# 协议面板 info/setParam 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为协议扩展增加 `emitInfo` + `setParam` 与 `info_panel`，示例主站查询结果可见且 `查询应答` 自动回写 APP 起始地址。

**Architecture:** 实例级 info 映射与参数回写走 runtime；数值仍走 valueBus。面板按「动作 / 结果 / 数值」分区；示例协议 manifest 落地样板。

**Tech Stack:** Vue 3 + Pinia + Vitest；协议包 JS（Blob 加载）+ manifest.yaml

**Spec:** `docs/superpowers/specs/2026-08-08-protocol-panel-info-ui-design.md`

## Global Constraints

- 中文 UI / 注释 / 提交说明  
- Vitest 纯 Node，无 jsdom  
- 不做拖拽布局  
- `emitVar` 仅数值；文本走 `emitInfo`  
- 功能分支只推 `gitea-mirror`（本计划不强制 push）

---

## File map

| 文件 | 职责 |
|------|------|
| `src/protocol-ext/types.ts` | ProtocolContext / DashboardControl 类型 |
| `src/protocol-ext/ctx.ts` | 注入 setParam / emitInfo |
| `src/protocol-ext/manager.ts` | infoByInstance、setParam、清理 |
| `src/protocol-ext/infoStore.ts`（新，可选内联 manager） | 或直接放 manager |
| `src/components/protocol/InfoPanel.vue`（新） | info_panel 展示 |
| `src/views/ProtocolPanelView.vue` | 挂载 InfoPanel；顶栏去重 |
| `src/protocol-ext/manifest.ts` + test | 解析 info_panel |
| `docs/protocol-ext/ABI.md` / `MANIFEST.md` | 文档 |
| `示例协议包` | 可选落地验证 |
| 相关协议扩展测试 | 回归 |

---

### Task 1: ABI — setParam + emitInfo（runtime）

**Files:** `types.ts`, `ctx.ts`, `manager.ts`, 新测 `manager.info.test.ts` 或扩现有测

- [ ] 写失败测试：emitInfo 覆盖同 key；setParam 合并 params 并在 enabled 时调 setConfig  
- [ ] 实现 info map（removeInstance 时清理）  
- [ ] createContext 注入 setParam / emitInfo  
- [ ] `npm test` 相关文件通过  
- [ ] Commit：`feat(protocol-ext): ctx.emitInfo / setParam 与实例 info 存储`

### Task 2: info_panel 控件 + 面板顶栏去重

**Files:** `InfoPanel.vue`, `ProtocolPanelView.vue`, `manifest.ts`, `types.ts`, tests

- [ ] manifest 解析 `type: info_panel` + `keys`  
- [ ] InfoPanel 从 runtime 读 info 展示  
- [ ] 有 groups.buttons 时顶栏不重复刷全部 actions  
- [ ] Commit：`feat(protocol-ext): info_panel 控件与面板动作去重`

### Task 3: 示例协议落地（可选）

**Files:** 示例协议 `main.js` / `manifest.yaml` / `README.md` / 测试与 zip

- [ ] 查询应答 emitInfo；q4201 setParam firmware_start/capacity  
- [ ] dashboard 改 info_panel；firmware 组加下载按钮  
- [ ] 测试：q4201 回写与 info  
- [ ] 重打包 zip  
- [ ] Commit：示例协议查询结果展示与参数回写

### Task 4: 文档

**Files:** `ABI.md`, `MANIFEST.md`, 必要时 `AGENTS.md`

- [ ] 文档与实现对齐  
- [ ] Commit：`docs(protocol-ext): emitInfo / setParam / info_panel`

### Task 5: 冒烟验收

- [ ] `npm test` 协议相关全绿  
- [ ] 手动清单：见 design §10（若无桌面环境则依赖自动化）  
