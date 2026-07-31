# FINAL: TCP Server / 终端 / 数据总线修复

## 总结

孤立提交 `3245ddc` 的价值在**通信行为设计**（每客户端一通道、kick/list、Duplex 意图），不宜整仓回滚其 async/多 crate 重写。已在当前 sync + DataBus 架构下融合关键行为并修复实测缺陷。

## 主要改动

1. **TCP Server 单读者**：取消内部 pending 读线程；客户端流独占给 `tcp_client-*` 通道
2. **关闭链路**：`Transport::shutdown` + `remove_channel` 真正关闭；Server 断开释放端口
3. **客户端管理**：`parent_channel_id`、`list_server_clients`、`disconnect_client`；连接页嵌套清单
4. **终端**：按父 Server 过滤；单客户端交互提示；编码 UI 分离（显示 / UTF-8·GBK 发送 / HEX Tab）
5. **数据总线**：RxToBus 订阅 `rx_broadcast`，消除与主读线程抢读；字节计数与 unsubscribe 取消标志

## 产物

- `target/release/serial-tools.exe`
- MSI / NSIS 安装包

## 文档

- `docs/COMMUNICATION-ARCH-REFINEMENT.md`（从孤立提交恢复）
- `docs/tcp-server-bus-fix/CONSENSUS_*.md` / `ACCEPTANCE_*.md`
