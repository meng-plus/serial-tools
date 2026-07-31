# 协议多视图 — 验收（Phase UI + A）

| 项 | 结果 |
|----|------|
| 设计文档在仓库 `docs/protocol-multi-view/` | 是 |
| 侧栏以通道为主导航，点通道进工作区 | 是 |
| 工作区 Tab：终端 / 解析日志 / 监控 | 是 |
| 视图固定单通道，无视图内换通道 | 是 |
| rxHub 唯一订 `rx-data`；terminal 订 hub | 是 |
| regex / json 规则匹配 + 数值进 valueBus | 是 |
| `npm test` 42 passed；`vue-tsc --noEmit` 通过 | 是 |
| Chart / Workspace 导出 / 定时发送 / 对话 | Chart / 整包 I/O / 定时发送 v2 **已完成**；对话待办 |
