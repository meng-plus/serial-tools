# Serial Tools

通用串口/网络通信集成调试平台。

## 功能

- **多协议连接**：UART（含 RS485 半双工标记）/ TCP Client / TCP Server；MQTT / UDP（计划中）
- **数据终端**：XShell 风格，UTF-8 / GBK / HEX；事件驱动收包
- **端口转发**：数据总线模型，点对点 / 广播 / 双向
- **协议解析**：正则 / JSON / 厂家二进制帧（分帧+字段表+校验）；不做完整 Modbus 产品化；**协议扩展系统**（前端 JS + manifest.yaml 定义/新增协议，免重编译），内置 Modbus RTU/TCP 主站+从站参考实现、演示 YMODEM 文件传输包（见 [docs/protocol-ext/](docs/protocol-ext/README.md)）
- **系统日志**：内存日志流 + 通道数据录制（BIN/CSV/HEX/TXT）；日志导出（CSV/JSON）计划中
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

## CI / CD（GitHub Actions）

设计说明（分层门禁、产物命名、构建信息）见 **[.github/workflows/DESIGN.md](.github/workflows/DESIGN.md)**，与 workflow 同目录，改流水线前请先读。

| 触发 | 内容 |
|------|------|
| GitHub PR → `main` / push `main` | L1–L3 测试与检查（Node 22）；纯 `docs/**`、`*.md` 等变更会跳过 |
| tag `v*.*.*` 或 Actions 手动 Run | Windows：**portable 免安装 exe** + nsis/msi；Linux：AppImage/deb → Release |

Windows 未代码签名前请优先下载 `*-windows-x64-portable.exe`（等同本地 `npm run build:app` 后的主程序）。安装包若被 SmartScreen 拦截属预期，可点「更多信息 → 仍要运行」。

```bash
git tag v0.1.0
git push github v0.1.0
# 或：Actions → Release → Run workflow（可填可选 notes 摘要）
```

关于页版本以发布版本为准，并显示提交 hash 与构建日期（UTC `YYYY-MM-DD`）。

## 项目结构

```
serial-tools/
├── .github/workflows/          # CI/CD + DESIGN.md
├── scripts/                    # 构建信息 / 版本同步 / 产物重命名
├── crates/
│   └── transport/              # 传输层 trait + 实现
│       └── src/
│           ├── lib.rs          # Transport trait 定义
│           ├── serial.rs       # UART/RS485
│           ├── tcp.rs          # TCP Client + Server
│           ├── mqtt.rs         # MQTT（占位）
│           ├── mock.rs         # Mock 传输（测试用）
│           └── framer.rs       # 分帧器（超时断包，已接入 serial 读路径）
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
- **broadcast 广播**：RX 经 `rx_broadcast` 多订阅者分发
- **独立读线程**：每通道 `std::thread` 同步阻塞读
- **事件驱动前端**：`rx-data` / `connection-changed`；终端默认不轮询

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 测试

```bash
# 全部 Rust 测试（transport + src-tauri）
cargo test --workspace

# 仅运行集成测试
cargo test --test integration_tests

# 前端测试（Vitest）
npm test
```

测试层级：
- **L1** Transport 单元测试（Mock 生命周期、读写、边界）
- **L2** AppState 状态管理（通道增删、数据包溢出裁剪、广播）
- **L3** TCP Loopback 功能测试（真实 TCP 收发、对端关闭检测）
- **L4** 转发场景测试（Mock 单向/双向、TCP↔Mock、TCP↔TCP）

## 文档

| 文档 | 说明 |
|------|------|
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | 跨平台环境搭建 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构真相与规范 |
| [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) | 设计决策 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 后续优先级 |
| [docs/requirements.md](docs/requirements.md) | 需求文档 |

## 许可证

MIT License

## 作者

**mengplus（蒙蒙plus）**
- Email: chengmeng_2@outlook.com
- GitHub: https://github.com/meng-plus/serial-tools
- QQ 群: 790012859
