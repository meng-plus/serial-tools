# TODO: TCP Server / 终端 / 数据总线

专项已验收，后续统一见 [ROADMAP.md](../ROADMAP.md)。

## 本专项已完成

- TCP Server 单读者 / kick / list / 事件清单
- 终端事件驱动 + seq 去重；GBK 发送
- 断开原因与优雅 FIN
- GB2312 并入 GBK；自定义右键

## 仍可选（非本专项阻塞）

1. DuplexMode 软件收发互斥（RS485）
2. ChannelManager crate 拆分（延后）
