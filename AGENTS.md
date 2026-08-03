# AGENTS.md

Serial Tools：基于 Tauri v2 的桌面应用（Rust 后端 + Vue 3 前端），用于串口/网络调试。
Cargo workspace：`crates/transport` + `src-tauri`；前端在 `src/`。
文档、代码注释、提交信息与 UI 文案均为**中文**——请遵循该约定。

## 命令

- 安装依赖：`npm install`
- 完整开发（Tauri 窗口，热重载）：`npm run dev:app` — Rust 改动需重启
- 仅浏览器预览：`npm run dev` — **无 Tauri IPC**；`invoke()` 会抛错（`src/api/tauri.ts` 通过 `__TAURI_INTERNALS__` 守卫）
- 前端类型检查 + 构建：`npm run build`（`vue-tsc --noEmit && vite build`）。这是**唯一**的类型检查入口；没有独立的 lint/typecheck 脚本
- 前端测试：`npm test`（Vitest，`node` 环境，文件 `src/**/*.test.ts`）
- Rust 测试：`cargo test --workspace`；聚焦：`cargo test -p transport`；仅集成：`cargo test --manifest-path src-tauri/Cargo.toml --test integration_tests`
- 完整桌面构建：`npm run build:app`（本地 Rust 后端：`cargo build`）

## 易踩的坑

- **任何针对 src-tauri 的 cargo build/test 前，`dist/` 必须存在**：`tauri::generate_context!` 在编译期校验 `frontendDist`（`../dist`）。CI 会创建占位文件；本地需先 `npm run build`（或 `mkdir dist`），否则干净检出时 `cargo test`/`cargo check` 会失败。
- **版本标识在构建期注入**：Vite 通过 `scripts/resolve-build-info.mjs` `define` 出 `__APP_VERSION__` / `__APP_GIT_HASH__` / `__APP_BUILD_DATE__`（可用环境变量 `APP_VERSION` / `APP_GIT_HASH` / `APP_BUILD_DATE` 覆盖），由 `src/buildInfo.ts` 消费。发布流水线会运行 `scripts/sync-version.mjs` 改写 `package.json` + `tauri.conf.json`。保持这些脚本可用；不要只在一个文件里手动改版本号。
- Vite dev server 为 `strictPort` 1420（必须与 `tauri.conf.json` 的 `devUrl` 一致）。
- TS 开启 `strict` + `noUnusedLocals` + `noUnusedParameters`；未使用的代码会导致 `npm run build` 失败。
- CI 会跳过纯 `docs/**` / `*.md` 改动（`.github/workflows/ci.yml` 中的 `paths-ignore`）。

## 架构

- 同步阻塞的 `Transport` trait（`crates/transport/src/lib.rs`），每个通道一个 `std::thread` 读线程——**不是** tokio 派生的 I/O。在 `src-tauri` 中，tokio 用于同步原语（`broadcast` / `Mutex` / `RwLock`）、读线程内的 `Handle::current()` + `block_on`，以及 join 读线程时的 `spawn_blocking` + `timeout`（≤2s）；阻塞 I/O 永不跑在异步运行时上。
- `AppState`（`src-tauri/src/state.rs`）：channels、tcp_servers、buses、packets（上限 10000，自动裁剪）、`rx_broadcast`、`log_broadcast`。
- 通道生命周期 / 断开逻辑集中在 `src-tauri/src/channel_lifecycle.rs` + `disconnect_reason.rs`。命令层只做编排；不要重复清理逻辑。
- 命令命名为 `connect` / `disconnect` / `disconnect_client` / `disconnect_all`（不是 open/close）。
- TCP Server 为每个客户端创建 `tcp_client-{addr}` 通道；父子关系经 `client_parents` 追踪；server 自身从不读。
- 前端**事件驱动**：Rust 广播发出 `rx-data` / `connection-changed` / `log-entry`。终端禁止轮询（用 `seq` 去重）；转发器订阅 `rx_broadcast`，绝不 `transport.read()`。
- 编码：GBK 发送经后端 `encoding_rs`；显示在前端用 `TextDecoder('gbk')` / hex。
- 协议解析引擎**仅在前端**（`src/protocol/`）；后端 `commands/protocol.rs` 是返回空列表的 stub。
- 超时分帧（`crates/transport/src/framer.rs`）**已接入串口读路径** — `src-tauri/src/state.rs` 的 `spawn_reader` 为 `serial` 通道创建 `Framer` 并喂入读取数据（只用 `byte_timeout`/`frame_timeout`；`delimiter` 恒为 `None`）。MQTT 传输是 stub；不要把它当已交付能力。
- 工作区/会话持久化为 YAML（js-yaml），经 `src/workspace/io.ts` + `schema.ts`（`kind: workspace_package`，`WORKSPACE_VERSION` 2；含 `protocolInstances`。导入时兼容旧版 `rules_session`）。新字段须加到 `normalizeTxItem` / `normalizeProtocolInstance` 里，否则 IO 测试丢字段。
- 定时发送：每条独立定时器（`txPlannerStore`）；内容里的变量（`{{seq}}` / `{{crc16:le}}` / `{{time:ms}}` 等）经 `src/protocol/txVars.ts` 展开——`TX_VAR_CATALOG` 是单一真相源（UI 说明 Drawer 直接渲染）。**变量语法是 `{{crc8}}` 无冒号（不是 `crc:8`）**；`expandTxPayload` 两遍处理：先展开非校验变量、再基于整帧算 CRC。HEX 追加校验以覆盖区间见 `sendPipeline.ts`。
- 协议扩展系统（protocol-ext）：运行时代码**全在前端**（`src/protocol-ext/`，pinia `useProtocolRuntime`）；协议包 = `manifest.yaml` + `main.js`（ESM 默认导出），改协议免重编译 Rust。`loadModuleFromSource` 用新 Blob URL 避免缓存。后端 `commands/protocol_fs.rs` 只做包管理（list/read/install zip/remove），不做解析。内置 `BUILTIN_PROTOCOL_IDS`（`loader.ts`）登记 4 个 Modbus 主/从。协议发送只走 `ctx.sendHex`，数值只走 `ctx.emitVar`；收发分开订阅 rxHub（方向 `'rx'`），防自应答死循环。

## 约定

- 不要在 UI/产品文案中宣称未实现的能力：UDP、MQTT、日志导出（BIN/CSV）、后端协议解析均**未交付**（见 `docs/ARCHITECTURE.md` §0）。协议扩展系统（protocol-ext）已交付 Modbus RTU/TCP 主/从**参考实现**，但不是产品级 Modbus（`crc16_modbus` 只是算法名）——勿在文案里与专用 Modbus 工具（Modbus Poll/Slave）混淆。
- 新增 Rust 依赖放进根 `Cargo.toml` 的 `[workspace.dependencies]`。
- Vitest 测试是纯 Node（无 jsdom）——不要写依赖 DOM 的前端测试。

## CI / Release

- CI 仅用 GitHub Actions（`.github/workflows/`），PR→`main` / push `main`。改动流水线前先读 `.github/workflows/DESIGN.md`。
- Release：tag `v*.*.*` 或手动触发 → Windows（nsis/msi）+ Linux（deb/appimage）构建矩阵 → 重命名产物 + `checksums-sha256.txt` → GitHub Release。版本必须与 tag 一致；未签名时推荐下载 `*-windows-x64-portable.exe`。
