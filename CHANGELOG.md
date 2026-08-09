# 更新日志

## [0.2.0] - 2026-08-10

### 亮点
- 协议扩展（protocol-ext）可独立安装/开发：实例面板、包内说明、多文件模块与 Dev 热重载
- 串口体验增强：更高波特率预设、非常规波特率手输、HEX 输入与定时校验更稳妥
- 关于页支持检查更新，并正确渲染升级说明 Markdown

### 新增
- 协议扩展：实例面板（分组 / 数据卡片 / 波形 / 预设）、包内 README「说明」
- 协议运行时：多文件模块图加载；Dev 可从源目录加载并按 mtime 热重载
- 协议 ABI：`emitInfo` / `setParam`、`info_panel`、`ctx.request`、`emitProgress`、`ui.queries` 等
- `hexParser` 辅助解析；串口波特率预设扩至 2M，支持非常规值手输
- YMODEM 等示例扩展包支持（需手动安装）；协议扩展测试脚手架
- TCP Server 组订阅：动态覆盖全部子客户端并修复回传
- 协议实例面板场景（含 `register_grid` 通用控件、主从闭环与双击写值）
- 定时发送右侧抽屉与变量/校验体验整理；收包耗时、通道别名与收发日志按视图隔离
- 关于页 GitHub「检查更新」与 Issues 引导

### 改进
- About「检查更新」升级说明改为 Markdown 渲染
- 协议页布局调整；Modbus TCP 改为手动安装示例包（不再内置）
- 移除独立协议仪表盘视图，统一到协议实例面板
- Ctrl+滚轮缩放捕获阶段处理，避免与内容滚动冲突
- 通道生命周期、命令错误与文档/CI 门禁持续对齐

### 修复
- `normalizeHexInput` 正确处理 `0x` 前缀
- `removeInstance` 清除模块与定时器缓存，避免泄漏与错绑
- 定时发送内联校验变量计算时剔除自身后再算 CRC，并统一默认端序

### 下载说明
- Windows 未签名构建推荐使用 `*-windows-x64-portable.exe`
- Release 附 `checksums-sha256.txt` 便于校验
- Linux 提供 deb / AppImage

### 已知限制
- UDP、MQTT、日志导出（BIN/CSV）、后端协议解析**尚未交付**，请勿按已具备能力使用
- 内置 Modbus RTU 主/从仅为协议扩展**示例参考**，并非专用 Modbus 工具（如 Modbus Poll/Slave）的替代品

### 历史说明
- 曾发布的 `0.1.0` / `0.1.1` / `0.1.2` 标签与 GitHub Release 已撤回，请以本版本为准

## [0.1.x] - 已撤回

早期预览版本，标签与产物已移除。能力以 `[0.2.0]` 及此后说明为准。
