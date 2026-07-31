# 环境搭建指南

Serial Tools 基于 Rust + Tauri v2 + Vue 3 构建，需要安装 Rust 工具链、Node.js 和平台相关的构建工具。

---

## 1. Node.js

需要 **Node.js >= 18**。

| 平台 | 安装方式 |
|------|---------|
| Windows | 下载 LTS: https://nodejs.org/ 或 `winget install OpenJS.NodeJS.LTS` |
| macOS | `brew install node` 或下载 LTS |
| Linux | `sudo apt install nodejs npm` 或使用 [nvm](https://github.com/nvm-sh/nvm) |

验证：
```bash
node --version   # >= 18
npm --version
```

国内加速（可选）：
```bash
npm config set registry https://registry.npmmirror.com
```

---

## 2. Rust 工具链

需要 **Rust >= 1.70**（推荐最新 stable）。

### 安装 rustup

| 平台 | 命令 |
|------|------|
| Windows | 下载 https://static.rust-lang.org/dist/rustup-x86_64-pc-windows-msvc.msi |
| macOS / Linux | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

### 国内镜像加速

编辑 `~/.cargo/config.toml`（没有则创建）：

```toml
[source.crates-io]
replace-with = "ustc"

[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
```

rustup 镜像（安装时使用）：
```bash
export RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static
export RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
```

### 验证

```bash
rustc --version
cargo --version
```

---

## 3. 平台构建工具

Tauri 需要系统级的 WebView 和 C++ 编译工具链。

### Windows

**必须安装 Visual Studio 构建工具（MSVC）**：

方式 A — Visual Studio Community（推荐）：
- 下载: https://visualstudio.microsoft.com/
- 安装时勾选 **"使用 C++ 的桌面开发"**

方式 B — 仅 Build Tools：
```cmd
winget install Microsoft.VisualStudio.2022.BuildTools
```
安装时勾选 **"使用 C++ 的桌面开发"**

**WebView2**（Win10 需要，Win11 自带）：
- 下载: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### macOS

```bash
xcode-select --install
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Linux (Fedora)

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

### Linux (Arch)

```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  file \
  openssl \
  appmenu-gtk-module \
  libappindicator-gtk3 \
  librsvg
```

---

## 4. 安装项目依赖

```bash
cd serial-tools
npm install
```

---

## 5. 开发与构建

### 开发模式（热重载）

```bash
npm run dev:app
```

启动 Tauri 桌面窗口，前端热重载，后端改动需重启。

### 仅前端预览（浏览器模式）

```bash
npm run dev
```

注意：浏览器模式无法使用 Tauri IPC，串口/TCP 功能不可用。页面顶部会显示"浏览器预览模式"提示。

### 正式构建

```bash
npm run build:app
```

### 仅后端编译

```bash
cargo build           # debug
cargo build --release # release
```

### 运行测试

```bash
cargo test            # 全部测试
cargo test --test integration_tests  # 集成测试
```

---

## 6. 构建产物

| 平台 | 路径 |
|------|------|
| Windows | `src-tauri/target/release/bundle/nsis/*.exe` |
| Windows (MSI) | `src-tauri/target/release/bundle/msi/*.msi` |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` |
| Linux | `src-tauri/target/release/bundle/deb/*.deb` 或 `appimage/*.AppImage` |

---

## 7. CI 构建

项目提供 Docker 镜像用于 CI 环境：

```bash
docker pull gitea.mengplus.top/mengplus/doi-studio-ci:latest
```

镜像内包含 Rust 工具链、Node.js 和所有构建依赖。

---

## 8. 常见问题

### `icon.ico` 格式错误
`resource file is not in 3.00 format` — icon.ico 实际是 PNG 格式。用 Python 转换：
```bash
python -c "from PIL import Image; img = Image.open('src-tauri/icons/128x128@2x.png'); img.save('src-tauri/icons/icon.ico', format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
```

### 前端显示"浏览器预览模式"
Tauri v2 环境检测应使用 `__TAURI_INTERNALS__`（已修复）。如仍遇到，检查 `src/api/tauri.ts`。

### `npm install` 卡住
换镜像：`npm config set registry https://registry.npmmirror.com`

### `cargo build` 很慢
首次编译需下载所有 crate，后续有缓存。配置 cargo 镜像加速见上方第 2 节。

### `failed to run custom build script for webview2-sys`
Windows 缺 SDK。安装 Visual Studio 时勾选 Windows SDK。

### 启动白屏
WebView2 未安装（Win10）。下载安装: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### Vite `@` 路径别名无法解析
确保 `vite.config.ts` 中有：
```typescript
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
})
```
