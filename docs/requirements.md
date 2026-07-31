# Serial Tools 需求文档

> 版本：v2.0 | 更新：2026-07-31
> 文档先行，基于已实现代码补全

---

## 1. 产品定位

通用串口调试工具，支持 UART（含 RS485 单总线）/ TCP / UDP / MQTT 多种通信方式，提供数据收发、转发、日志录制、协议解析等功能。

**技术栈**：Rust + Tauri v2 + Vue 3 + TypeScript + Pinia + Ant Design Vue

---

## 2. 功能需求

### 2.1 连接管理

| 类型 | 模式 | 说明 |
|------|------|------|
| UART | 全双工 / 半双工(RS485) | 支持波特率、数据位、停止位、校验位配置 |
| TCP | Client / Server | Server 默认 16 连接，可配置最大连接数 |
| UDP | Client / Server / 多播 | 支持单播、服务器监听、多播组 |
| MQTT | Client | 订阅/发布，支持 TLS（计划） |

**RS485 要求**：
- DE/RTS 方向控制由硬件管理，程序不控制 GPIO
- 仅需限制：接收有数据期间不发起发送（半双工互斥）

**TCP Server 要求**：
- 每个客户端连接创建独立通信通道线程
- 支持动态踢出客户端
- 最大连接数可配置

### 2.2 数据收发终端

- XShell 风格终端界面
- 支持文本和 HEX 两种发送模式
- 可配置发送后缀 (CR/LF/CRLF)
- 数据包收发记录和统计
- **编码切换**：UTF8 / GBK / HEX 三种展示方式，前端可实时切换

### 2.3 接收处理管线（Framer + Pipeline）

- **字节超时分帧**：两个字节间超过阈值（默认 50ms）视为一包结束
- **帧超时**：从收到首字节开始计时，超过阈值（默认 200ms）强制断包
- **定界符分帧**：按指定分隔符切分
- **长度前缀分帧**：按头部长度字段切分
- **NDJSON 分帧**：按换行符切分
- 每包数据携带**接收时间戳**（毫秒精度），方便前端展示

### 2.4 端口转发

- 支持任意通道间转发（串口↔TCP、TCP↔MQTT 等）
- 多条转发规则并行运行
- 转发方向：单向 / 双向
- 转发统计 (RX/TX 字节数)
- 独立转发管理面板

### 2.5 协议解析

- Modbus RTU/TCP 协议解析
- JSON 数据字段提取
- 正则表达式文本匹配
- 字节模式匹配

### 2.6 日志录制

**可配置录制格式**：

| 格式 | 说明 |
|------|------|
| BIN | 最原始字节，rx/tx 独立存储文件 |
| CSV | 带时间戳，支持按展示方式记录（UTF8/GBK/HEX） |
| HEX TEXT | 十六进制文本记录 |

### 2.7 会话管理

- 会话配置保存/加载（YAML 格式）
- 会话列表管理
- 连接状态实时显示

### 2.8 系统日志

- 操作日志记录
- 日志级别过滤
- 日志导出 (CSV/JSON)

---

## 3. 架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│  UI Layer (Vue 3 + Pinia + Ant Design Vue)          │
│  观察者模式，Tauri 事件驱动更新                       │
├─────────────────────────────────────────────────────┤
│  Command Layer (Tauri Commands)                      │
│  connection / data / forward / protocol / log / config│
├─────────────────────────────────────────────────────┤
│  State (AppState)                                    │
│  channels / forwarders / packets / rx_broadcast      │
├─────────────────────────────────────────────────────┤
│  Transport Layer (trait)                             │
│  Serial │ TCP Client │ TCP Server │ MQTT │ Mock      │
└─────────────────────────────────────────────────────┘
```

### 3.2 设计模式

- **Trait 抽象**：Transport trait 统一传输层接口，上层不关心底层类型
- **观察者模式**：数据接收通过 `broadcast::channel` 广播（`RxBroadcastEvent`），UI 和转发器都订阅
- **独立线程**：每个通道一个独立读线程，不阻塞主线程
- **Manager 模式**：AppState 统一管理所有通道和转发器

### 3.3 Transport Trait

```rust
pub trait Transport: Send + Sync {
    fn open(&mut self) -> Result<(), TransportError>;
    fn close(&mut self) -> Result<(), TransportError>;
    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError>;
    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError>;
    fn is_active(&self) -> bool;
    fn descriptor(&self) -> &TransportDescriptor;
}
```

### 3.4 线程模型

```
每个通信通道 = 1 个独立读线程
  read() 阻塞读取 → 推入 packets + broadcast 广播

TX 路径（同步）：
  前端发送 → Tauri command → AppState.send_to_channel() → Transport.write()
```

| Transport | 线程数 | 通道数 | 说明 |
|-----------|--------|--------|------|
| UART | 1 读线程 | 1 | 独占串口 |
| TCP Server | 1 监听 + N 读线程 | N | 每客户端一个 |
| TCP Client | 1 读线程 | 1 | 单连接 |
| UDP | 1 读线程 | 1 | 单 socket |

---

## 4. 数据流

### RX 路径
```
Transport.read() → 读线程 → packets 缓冲 + rx_broadcast 广播
                                      ↓                    ↓
                               前端 terminalStore     Forwarder 订阅转发
```

### TX 路径
```
前端输入 → Tauri command(data::send) → AppState.send_to_channel() → Transport.write()
```

---

## 5. 通信转发

- `ForwarderInfo` 记录转发规则（源通道 → 目标通道，方向，统计）
- `ForwarderHandle` 持有 cancel 标志和线程句柄
- 转发线程订阅 `rx_broadcast`，匹配源通道后写入目标通道
- 支持双向转发

---

## 6. 技术约束

- Rust 编译零错误
- 异步架构（tokio + std::thread 混合：读线程用 std::thread 避免 async 阻塞）
- 配置默认 YAML（兼容 JSON）
- 前端事件驱动，不使用轮询

---

## 7. 实施进度

### ✅ 已完成
- [x] Transport trait + Serial/TCP/MQTT/Mock 实现
- [x] 独立读线程 + broadcast 广播
- [x] AppState 多通道管理
- [x] 转发器框架
- [x] Tauri 命令层（connection/data/forward/protocol/log/config）
- [x] Vue 前端 6 页面（Connection/Terminal/Forward/Protocol/Log/Settings）
- [x] 单元测试 + 集成测试（42 项通过）

### 📋 待完善
- [ ] RS485 半双工互斥控制（硬件层面，当前未限制发送时机）
- [ ] TCP Server 多客户端独立通道（当前仅 TCP Client）
- [ ] 超时断包参数可配置化
- [ ] 日志录制 BIN/CSV/HEX 格式
- [ ] 前端编码切换（UTF8/GBK/HEX）
- [ ] 转发器面板 UI 完善
