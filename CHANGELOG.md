# 更新日志

## [0.1.0] - 2026-07-31

### 新增
- Transport trait 统一抽象层（Serial / TCP Client / TCP Server / MQTT / Mock）
- Tauri v2 桌面应用框架
- Vue 3 前端 6 个功能页面：连接管理、终端、转发、协议、日志、设置
- TCP Server 多客户端支持（独立通道、独立读线程）
- 端口转发引擎（单向/双向，多规则并行）
- Framer 分帧器（超时断包、定界符、长度前缀）
- 事件驱动架构（broadcast 广播 + Tauri emit 桥接）
- 会话管理（YAML 配置保存/加载）
- 42 项测试（单元测试 + 功能测试 + 场景测试）
- 关于页面

### 架构
- Workspace 分 crate：`transport` 独立可复用
- `std::thread` 同步读线程 + tokio 异步管理
- `broadcast::channel` 多订阅者零拷贝数据分发
- Pinia stores 事件驱动更新，无轮询
