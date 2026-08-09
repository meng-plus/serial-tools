# 协议包扩展能力路线图 Implementation Plan

> **For agentic workers:** 按任务顺序实施；每完成一块跑相关测试并提交。

**Goal:** 按 A→B→C→D 提升协议包扩展性：多文件共享 → Dev 热加载 → request/进度 → 声明式 query 绑定。

**Architecture:** 用户包装载改为「模块图 + Blob 链接」；内置包走真实 URL 相对 import。

**Tech Stack:** Vue/TS protocol-ext loader；Vitest；协议包 ESM

---

### Task A — 多文件模块图（本轮）

- [x] `moduleGraph.ts`：收集相对 import、Blob 链接、测试
- [x] `loader.loadProtocolModule`；manager 改用
- [x] 文档 + 测试通过 + commit

### Task B — 文件夹 Dev 热加载

- [x] 后端 `.dev-link` + `link_protocol_dev` / `protocol_content_mtime`；读文件走源目录
- [x] 前端 `linkDevFolder` + mtime 轮询热重载；协议页「从文件夹加载 (Dev)」
- [x] 测试通过 + commit

### Task C — request + progress

- [x] `ctx.request({ frame, match, timeout, retry })`
- [x] `ctx.emitProgress` / 面板进度条
- [x] 测试通过 + commit

### Task D — manifest queries

- [x] manifest `ui.queries` 声明式绑定 `emitInfo` / `setParam`
- [x] 测试通过 + commit
