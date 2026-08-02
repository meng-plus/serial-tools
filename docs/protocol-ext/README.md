# 协议扩展系统（protocol-ext）

> 2026-08-02 上线。协议组件扩展化：新增 / 修改协议只需写前端 JS 脚本 + 声明式 manifest，**无需重新编译 Rust 后端**。

## 是什么

协议引擎完全运行在前端（`src/protocol-ext/`），后端只提供「协议包的文件管理」（`src-tauri/src/commands/protocol_fs.rs`：列表 / 读文件 / 安装 zip / 移除）。

一个「协议包」= 一个目录，包含：

```
my-protocol/
├── manifest.yaml   # 协议元信息（id/名称/参数表/动作表/变量表）
├── main.js         # 协议实现（ESM 默认导出，使用注入的 ctx）
└── main.d.ts       # 可选：ABI 类型提示（编辑器用，不参与运行）
```

协议包来源：

| 来源 | 位置 | 说明 |
|------|------|------|
| 内置（builtin） | `public/protocols/builtin/<id>/` | 随应用打包，Vite 原样拷贝到 dist |
| 用户安装（user） | 数据目录 `protocols/<id>/` | 通过「协议扩展」页安装 zip 得到 |
| 模板（templates） | `public/protocols/templates/` | 制作新协议的起点，不参与运行 |

内置协议（参考实现，可照抄）：

- `modbus-rtu-master` / `modbus-rtu-slave` —— RTU 主站轮询 / 从站应答（CRC16-Modbus），同一通道上可做本地主从闭环
- `modbus-tcp-master` / `modbus-tcp-slave` —— 同上，MBAP 封装

演示包：`public/protocols/demo/demo-passive.zip`（可直接在「协议扩展」页安装体验）。
YMODEM 文件传输（双向、固件升级/备份）：`public/protocols/demo/ymodem.zip`，见 [YMODEM.md](./YMODEM.md)。

## 文档导航

| 文档 | 内容 |
|------|------|
| [MANIFEST.md](./MANIFEST.md) | manifest.yaml 字段全解 |
| [ABI.md](./ABI.md) | 协议实现体（main.js）API：生命周期 / ctx / utils / 变量与数据导出 |
| [AUTHORING.md](./AUTHORING.md) | 从零写一个协议包的完整流程（被动 / 主站 / 从站） |
| [TEMPLATES.md](./TEMPLATES.md) | 内置模板说明与复制方法 |
| [YMODEM.md](./YMODEM.md) | YMODEM 文件传输扩展包：安装 / 使用 / 实现要点 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 常见问题排查 |

## 术语

- **协议包（ProtocolPackage）**：一个目录（含 manifest + 实现），可被创建实例。
- **实例（ProtocolInstance）**：协议包 + 某个通道 + 一套参数。同一协议可在多个通道上各自运行。
- **角色（role）**：`passive`（被动解析）/ `master`（主动轮询）/ `slave`（应答式）。
- **扩展点**：`ctx.emitVar` 推送数值样本 → 监控 / 图表 / 数据导出 / 仪表盘订阅；`ctx.sendHex` 发送数据。

## 架构总览

```
┌────────────────────────────── 前端 ──────────────────────────────┐
│  ProtocolPage（管理页）                                           │
│    │ 安装 zip / 创建实例 / 启停 / 参数导入导出 / 数据导出 / 日志     │
│  ProtocolDashboardView（仪表盘：网格布局，绑实例 + 控件）            │
│                                                                    │
│  useProtocolRuntime（pinia store, src/protocol-ext/manager.ts）    │
│    ├─ loader：加载内置(fetch) / 用户包(IPC) 的 manifest + main.js  │
│    ├─ moduleCache：Blob URL 动态 import 的模块缓存                  │
│    ├─ rxHub 订阅 → match/handle(从站) 或 onRx(其它)                 │
│    ├─ 每 50ms tick → onTick                                        │
│    └─ valueBus.push ← ctx.emitVar                                  │
└───────────────┬────────────────────────────────────────────────────┘
                │ invoke: list/read/install/remove_protocol
┌───────────────▼───────────────────────────────────────────────────┐
│  后端 protocol_fs.rs                                               │
│    zip 安全解压（防穿越/校验 manifest/剥顶层目录/版本冲突）→ 原子替换  │
└───────────────────────────────────────────────────────────────────┘
```

> 数据发送统一走 `ctx.sendHex`（内部调用 `send_data`，无后缀追加）；通道收到数据由 rxHub 分发。协议实例不直接碰 store，只通过注入的 ctx。
