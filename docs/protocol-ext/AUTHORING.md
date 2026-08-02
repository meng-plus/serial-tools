# 制作一个协议包

目标：写一个「被动解析」协议，从 `public/protocols/templates/custom-passive/` 复制，改 id/name/逻辑，打包 zip 安装进应用。

## 1. 复制模板

以 custom-passive 为起点（被动 / 主站 / 从站三个模板任选，见 [TEMPLATES.md](./TEMPLATES.md)）：

```
mkdir my-protocol
复制 custom-passive/ 的三个文件 → my-protocol/
```

## 2. 改 manifest.yaml

- 改 `id`（`^[a-z0-9_-]+$`，与目录名一致）、`name`（中文）、`version`、`description`。
- 按需增删 `ui.params`（参数表单）、`ui.variables`、`ui.actions`。字段见 [MANIFEST.md](./MANIFEST.md)。

## 3. 写 main.js

- `init(ctx)` 必选：`this._applyConfig()` 读参数、启动定时器 / 轮询。
- `onRx(frame)`：收到数据分帧、解码、`ctx.emitVar({ valueId, value, unit })` 推送。
- 其余钩子按需。API 见 [ABI.md](./ABI.md)。

建议在编辑器里 `import type { ProtocolModule } from './main.d'` 获取补全：

```js
/** @type {import('./main.d').ProtocolModule} */
export default {
  init(ctx) { /* ... */ },
  onRx(frame) { /* ... */ },
}
```

## 4. 打包 zip

zip **根层直接包含 `manifest.yaml`**（也可含唯一顶层目录，如 `my-protocol/`，安装时自动剥掉）：

```
my-protocol.zip
├── manifest.yaml
├── main.js
└── (可选 assets/…)
```

> Windows 上可用 `Compress-Archive -Path "my-protocol\*" -DestinationPath my-protocol.zip`。

## 5. 安装 / 使用

1. 「协议扩展」页 →「安装扩展包」选择 zip。后端校验：id 合法、manifest 可解析、入口文件存在、防路径穿越；同版本 / 降级会提示需强制安装。
2. 列表出现该协议 →「创建实例」选协议 + 通道 → 填参数 →「启动」。
3. 数值经 `ctx.emitVar` 推送后，可在监控 / 图表 / 仪表盘绑定；「导出数据」可导出 CSV/JSON。

## 三种角色的典型写法

| 角色 | 触发方式 | 典型逻辑 |
|------|---------|---------|
| passive | `onRx` | 收数据 → 分帧 → `decodeBinary` → `emitVar`（模板：custom-passive） |
| master | `onTick` + `sendHex` + `onRx` | 周期发送查询 → pending 关联应答 → 超时重试 → 离线标记（模板：custom-master） |
| slave | `match` + `handle` | 校验地址/长度/CRC → 构造应答 `sendHex`（模板：custom-slave） |

## 发布 / 分享

- 包打成 zip 即可分享；他人安装后自用。
- 想内置进应用：把包目录放 `public/protocols/builtin/<id>/`，并把 id 加入 `src/protocol-ext/loader.ts` 的 `BUILTIN_PROTOCOL_IDS`，随应用打包发布。
