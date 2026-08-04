# Serial Tools 路线图

> 2026-08-02 · 基础通信链路已可用后的优先序

## 近期已完成（基线）

- TCP Server 多客户端 + 踢出 + 事件清单
- 终端事件驱动 RX、seq 去重、GBK 发送
- 断开原因区分、优雅 FIN
- 自定义右键、关于页 / 图标 / 迁移 GitHub 主仓库
- 维护整理：`DisconnectReason` + `channel_lifecycle`、tcp 模块拆分、stub 标清
- S1 错误类型化：`CommandError {code,message}` + `TransportError::fatal_kind()`（WSA 映射）
- S2 录制接线：DataLogger（CSV/HEX/BIN/TXT）+ RecordingRegistry + 前端录制 UI
- S3 领域服务拆分：`domain/{packet_store,bus_registry,channel_manager}`（内部模块）
- S4 日志来源枚举化：`LogSource`（序列化契约不变）
- S5 前端规范化：vendor 分包（vue-vendor/antd/echarts/xterm）
- 新增：About 页更新检查 / GitHub Issues / gitea 引用清除
- S8 协议扩展系统（protocol-ext）：前端 JS + manifest 免重编译协议；内置 Modbus 主从 + 演示包；详见 [protocol-ext/](./protocol-ext/README.md)
- YMODEM 文件传输（file 参数 + ctx.getFile/saveFile + crc16Xmodem，手动安装演示包）

## 推荐下一阶段（按价值）

### P0 — 协议解析 + 通道多视图（前端引擎）

- 设计见 [protocol-multi-view/DESIGN_protocol-multi-view.md](./protocol-multi-view/DESIGN_protocol-multi-view.md)
- ✅ rxHub + regex/JSON + valueBus + 通道工作区（收发/解析/监控/图表）
- ✅ Workspace 整包 YAML/JSON 导入导出；定时发送 v2（每条独立周期/次数/变量）
- ✅ 对话气泡 + VT100 交互终端（xterm.js）
- ✅ 厂家二进制协议：分帧（定界符+超时）+ 校验目录 + 字段解码
- ✅ **协议扩展系统（protocol-ext）**：前端 JS 脚本 + manifest.yaml 免重编译新增协议；内置 Modbus RTU/TCP 主站+从站参考实现（本地主从闭环自测）、模板、演示 zip；实例自动带入协议面板（寄存器网格，双击写值）；工作区持久化协议实例。详见 [protocol-ext/](./protocol-ext/README.md)
- 下一步：终端偏好增强 / 更多内置协议示例（按需）
- **不再做**完整 Modbus 商用产品化（协议引擎已可承载，但专用工具更合适）

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

- ✅ 领域状态内部模块化（`domain/packet_store` · `bus_registry` · `channel_manager` · `log_source`）
- 独立 ChannelManager / ProtocolChannel crate（待接口稳定后拆）
- Framer 接入后端协议解析管线
- RS485 软件收发互斥

## 明确暂缓

| 项 | 原因 |
|----|------|
| 独立 ChannelManager crate | DESIGN：内部模块已落地，稳定后再拆 |
| 完整 MQTT / UDP | 无刚需前不占排期 |
| async Transport 整仓重写 | 与现 sync+thread 决策冲突 |
| 浏览器 E2E（WebdriverIO+tauri-driver） | 环境成本高，暂以 `cargo test` 集成测试 + `npm test` 覆盖 |
