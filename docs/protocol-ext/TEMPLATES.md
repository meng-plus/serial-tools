# 内置模板

模板目录 `public/protocols/templates/` 不参与运行，仅作为新协议起点。每个模板含 `manifest.yaml` + `main.js` + `main.d.ts`（类型提示）。

## custom-passive（被动解析）

- 角色：`passive`。收到数据按行分帧（LF/CRLF），按「字段表」逐字段解码并 `emitVar`。
- 参数：`fields`（字段表：name/offset/type/scale/bias/unit）、`eol`（行结束符）。
- 适用：数据帧由定界符分隔、内容可映射为数值列的协议。
- 入口逻辑：`onRx` → 缓冲 → 找行尾 → `decodeBinary` → 推送。

## custom-master（主站轮询）

- 角色：`master`。周期发送查询报文，pending 关联应答，超时重试与离线标记。
- 参数：`command`（查询 hex）、`cycle_ms`、`timeout_ms`、`retry`。
- 动作：`poll_once`（立即查询一轮）。
- 入口逻辑：`init` 启动定时器 → `pollOnce`（`sendHex`）→ `onRx` 按标识匹配应答 → `onTick` 超时重试。
- 适用：请求-应答型主站协议。

## custom-slave（从站应答）

- 角色：`slave`。`match` 校验设备标识，`handle` 解析请求并构造应答 `sendHex`。
- 参数：`device_id`（匹配用）、`registers`（数据表）。
- 入口逻辑：`match`（首字节=设备标识）→ `handle`（按功能码分发）→ `sendHex` 回发。
- 适用：模拟设备 / 从站侧协议。

## 复制为你的协议

```powershell
# 例：以 custom-passive 为起点
Copy-Item -Recurse public\protocols\templates\custom-passive public\protocols\my-protocol
# 改 manifest.yaml 的 id/name/version，按需改 main.js
# 打包：Compress-Archive -Path "public\protocols\my-protocol\*" -DestinationPath my-protocol.zip
```

## 从站自测提示

内置 `modbus-rtu-slave` / `modbus-tcp-slave` 可作为任何主站协议的「对端」做本地闭环：
同一通道上先启从站实例再启主站实例（或反之），主站轮询 → 从站应答 → 主站推送变量 → 监控/图表可见。
