# TODO: TCP Server / 终端 / 数据总线

## 可选后续

1. **DuplexMode 枚举正式入库**：孤立设计中的 Full/Half/Simplex 仍仅文档 + Serial 半双工标志，未成统一 API
2. **ChannelManager crate 拆分**：功能稳定后再考虑从 AppState 抽出（当前 DESIGN-DECISIONS 倾向暂不拆）
3. **GBK 真实编码发送**：浏览器无原生 GBK TextEncoder，目前文本仍按 UTF-8 路径发送；若需真 GBK，需引入编码库
4. **config.rs unused `state` 警告**：无功能影响，可顺手加 `_state` 前缀

## 建议手工验证

1. 启动 TCP Server → 用外部客户端连接 → 连接页应看到嵌套客户端 → 点「终端」可收发
2. 断开客户端 / 断开 Server → 端口可重新绑定
3. 创建总线：A(RxToBus)+B(TxFromBus) → A 收到数据应转发到 B，且终端仍能显示 A 的 RX
