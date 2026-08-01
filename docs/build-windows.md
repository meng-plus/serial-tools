# Windows 构建指南

> 完整跨平台指南见 [ENVIRONMENT.md](ENVIRONMENT.md)

## 快速开始（3 步）

```cmd
:: 1. 克隆
git clone https://github.com/meng-plus/serial-tools.git
cd serial-tools

:: 2. 安装依赖
npm install

:: 3. 开发模式
npm run dev:app
```

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18 | https://nodejs.org/ |
| Rust | >= 1.70 | https://rustup.rs |
| Visual Studio | 2022+ | 勾选"使用 C++ 的桌面开发" |
| WebView2 | Win10 需要 | Win11 自带，Win10 下载: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ |

## 构建命令

```cmd
npm run dev:app        # 开发模式（热重载）
npm run build:app      # 正式构建
cargo test             # 运行测试
```

## 构建产物

| 文件 | 说明 |
|------|------|
| `src-tauri/target/release/bundle/nsis/Serial Tools_0.1.0_x64-setup.exe` | NSIS 安装包 |
| `src-tauri/target/release/bundle/msi/Serial Tools_0.1.0_x64.msi` | MSI 安装包 |

## 国内加速

```cmd
:: npm 镜像
npm config set registry https://registry.npmmirror.com

:: cargo 镜像（创建 %USERPROFILE%\.cargo\config.toml）
echo [source.crates-io] > %USERPROFILE%\.cargo\config.toml
echo replace-with = "ustc" >> %USERPROFILE%\.cargo\config.toml
echo. >> %USERPROFILE%\.cargo\config.toml
echo [source.ustc] >> %USERPROFILE%\.cargo\config.toml
echo registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/" >> %USERPROFILE%\.cargo\config.toml
```

## 常见问题

见 [ENVIRONMENT.md 第 8 节](ENVIRONMENT.md#8-常见问题)。
