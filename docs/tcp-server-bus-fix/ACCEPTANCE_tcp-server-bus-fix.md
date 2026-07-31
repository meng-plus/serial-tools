# ACCEPTANCE: TCP Server / 终端 / 数据总线修复

## 验收结果

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | TCP Server 客户端清单（嵌套展示 + parent 过滤） | ✅ |
| 2 | 可断开单个客户端 / 可关闭 Server（shutdown） | ✅ |
| 3 | 终端展示 RX（单读者模型，无双读竞争） | ✅ |
| 4 | 单客户端交互（终端选子通道 + 提示广播） | ✅ |
| 5 | 数据总线 RxToBus 订阅 rx_broadcast | ✅ |
| 6 | 终端编码 UI：显示 vs 文本发送 vs HEX Tab 分离 | ✅ |

## 测试

- `cargo test -p transport` — 43 passed
- `cargo test --manifest-path src-tauri/Cargo.toml --test integration_tests` — 31 passed
- `npm test` — 34 passed

## 孤立提交融合

- 行为特性已融合：每客户端独立通道、kick、list clients、关闭释放端口
- 未整仓回滚 `3245ddc` 的 async/多 crate 架构（与现有 DESIGN-DECISIONS 冲突）
- 设计文档已恢复：`docs/COMMUNICATION-ARCH-REFINEMENT.md`
