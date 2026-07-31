# CONSENSUS: TCP Server / 终端 / 数据总线修复

## 孤立提交评估 (`3245ddc`)

| 设计意图 | 当前 main | 处理 |
|---------|-----------|------|
| 每客户端独立 Channel | 有 `tcp_client-{addr}`，双读竞争 | **修复**单读者模型 |
| kick / send_to_client | transport 有，无 Tauri/UI | **融合**命令+UI |
| DuplexMode / ChannelManager crate | 文档有，未拆 crate | 保留现有 sync 架构，不整仓回滚 |
| DataBus | 有，但与 spawn_reader 抢读 | **改为订阅 rx_broadcast** |

**决策**: 不 cherry-pick 整仓 async/多 crate 重写；在现有架构融合行为特性并修缺陷。

## 验收标准

1. TCP Server 连接页展示在线客户端清单；可踢单个客户端；可关闭 Server（释放端口）
2. 终端可显示客户端 RX；可按单客户端通道收发
3. 数据总线 RxToBus 不抢读 Transport，点对点/广播可用
4. 终端发送区仅保留：工具栏显示编码 + 文本/HEX 发送 Tab（无双层编码选择）
5. 相关单测/集成测通过

## 实现约束

- 保持 sync Transport + std::thread
- TCP Server 自身不 spawn_reader；客户端独占读
- `Transport::shutdown(&self)` 支持 Arc 上关闭