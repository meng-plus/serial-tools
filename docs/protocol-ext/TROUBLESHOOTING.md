# 常见问题排查

## 安装 zip 失败

| 报错 | 原因 | 解决 |
|------|------|------|
| `manifest.yaml 解析失败: …` | YAML 语法错误（常见：流式映射内嵌块级序列、尾逗号） | 修正 manifest；参考 [MANIFEST.md](./MANIFEST.md) 的多行选项写法 |
| `扩展包缺少入口文件: main.js` | entry 指定的文件不存在 | 确认 `entry` 与文件名一致 |
| `扩展包缺少 manifest.yaml` / 结构非法 | zip 根层无 manifest 且无唯一顶层目录 | 打包时根层直接含 `manifest.yaml`，或整个包放一个顶层目录 |
| `扩展包包含非法条目` | zip 内存在路径穿越（`../` 等）或非法字符 | 重新打包（勿含绝对路径 / 符号链接） |
| `manifest 中 id 非法` | id 不符合 `^[a-z0-9_-]+$` | 改 id（小写字母/数字/下划线/连字符） |
| `协议 xxx 已存在更高或相同版本` | 装的是同版本或降级 | 升级版本号，或勾选「强制安装」 |
| `zip 解析失败` | 不是合法 zip | 确认压缩格式（选 zip，不要 7z/rar） |

## 启动实例失败 / 日志无输出

- **看「协议扩展」页的运行日志**（右上角）：`init` 抛错会记 `error` 级别。
- main.js 语法错误 → 动态 import 失败，管理页会显示加载错误。用 `node --check` 或编辑器先自查。
- 协议实例**只绑定一个通道**：确认目标通道已连接且实例选的通道正确。
- `import` 了外部模块 → 运行时无打包器，加载会失败。协议实现只允许用注入的 `ctx`。

## 从站收不到请求 / 主站收不到应答

- 主站与从站必须在**同一通道**上各自创建实例并都启动。
- 确认 `match()` 校验正确（地址、长度、CRC）。`match` 返回 false 就静默丢弃。
- 主站 `onRx` 里 pending 关联要用「请求唯一标识」（地址 / 事务 ID），避免把无关帧当作应答。
- TCP 注意 MBAP 的协议 ID / 长度域；串口注意校验字节序（RTU CRC 小端追加）。

## 参数改了没生效

- `setConfig` 已实现但参数仍旧：确认 setConfig 内重新读取参数（`_applyConfig()`）并重启定时器 / 清空 pending。
- 修改参数 → 实例会自动调用 `setConfig(patch)`；若需要强推一轮，在 setConfig 里显式重发。

## 监控/图表看不到数值

- 变量必须经 `ctx.emitVar({ valueId, value })` 推送，且 `valueId` 要在变量表（manifest `ui.variables` 或 `getVariables()`）中。
- 图表控件绑定的是 `valueIds`；确认拼写一致。
- 数据导出：仅导出已产生的样本；启动后无数据则导出为空表。

## 测试 / 构建相关

- 后端单测：`cargo test -p serial-tools protocol_fs`（zip 安装 / 路径穿越 / 版本冲突）。
- 前端：`npm test`（含 `src/protocol-ext/*.test.ts`）、`npm run build`。
- 修改 `public/protocols/builtin/` 后需重新 `npm run build`（Vite 拷贝到 dist），dev 模式直接可读。
