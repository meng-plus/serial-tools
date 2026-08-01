# CI/CD 设计说明（与 workflows 同目录）

> 调整流水线前请先读本文，避免偏离分层门禁与产物约定。  
> 宿主：**GitHub Actions**（`github` 远端）。Gitea `origin` 为镜像仓，不强制双跑 CI。

## 目标

| 节奏 | 行为 |
|------|------|
| PR（→ `main`）/ push `main` | 按架构分层跑**测试 + 检查**，不打安装包 |
| push tag `v*.*.*` 或 **手动 Run workflow** | Win + Linux 打安装包 → 重命名 → GitHub Release |

编译环境用 **GitHub hosted runners**，不用 Docker（Windows Tauri 容器成本高；Linux 上 apt + runner 已够用）。  
前端 Node：**22**（`setup-node` 的 `node-version`）。  
官方 Actions 使用 **Node 24 运行时** 版本：`actions/checkout@v5`、`actions/setup-node@v5`、`upload-artifact@v7`、`download-artifact@v8`、`softprops/action-gh-release@v3`（旧 major 仍声明 Node 20，会触发弃用告警）。

## 触发与过滤

### CI（`ci.yml`）

- `pull_request`：`opened` / `synchronize` / `reopened` / `ready_for_review`，目标分支 `main`（仅 GitHub PR；Gitea PR 不跑）
- `push`：`main`
- **`paths-ignore`**：`docs/**`、`**/*.md`、`LICENSE*`、`.mimocode/**`  
  - 纯文档变更：整次 workflow 跳过（不占分钟）  
  - 改 `*.yml` / 源码 / `Cargo.*` / `package.json` / `scripts/` 等：照常跑 L1–L3  
  - 若将 `CI OK` 设为 required check，path-filter 导致的 skip 视为通过

### Release（`release.yml`）

- `push` tags：`v*.*.*`
- `workflow_dispatch`：必填 `version`；可选 `notes`（人工摘要）

## 架构分层 ↔ Job

对齐仓库 `docs/ARCHITECTURE.md`：

```
L1  src/（Vue）          → job frontend
L2  crates/transport     → job transport
L3  src-tauri + workspace → job tauri-backend
L4  安装包 + Release     → workflow release.yml（tag 或手动）
```

PR/`main`：**L1–L3 并行，全部成功才绿灯**。  
Release：**prepare → build 矩阵 → publish**。

### L1 `frontend`（ci.yml）

- Node 22 · `npm ci`
- **`npm test`**（Vitest：`src/**/*.test.ts`）— 必跑
- `npm run build`（`vue-tsc` + `vite build`）

### L2 `transport`（ci.yml）

- `cargo test -p transport` — 必跑
- `cargo check -p transport`
- 系统库：`pkg-config`、`libudev-dev`

### L3 `tauri-backend`（ci.yml）

- `cargo test --workspace` — 必跑
- `cargo check --workspace`
- 安装 Tauri Linux 链接所需最小依赖（webkit 等）
- **不**跑完整 `tauri build` / 不跑 Vite；创建占位 `dist/index.html`（满足 `generate_context!` 对 `frontendDist` 的路径检查）

### L4 `release.yml`

- `prepare`：解析版本（tag 或手动输入，规范化为无 `v` 的 semver + `v` 前缀 tag）
- 矩阵：`windows-latest`（nsis + msi）、`ubuntu-22.04`（deb + appimage）
- 注入：`APP_VERSION` / `APP_GIT_HASH`（`github.sha`）/ `APP_BUILD_DATE`（UTC `YYYY-MM-DD`）
- `scripts/sync-version.mjs` → `package.json`、`tauri.conf.json`
- Vite 经 `scripts/resolve-build-info.mjs` 注入关于页 / 页脚
- 产物重命名后上传；附 `checksums-sha256.txt`
- 重命名脚本默认从 **仓库根** `target/release/bundle` 收集（Cargo workspace）；兼容 `src-tauri/target/release/bundle`

## Release Notes（变更说明）

| 来源 | 行为 |
|------|------|
| 默认 | 调用 GitHub `releases/generate-notes`，相对上一 tag 自动汇总 PR/提交 |
| 手动 `notes` | 非空时置顶人工摘要，再接 `---` 与自动生成正文 |
| CHANGELOG.md | 本期不强制维护（避免与自动 notes 双源） |

## 构建信息（与 About 对齐）

| 字段 | Release | 本地 dev/build |
|------|---------|----------------|
| version | tag / 手动 version（去 `v`） | `package.json` |
| gitHash | `github.sha` | `git rev-parse HEAD` 或 `dev` |
| buildDate | UTC 当日 | 本机 UTC 当日 |

关于页：`v{version}` + `{hash前7位} · {date}`；页脚仅 `Serial Tools v{version}`。

## 发布包文件名

```text
serial-tools-{VERSION}-{OS}-{ARCH}[-setup|-portable].{EXT}
```

| 产物 | 示例（tag `v0.1.0`） | 说明 |
|------|----------------------|------|
| **Windows 免安装** | `serial-tools-0.1.0-windows-x64-portable.exe` | 与本地 `target/release/serial-tools.exe` 同源；**未签名阶段首选** |
| Windows NSIS | `serial-tools-0.1.0-windows-x64-setup.exe` | 安装包；SmartScreen 可能拦截 |
| Windows MSI | `serial-tools-0.1.0-windows-x64.msi` | 同上 |
| Linux AppImage | `serial-tools-0.1.0-linux-amd64.AppImage` | 免安装 |
| Linux portable | `serial-tools-0.1.0-linux-amd64-portable` | raw 二进制 |
| Linux deb | `serial-tools-0.1.0-linux-amd64.deb` | 发行版包 |

`{VERSION}` 必须与 About 的 `APP_VERSION`、tag（去 `v`）一致。

安装包侧配置：`webviewInstallMode=embedBootstrapper`，`nsis.installMode=currentUser`（无需管理员）。完成 Authenticode 前以 portable 为 Windows 推荐下载项。

## 明确不做（本期）

- macOS / 代码签名 / Docker CI / Gitea Actions 镜像流水线
- PR 上打安装包、main nightly 包
- 应用内 Tauri updater

## 文件索引

| 文件 | 职责 |
|------|------|
| [ci.yml](./ci.yml) | L1–L3 门禁 |
| [release.yml](./release.yml) | L4 发布 |
| [DESIGN.md](./DESIGN.md) | 本文（设计意图） |
| `scripts/resolve-build-info.mjs` | Vite 构建信息 |
| `scripts/sync-version.mjs` | Release 写回版本号 |
| `src/buildInfo.ts` | 前端读取构建信息 |

## 发布操作

**Tag 推送：**

```bash
git tag v0.1.0
git push github v0.1.0
```

**手动：** GitHub → Actions → Release → Run workflow → 填 `version`（可选 `notes`）→ 选择分支（通常 `main`）。

在 GitHub → Releases 下载按上表命名的附件。
