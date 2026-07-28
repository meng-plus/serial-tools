# Serial Tools 设计决策

## 1. 选择 Tauri v2 而非 Electron

**决策**: 使用 Tauri v2 作为桌面应用框架。

**理由**:
- Rust 后端性能优秀，适合串口通信场景
- 包体积小 (相比 Electron 减少 90%+)
- 原生 Rust 串口库 (serialport) 集成方便
- 安全性更高

## 2. Rust Workspace 多 Crate 架构

**决策**: 将 Rust 代码拆分为 8 个独立 crate。

**理由**:
- 编译并行化，增量编译更快
- 职责清晰：transport/framing/channel/protocol/pipeline 各司其职
- 可测试性：每个 crate 可独立编写单元测试
- 便于复用：transport trait 可被其他项目使用

## 3. Transport Trait 统一抽象

**决策**: 定义 Transport trait 统一串口、TCP、MQTT 传输层。

**理由**:
- 上层代码无需关心底层传输类型
- 端口转发功能可直接复用 Transport trait
- 便于添加新传输类型 (如 UDP、WebSocket)

## 4. Framer 独立于 Transport

**决策**: Framer 仅负责 RX 方向的分帧，不参与 TX 编码。

**理由**:
- 分帧逻辑与传输层解耦
- 多种分帧策略可并存 (ByteTimeout、Delimiter、LengthPrefix)
- TX 编码通常很简单 (直接发送)，不需要 Framer

## 5. Pinia 状态管理

**决策**: 使用 Pinia 管理前端状态。

**理由**:
- Vue 3 官方推荐的状态管理方案
- TypeScript 支持优秀
- 轻量且易于调试

## 6. Ant Design Vue UI 框架

**决策**: 使用 Ant Design Vue 作为 UI 组件库。

**理由**:
- 企业级组件丰富 (Table、Form、Select 等)
- 中文文档和社区支持好
- 与 Serial Studio 设计风格一致

## 7. 会话配置使用 YAML

**决策**: 会话配置文件使用 YAML 格式。

**理由**:
- 可读性好，便于手动编辑
- 支持注释
- 与 Serial Studio 配置格式兼容
