# DOI Studio - Windows 构建指南

## 快速开始（3 步）

```cmd
:: 1. 克隆
git clone git@gitea.mengplus.top:Gltech/doi-studio.git
cd doi-studio

:: 2. 安装依赖
npm install

:: 3. 构建
npx tauri build
```

构建产物: `src-tauri/target/release/bundle/nsis/` 下的 `.exe`

---

## 完整环境搭建

### Step 1: 安装 Rust

下载安装: https://static.rust-lang.org/dist/rustup-x86_64-pc-windows-msvc.msi

安装完打开新终端验证:
```cmd
rustc --version
cargo --version
```

### Step 2: 安装 Node.js

下载 LTS: https://nodejs.org/

验证:
```cmd
node --version    :: 需要 >= 18
npm --version
```

国内加速（可选）:
```cmd
npm config set registry https://registry.npmmirror.com
```

### Step 3: 安装 Visual Studio 构建工具

Tauri 需要 MSVC 链接器。

**方式 A: Visual Studio Community（推荐）**
https://visualstudio.microsoft.com/
安装勾选: **"使用 C++ 的桌面开发"**

**方式 B: 仅 Build Tools**
```cmd
winget install Microsoft.VisualStudio.2022.BuildTools
```
安装勾选: **"使用 C++ 的桌面开发"**

### Step 4: WebView2（Win10 需要，Win11 自带）

Win10 下载: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

---

## 构建命令

### 开发模式（热重载）
```cmd
npx tauri dev
```

### 正式构建
```cmd
npx tauri build
```

### 仅构建后端（不打包）
```cmd
cargo build
```

---

## 构建产物

| 文件 | 说明 |
|------|------|
| `src-tauri/target/release/bundle/nsis/doi-studio_0.1.0_x64-setup.exe` | NSIS 安装包（推荐） |
| `src-tauri/target/release/bundle/msi/doi-studio_0.1.0_x64.msi` | MSI 安装包 |
| `src-tauri/target/release/doi-studio.exe` | 可执行文件 |

---

## 常见问题

### `icon.ico` 格式错误
`resource file is not in 3.00 format` — icon.ico 实际是 PNG 格式。用 Python 转换:
```cmd
python -c "from PIL import Image; img = Image.open('src-tauri/icons/128x128@2x.png'); img.save('src-tauri/icons/icon.ico', format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
```

### 前端显示"浏览器预览模式"（Tauri v2 环境检测失败）
Tauri v2 默认不注入 `window.__TAURI__` 全局对象。检测代码应使用 `__TAURI_INTERNALS__`:
```typescript
// 错误 (Tauri v1 写法)
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

// 正确 (Tauri v2)
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
```
如需保留 `__TAURI__`，可在 `tauri.conf.json` 中设置 `"app": { "withGlobalTauri": true }`。

### Vite `@` 路径别名无法解析
`tsconfig.json` 中配置了 `paths: { "@/*": ["./src/*"] }`，但 Vite 不读 tsconfig 路径。需要在 `vite.config.ts` 中添加:
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

### `failed to run custom build script for webview2-sys`
缺 Windows SDK。安装 Visual Studio 时勾选 Windows SDK。

### 启动白屏
WebView2 没装。检查 Step 4。

### `npm install` 卡住
换镜像: `npm config set registry https://registry.npmmirror.com`

### cargo build 很慢
首次编译需下载 crate，后续会缓存。可配置 cargo 镜像加速:
```cmd
mkdir %USERPROFILE%\.cargo
echo [source.crates-io] > %USERPROFILE%\.cargo\config.toml
echo replace-with = "ustc" >> %USERPROFILE%\.cargo\config.toml
echo. >> %USERPROFILE%\.cargo\config.toml
echo [source.ustc] >> %USERPROFILE%\.cargo\config.toml
echo registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/" >> %USERPROFILE%\.cargo\config.toml
```

---

## 项目结构

```
doi-studio/
├── src/                    # Vue 3 + TypeScript 前端
├── src-tauri/              # Tauri 后端 (Rust)
│   ├── src/commands/       # 前后端桥接命令
│   ├── src/state.rs        # 应用状态
│   ├── tauri.conf.json     # Tauri 配置
│   └── target/             # 编译产物
├── crates/                 # Rust 核心库
│   ├── doi-protocol/       # DOI 协议 (帧/CRC/命令)
│   ├── transport/          # 传输层 (TCP/串口/Mock)
│   ├── business/           # 业务逻辑 (扫描/调度/日志)
│   ├── config/             # YAML 配置管理
│   └── mock-slave/         # 模拟从机 (7种设备)
├── docker/                 # Docker 配置
├── tests/                  # 端到端测试
├── docs/                   # 文档
├── Cargo.toml              # Workspace 根
└── package.json            # 前端依赖
```
