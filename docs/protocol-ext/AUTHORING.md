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
- 查询类结果可解析为结构化对象后 `ctx.applyQuery(actionId, data)`，由 `ui.queries` 声明式写
  `emitInfo` / `setParam`（见 [MANIFEST.md](./MANIFEST.md)）。
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
├── README.md       # 建议：包内说明（安装 / 使用 / 参数），应用内「说明」按钮可查看
├── (可选) lib/*.js / *.js   # 包内相对 import，须一并打进 zip
└── (可选 assets/…)
```

包内可用 `import { ... } from './foo.js'`（仅相对路径，禁止 npm）。用户包装载时
会收集模块图并链接；内置包走真实 URL。勿再依赖构建期内联注入。

> Windows 上可用 `Compress-Archive -Path "my-protocol\*" -DestinationPath my-protocol.zip`。

## 5. 安装 / 使用

1. 「协议扩展」页 →「安装扩展包」选择 zip。后端校验：id 合法、manifest 可解析、入口文件存在、防路径穿越；同版本 / 降级会提示需强制安装。
2. **开发**：桌面应用内「从文件夹加载 (Dev)」填协议目录绝对路径 → 写入 `.dev-link`（不复制文件）。改 `main.js` / 依赖 `.js` / `manifest.yaml` 等后，运行中实例会自动 `dispose → 重载 → init`。生产仍用 zip。
3. 列表出现该协议 →「创建实例」选协议 + 通道 → 填参数 →「启动」。
4. 数值经 `ctx.emitVar` 推送后，可在监控 / 图表绑定；「导出数据」可导出 CSV/JSON。
5. 若包内含 `README.md`，协议页该协议的标签 / 向导项上有「说明」按钮可直接查看。

## 三种角色的典型写法

| 角色 | 触发方式 | 典型逻辑 |
|------|---------|---------|
| passive | `onRx` | 收数据 → 分帧 → `decodeBinary` → `emitVar`（模板：custom-passive） |
| master | `onTick` + `sendHex` + `onRx` | 周期发送查询 → pending 关联应答 → 超时重试 → 离线标记（模板：custom-master） |
| slave | `match` + `handle` | 校验地址/长度/CRC → 构造应答 `sendHex`（模板：custom-slave） |

## 测试你的协议

> 每个新增协议包都应有配套测试（vitest，纯 Node，不依赖硬件 / DOM）。
> 测试文件放 `src/protocol-ext/<协议id>.test.ts`，用脚手架 `./testing` 驱动，**无需手写 mock ctx**。
> 本地手动验证：`npx vitest run src/protocol-ext/<协议id>.test.ts`；全量 `npm test`。

脚手架 API（`src/protocol-ext/testing.ts`）：

| API | 作用 |
|-----|------|
| `loadProtocol<T>(pkgPath)` | 动态加载协议包 main.js，返回默认导出（类型化） |
| `importProtocolModule<T>(pkgPath)` | 加载整个模块（协议导出的辅助函数也可访问） |
| `makeTestContext({ params, channelId, instanceId })` | 返回 `{ ctx, params, sentHex, sentBytes, emitted, logs, saved, timerIds }`；`ctx` 可直接注入 `init` |
| `frameBytes(hex)` | hex 字符串 → 字节数组（断言帧内容用） |
| `withCrc(body)` | 为 body 追加 CRC16-Modbus 小端字节（构造合法帧用） |
| `createLoop({ master, slave })` | 虚拟总线闭环：master.sendHex→slave.handle、slave.sendHex→master.onRx，验证主从一问一答 |

最简冒烟（从模板复制后即可跑通）：

```ts
import { describe, it, expect } from 'vitest'
import { loadProtocol, makeTestContext } from './testing'

const URL = '../../public/protocols/<你的包路径>/main.js'

describe('my-protocol', () => {
  it('init 后可解析数据并 emitVar', async () => {
    const main = await loadProtocol<any>(URL)
    const h = makeTestContext({ params: { /* 你的参数 */ } })
    main.init(h.ctx)
    main.onRx({ bytes: [/* 造一帧 */] })
    expect(h.emitted).toContainEqual({ valueId: 'xxx', value: 1 })
  })
})
```

> 参考实现：内置 Modbus 主/从（`modbus-rtu-master.test.ts` / `modbus-rtu-slave.test.ts`）、
> 主从闭环（`modbus-loop.test.ts`）、文件传输（`ymodem.test.ts`）、模板冒烟（`templates.test.ts`）。

## 页面职责划分

- **「协议扩展」页**：协议包管理（安装 / 卸载 / 查看 README 说明）+ 协议实例的**参数配置**（创建向导、参数表单、导入导出）。
- **通道工作区「协议实例」面板**：只展示**运行数据与操作**（寄存器网格实时值、动作按钮、启停 / 切换通道）；参数配置统一跳转到「协议扩展」页完成。
- 参数过多时用 `group` 分组（见 [MANIFEST.md](./MANIFEST.md) 的 `group` 字段）。

## 发布 / 分享

- 包打成 zip 即可分享；他人安装后自用。
- 想内置进应用：把包目录放 `public/protocols/builtin/<id>/`，并把 id 加入 `src/protocol-ext/loader.ts` 的 `BUILTIN_PROTOCOL_IDS`，随应用打包发布。
