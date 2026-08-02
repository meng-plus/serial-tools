# 厂家自定义二进制协议解析

> 状态：✅ **已实施**（历史设计记录；现状以 [ARCHITECTURE.md](../ARCHITECTURE.md) 为准）  
> 日期：2026-08-01  
> 决策：方案 A（自定义传感器）；不做完整 Modbus 产品（Modbus Poll / Slave 更合适）  
> 分帧：定界符优先 + 静默超时兜底（D）  
> 校验：实用小集合（A）

## 1. 目标

在现有 regex / JSON 文本规则之外，支持**厂家自定义二进制帧**：

1. 按通道缓冲 RX 字节并**分帧**
2. **校验**通过后按字段表解码
3. 数值进入 `valueBus`，供监控 / 图表；原文 HEX 进解析日志

明确**不做**：Modbus RTU/TCP 主站/从站、寄存器映射 UI、后端 Framer 接线（本期仍前端）。

## 2. 数据流

```
rxHub (RX bytes)
    ├─ regex / json 规则：仍按「单条收发记录」文本匹配
    └─ binary 规则：每规则独立 BinaryFramer
            push(bytes) / tick(idle)
                → 完整帧 → verify checksum → decode fields
                → ParsedRecord + valueBus
```

## 3. 分帧配置 `BinaryFrameConfig`

| 字段 | 说明 |
|------|------|
| `syncHeader` | 可选 HEX 头，如 `AA55` |
| `lengthMode` | `fixed` \| `field` \| `idle` |
| `fixedLength` | 定长总字节数 |
| `lengthOffset` / `lengthSize` / `lengthEndian` | 长度域 |
| `lengthBias` | 长度域值修正：`totalLen = lengthField + lengthBias`（若长度已是总长则 bias=0） |
| `idleMs` | 无新字节超时兜底（默认 40） |
| `maxFrame` | 缓冲上限（默认 1024） |
| `checksum` | 见 §4 |

策略：有头则搜头再按 lengthMode 切；`idle` 或搜头失败超时则把缓冲作一帧（受 maxFrame 限制）。

## 4. 校验算法（A 集）

统一实现于 `src/protocol/checksum.ts`，发送 `applyFrame` 与 RX 校验共用：

- `none`
- `sum8` / `sum16_le` / `sum16_be`
- `xor8`
- `crc8_07`（poly 0x07）/ `crc8_31`（poly 0x31）
- `crc16_modbus`（仅算法名，非 Modbus 产品）
- `crc16_ccitt_false` / `crc16_ibm`

存储：默认附在帧尾；1 或 2 字节；CRC16 可配 LE/BE。

## 5. 字段表

`offset` + `type`（u8 / u16le|be / i16* / u32* / i32* / f32*）+ `scale` / `bias` + `unit` / `valueId`  
`value = raw * scale + bias`（缺省 scale=1, bias=0）。

## 6. 规则类型

`ProtocolRule.type = 'binary'`，附带 `frame` + `binaryFields`；`pattern` 可存头便于列表展示。

## 7. UI

解析日志：类型「二进制」；示例 `AA55` 温湿度；校验下拉与定时发送帧配置同源目录。

## 8. 文档清理

requirements / README / About：去掉「完整 Modbus 解析」承诺；注明厂家二进制规则为当前路径。
