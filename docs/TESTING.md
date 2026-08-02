# Serial Tools 测试策略

## 测试分层

| 层级 | 类型 | 框架 | 位置 | 数量 |
|------|------|------|------|------|
| L1 | Transport scope 单元测试 | cargo test | `crates/transport` | 49 |
| L2 | src-tauri 单元测试 | cargo test | `src-tauri/src/`（含 domain/commands/fs_util） | 51 |
| L3 | 集成测试（AppState/事件/转发/总线） | cargo test | `src-tauri/tests/integration_tests.rs` | 31 |
| **Rust 合计** | | | | **131** |
| L4 | 前端测试 | vitest | `src/**/*.test.ts` | 139（22 文件） |
| **总计** | | | | **270** |

> 数量统计于 2026-08-02；以 `cargo test --workspace` 与 `npm test` 的实际输出为准。

## 运行命令

```bash
# 所有 Rust 测试
cargo test --workspace

# 仅 transport crate 测试
cargo test -p transport

# 仅集成测试
cargo test --manifest-path src-tauri/Cargo.toml --test integration_tests

# 前端测试
npm test

# 前端测试（watch 模式）
npm run test:watch
```

## L1: 单元测试 (Transport crate)

**覆盖范围**（未穷举，以实际为准）：

- **L1 `crates/transport`（49）**：MockTransport 生命周期 / 读写 / 边界；TCP Client 连接与收发；tcp 模块（server 多客户端、kick、from_stream）；framer 定界符 / 超时 / 空输入；mqtt stub 返回错误；config 序列化往返；Duplex 模式。
- **L2 `src-tauri/src`（51）**：`domain/`（packet_store 溢裁 · bus_registry 启停 · channel_manager · log_source）、`commands/fs_util`（文件名净化 / 二进制落盘往返）、录制与协议文件管理等单测。
- **L3 集成（31）**：AppState 管理 / 事件桥接（log、rx 多订阅者）/ TCP 回环与多客户端并发 / 转发场景（mock、tcp↔tcp、serial↔tcp）/ 总线创建、mock 转发、方向枚举。
- **L4 前端 vitest（22 文件 · 139）**：见下方。
- **L5 数据总线**：创建/列表、mock 转发、方向枚举（并入集成测试）。

## 前端测试（vitest）

**覆盖范围**：Store 逻辑、协议解析、协议扩展系统、工具函数、API 层。

| 文件 | 验证点 |
|------|--------|
| `stores/terminalStore` | 初始化、sendText/sendHex、按通道/子通道过滤、计数、编码、清空 |
| `stores/connectionStore` | 初始化、refreshStatus、loadPorts、connect/disconnect/disconnectAll、connectedChannels |
| `stores/logStore` | 初始化、fetch、clear、级别过滤 |
| `stores/sessionStore` | 初始化、loadList/load/save/remove、删除当前会话不改 currentSession |
| `stores/rxHub` | 事件扇出与去重 |
| `protocol/engine` | 正则 / JSON 规则匹配 |
| `protocol/checksum` · `frame` | 校验算法 / 帧构建 / CRC16-Modbus / sum8 |
| `protocol/sendPipeline` · `txVars` | 发送管线、定时发送、变量展开 |
| `protocol-ext/manifest` | manifest 解析（含 file 参数、accept、默认值） |
| `protocol-ext/manager` | 实例创建 / coerceParam / 生命周期 |
| `protocol-ext/utils` | 协议工具（hex 转换、CRC16-Modbus / crc16Xmodem、校验追加/验证） |
| `protocol-ext/fileCache` | 文件字节缓存 get/drop |
| `protocol-ext/modbus-rtu-master` · `modbus-rtu-slave` | 参考协议状态机 |
| `protocol-ext/ymodem` | YMODEM 状态机（CRC 向量、块构建/解析、发送/接收全流程、取消） |
| `workspace/io` | 整包导入导出 |
| `utils/error` · `updater` · `exportFile` | 错误解析、版本比较、导出 |
| `api/tauri` | Tauri 环境检测 / invoke |
