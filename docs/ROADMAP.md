# Serial Tools 路线图

> 2026-07-31 · 基础通信链路已可用后的优先序

## 近期已完成（基线）

- TCP Server 多客户端 + 踢出 + 事件清单
- 终端事件驱动 RX、seq 去重、GBK 发送
- 断开原因区分、优雅 FIN
- 自定义右键、关于页 / 图标 / 去 gltech

## 推荐下一阶段（按价值）

### P0 — 协议解析做实

- 将 `rx-data` / packets 接入解析管线
- 先落地：正则 / 简单字节模式；再 Modbus RTU
- 替换 `commands/protocol.rs` 空实现

### P1 — 终端效率

- 定时发送、发送历史 / 快捷指令
- 日志导出（选中通道 TXT/HEX/CSV）

### P1 — 文案与能力对齐

- About / README 已标清「计划中」
- UDP / MQTT / 导出未做前不写入「功能特性」为已交付

### P2 — 会话增强

- 保存会话后一键重连串口 / TCP

### P3 — 结构演进（勿抢跑）

- ChannelManager / ProtocolChannel crate
- Framer 正式接入读路径
- RS485 软件收发互斥

## 明确暂缓

| 项 | 原因 |
|----|------|
| 独立 ChannelManager crate | DESIGN：稳定后再拆 |
| 完整 MQTT / UDP | 无刚需前不占排期 |
| async Transport 整仓重写 | 与现 sync+thread 决策冲突 |
