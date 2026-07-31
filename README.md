# Serial Tools

通用串口/网络通信集成调试平台。

## 功能

- **多协议连接**：UART（含 RS485 半双工）/ TCP Client / TCP Server / MQTT（计划中）
- **数据终端**：XShell 风格，支持 UTF-8 / GBK / HEX 实时切换
- **端口转发**：任意通道间桥接，单向 / 双向，多规则并行
- **协议解析**：Modbus RTU/TCP、JSON 字段提取、正则匹配（计划中）
- **日志录制**：BIN / CSV / HEX 多格式（计划中）
- **会话管理**：YAML 配置保存 / 加载

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Rust + Tauri v2 |
| 前端 | Vue 3 + TypeScript + Pinia + Ant Design Vue |
| 传输层 | serialport / std::net / tokio |
| 构建 | Vite + tauri-cli |

## 快速开始

### 前置条件

- **Node.js** >= 18
- **Rust** (rustup) >= 1.70
- **平台构建工具**：见 [环境搭建指南](docs/ENVIRONMENT.md)

### 开发

```bash
# 安装前端依赖
npm install

# 开发模式（热重载）
npm run dev:app

# 或仅启动前端（浏览器预览，无法使用 Tauri IPC）
npm run dev
```

### 构建

```bash
# 正式构建
npm run build:app

# 仅后端（不打包）
cargo build
```

构建产物位于 `src-tauri/target/release/bundle/`。

详细构建指南见 [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)。

## 项目结构

```
serial-tools/
├── crates/
│   └── transport/              # 传输层 trait + 实现
│       └── src/
│           ├── lib.rs          # Transport trait 定义
│           ├── serial.rs       # UART/RS485
│           ├── tcp.rs          # TCP Client + Server
│           ├── mqtt.rs         # MQTT（占位）
│           ├── mock.rs         # Mock 传输（测试用）
│           └── framer.rs       # 分帧器（超时/定界符/长度前缀）
├── src-tauri/                  # Tauri 后端
│   ├── src/
│   │   ├── lib.rs              # Tauri 入口 + 命令注册
│   │   ├── state.rs            # AppState 全局状态
│   │   ├── event_bridge.rs     # 事件桥接（broadcast → Tauri emit）
│   │   ├── commands/           # Tauri 命令层
│   │   │   ├── connection.rs   #   连接管理
│   │   │   ├── data.rs         #   数据收发
│   │   │   ├── forward.rs      #   端口转发
│   │   │   ├── protocol.rs     #   协议解析
│   │   │   ├── log.rs          #   日志
│   │   │   └── config.rs       #   配置管理
│   │   └── tests/
│   │       └── integration_tests.rs
│   └── tauri.conf.json
├── src/                        # Vue 3 前端
│   ├── pages/                  # 页面组件
│   │   ├── ConnectionPage.vue  #   连接管理
│   │   ├── TerminalPage.vue    #   数据终端
│   │   ├── ForwardPage.vue     #   端口转发
│   │   ├── ProtocolPage.vue    #   协议解析
│   │   ├── LogPage.vue         #   系统日志
│   │   ├── SettingsPage.vue    #   设置
│   │   └── AboutPage.vue       #   关于
│   ├── stores/                 # Pinia 状态管理
│   ├── api/                    # Tauri IPC 封装
│   ├── router/                 # Vue Router
│   └── App.vue                 # 根组件
├── docs/                       # 文档
├── Cargo.toml                  # Workspace 根
└── package.json
```

## 架构

```
┌─────────────────────────────────────────────────┐
│  UI Layer (Vue 3 + Pinia + Ant Design Vue)      │
│  观察者模式，Tauri 事件驱动更新                     │
├─────────────────────────────────────────────────┤
│  Command Layer (Tauri Commands)                  │
│  connection / data / forward / protocol / log    │
├─────────────────────────────────────────────────┤
│  State (AppState)                                │
│  channels / forwarders / packets / rx_broadcast  │
├─────────────────────────────────────────────────┤
│  Transport Layer (trait)                         │
│  Serial │ TCP Client │ TCP Server │ MQTT │ Mock  │
└─────────────────────────────────────────────────┘
```

核心设计：
- **Transport trait**：统一传输层接口，上层不关心底层类型
- **broadcast 广播**：RX 数据通过 `tokio::sync::broadcast` 多订阅者分发
- **独立读线程**：每个通道 `std::thread` 同步阻塞读取，不阻塞 tokio runtime
- **事件驱动前端**：Tauri `listen()` 推送，零轮询

详细架构文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 测试

```bash
# 运行全部测试（42 项）
cargo test

# 仅运行集成测试
cargo test --test integration_tests
```

测试层级：
- **L1** Transport 单元测试（Mock 生命周期、读写、边界）
- **L2** AppState 状态管理（通道增删、数据包溢出裁剪、广播）
- **L3** TCP Loopback 功能测试（真实 TCP 收发、对端关闭检测）
- **L4** 转发场景测试（Mock 单向/双向、TCP↔Mock、TCP↔TCP）

## 文档

| 文档 | 说明 |
|------|------|
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | 跨平台环境搭建指南 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构详解 |
| [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) | 设计决策记录 |
| [docs/requirements.md](docs/requirements.md) | 需求文档 |

## 许可证

MIT License

## 作者

**mengplus（蒙蒙plus）**
- Email: chengmeng_2@outlook.com
- Gitea: https://gitea.mengplus.top/gltech/serial-tools
