# Serial Tools 需求文档

## 项目概述

Serial Tools 是一个通信集成调试平台，支持串口 (UART/RS485)、TCP/IP、MQTT 等通信方式的调试和测试。

## 核心功能

### 1. 连接管理
- 支持多种连接类型：串口、TCP 客户端/服务端、MQTT
- 串口参数配置：波特率、数据位、停止位、校验位
- 自动扫描和枚举可用串口
- 连接状态实时显示

### 2. 数据收发终端
- XShell 风格终端界面
- 支持文本和 HEX 两种发送模式
- 数据包收发记录和统计
- 可配置发送后缀 (CR/LF/CRLF)

### 3. 协议解析
- Modbus RTU/TCP 协议解析
- JSON 数据字段提取
- 正则表达式文本匹配
- 字节模式匹配

### 4. 端口转发
- 支持串口↔TCP 转发
- 多条转发规则并行运行
- 转发统计 (RX/TX 字节数)

### 5. 接收处理管线
- 字节超时分帧
- 定界符分帧
- 长度前缀分帧
- NDJSON 分帧

### 6. 系统日志
- 操作日志记录
- 日志级别过滤
- 日志导出 (CSV/JSON)

### 7. 会话管理
- 会话配置保存/加载
- 会话列表管理

## 技术栈

- **前端**: Vue 3 + Ant Design Vue + Pinia + ECharts
- **后端**: Rust + Tauri v2
- **传输层**: tokio-serial / tokio::net / rumqttc (计划)

## 架构特点

- Rust workspace 多 crate 架构
- Transport trait 统一传输层抽象
- Channel + Framer + Pipeline 分层设计
- 前后端通过 Tauri IPC 通信
