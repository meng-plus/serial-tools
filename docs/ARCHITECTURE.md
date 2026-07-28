# Serial Tools 架构文档

## 整体架构

```
┌─────────────────────────────────────────────────┐
│                  前端 (Vue 3)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ 连接页面 │ │ 终端页面 │ │ 协议解析/转发... │ │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘ │
│       └────────────┼────────────────┘           │
│                    ▼                            │
│              Pinia Stores                       │
└────────────────────┬────────────────────────────┘
                     │ Tauri IPC
┌────────────────────┴────────────────────────────┐
│                后端 (Rust + Tauri)               │
│  ┌─────────────────────────────────────────┐    │
│  │           Commands Layer                │    │
│  │  connection / data / protocol / ...     │    │
│  └──────────────────┬──────────────────────┘    │
│                     ▼                           │
│  ┌─────────────────────────────────────────┐    │
│  │           State (AppState)              │    │
│  └──────────────────┬──────────────────────┘    │
│                     ▼                           │
│  ┌─────────────────────────────────────────┐    │
│  │          Channel Layer                  │    │
│  │   Channel → Transport → read/write      │    │
│  └──────────────────┬──────────────────────┘    │
│                     ▼                           │
│  ┌─────────────────────────────────────────┐    │
│  │        Transport Layer (trait)          │    │
│  │  Serial │ TCP Client │ MQTT             │    │
│  └──────────────────┬──────────────────────┘    │
│                     ▼                           │
│  ┌─────────────────────────────────────────┐    │
│  │         Framer + Pipeline              │    │
│  │  ByteTimeout │ Delimiter │ LengthPrefix │    │
│  │  → Decoder → Extractor → Router        │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Crate 依赖关系

```
pipeline ──┬── framing
            └── protocol

channel ───┬── transport
            └── framing

transport: 独立，底层 IO
framing: 独立，分帧逻辑
protocol: 独立，协议解析

src-tauri ──┬── transport, serial-crate, tcp-crate, mqtt-crate
             ├── framing, channel, protocol, pipeline
             └── tokio, serialport, tauri
```

## Transport Trait

所有传输层实现统一的 `Transport` trait：

```rust
pub trait Transport: Send + Sync {
    fn open(&mut self) -> Result<(), TransportError>;
    fn close(&mut self) -> Result<(), TransportError>;
    fn write(&self, bytes: &[u8]) -> Result<usize, TransportError>;
    fn read(&self, buf: &mut [u8]) -> Result<usize, TransportError>;
    fn is_active(&self) -> bool;
    fn descriptor(&self) -> &TransportDescriptor;
}
```

## 数据流

1. **RX 路径**: Transport.read() → Framer.push() → Pipeline(Decoder→Extractor→Router) → Terminal/Protocol/Waveform
2. **TX 路径**: Terminal input → Channel.send() → Transport.write()

## 会话配置格式 (YAML)

```yaml
connection:
  type: serial
  port: COM3
  baud_rate: 115200
  data_bits: 8
  stop_bits: 1
  parity: none

terminal:
  encoding: utf-8
  line_ending: crlf
  timestamp: true

protocols:
  - name: modbus-slave1
    type: modbus_rtu
    slave_id: 1
```
