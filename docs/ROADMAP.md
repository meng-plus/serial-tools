# Serial Tools 路线图

> 2026-07-31 · 基础通信链路已可用后的优先序

## 近期已完成（基线）

- TCP Server 多客户端 + 踢出 + 事件清单
- 终端事件驱动 RX、seq 去重、GBK 发送
- 断开原因区分、优雅 FIN
- 自定义右键、关于页 / 图标 / 迁移 GitHub 主仓库
- 维护整理：`DisconnectReason` + `channel_lifecycle`、tcp 模块拆分、stub 标清

## 推荐下一阶段（按价值）

### P0 — 协议解析 + 通道多视图（前端引擎）

- 设计见 [protocol-multi-view/DESIGN_protocol-multi-view.md](./protocol-multi-view/DESIGN_protocol-multi-view.md)
- ✅ rxHub + regex/JSON + valueBus + 通道工作区（收发/解析/监控/图表）
- ✅ Workspace 整包 YAML/JSON 导入导出；定时发送 v2（每条独立周期/次数/变量）
- ✅ 对话气泡 + VT100 交互终端（xterm.js）
- ✅ 厂家二进制协议：分帧（定界符+超时）+ 校验目录 + 字段解码
- 下一步：终端偏好增强 / 其它能力（按需）
- **明确不做**：完整 Modbus 主站/从站（专用工具更合适）

### P1 — 终端效率

- ✅ 定时发送 v2、收发日志发送历史/重发、变量+CRC 覆盖
- ✅ 串口超时断包可配置（全局默认 + 通道顶栏）
- ✅ VT100 复制/粘贴、Ctrl+滚轮字号
- 日志导出更多格式（BIN/CSV）按需

### P1 — 文案与能力对齐

- About / README 持续对齐已交付能力
- UDP / MQTT 未做前不写入「功能特性」为已交付

### P2 — 会话增强

- 保存会话后一键重连串口 / TCP

### P3 — 结构演进（勿抢跑）

- ChannelManager / ProtocolChannel crate
- Framer 接入后端协议解析管线
- RS485 软件收发互斥

## 明确暂缓

| 项 | 原因 |
|----|------|
| 独立 ChannelManager crate | DESIGN：稳定后再拆 |
| 完整 MQTT / UDP | 无刚需前不占排期 |
| async Transport 整仓重写 | 与现 sync+thread 决策冲突 |
