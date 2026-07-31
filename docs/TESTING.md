# Serial Tools 测试策略

## 测试分层

| 层级 | 类型 | 框架 | 位置 | 数量 |
|------|------|------|------|------|
| L1 | 单元测试 | cargo test | `crates/transport/src/lib.rs` | 43 |
| L2 | 模块测试 | cargo test | `crates/transport/src/tcp.rs` | 16 |
| L3 | 功能测试 | cargo test | `src-tauri/tests/integration_tests.rs` | 28 |
| L4 | 前端测试 | vitest | `src/**/*.test.ts` | 27 |
| L5 | 数据总线测试 | cargo test | `src-tauri/tests/integration_tests.rs` | 3 |
| **合计** | | | | **117** |

## 运行命令

```bash
# 所有 Rust 测试
cargo test --workspace

# 仅 transport crate 测试
cargo test --manifest-path crates/transport/Cargo.toml

# 仅集成测试
cargo test --manifest-path src-tauri/Cargo.toml --test integration_tests

# 前端测试
npm test

# 前端测试（watch 模式）
npm run test:watch
```

## L1: 单元测试 (Transport crate)

**覆盖范围**: MockTransport 生命周期、读写、边界条件

| 测试 | 验证点 |
|------|--------|
| test_mock_new | 初始状态：未激活、descriptor 正确 |
| test_mock_open_close | 状态切换：inactive → active → inactive |
| test_mock_write_before_open_fails | 未打开时写入返回错误 |
| test_mock_read_before_open_fails | 未打开时读取返回错误 |
| test_mock_write_records_data | TX 日志记录、字节计数 |
| test_mock_read_empty_returns_zero | 空队列读取返回 0 |
| test_mock_read_returns_enqueued_data | FIFO 顺序读取 |
| test_mock_read_truncates | 缓冲区截断 |
| test_mock_clear_tx_log | 清空 TX 日志 |
| test_mock_write_after_close_fails | 关闭后写入失败 |
| test_mock_read_after_close_fails | 关闭后读取失败 |
| test_tcp_new | TCP Client 初始状态 |
| test_tcp_connect_refused | 连接被拒绝 |
| test_tcp_write_before_open | 未连接写入失败 |
| test_tcp_read_before_open | 未连接读取失败 |
| test_tcp_close | 关闭操作 |
| test_mqtt_not_implemented | MQTT 未实现返回错误 |
| test_config_serial_roundtrip | 序列化/反序列化 |
| test_config_tcp_roundtrip | 序列化/反序列化 |
| test_framer_* (7) | 分帧器：定界符、超时、空输入 |

## L2: 模块测试 (TcpServerTransport)

**覆盖范围**: TCP Server 多客户端管理、新客户端队列

| 测试 | 验证点 |
|------|--------|
| test_server_new | 初始状态 |
| test_server_open_and_close | 监听生命周期、bound_port |
| test_server_accept_client | 接受客户端、get_clients、client_info、take_new_clients |
| test_server_multiple_clients | 3 个客户端并发连接 |
| test_server_kick_client | 踢出客户端、不存在时返回 false |
| test_server_broadcast_write | 广播发送到所有客户端 |
| test_server_write_no_clients | 无客户端时写入失败 |
| test_server_read_from_pending | 从 pending 缓冲读取客户端数据 |
| test_server_client_disconnect | 客户端断开后清理 |
| test_client_from_stream | 从已接受流创建传输 |
| test_client_from_stream_read_write | from_stream 读写验证 |

## L3: 功能测试 (集成)

**覆盖范围**: AppState 管理、广播机制、转发场景

### AppState 测试
| 测试 | 验证点 |
|------|--------|
| test_appstate_default | 默认状态：空 channels/packets/logs |
| test_appstate_push_packet | 数据包写入 |
| test_appstate_packet_overflow_trim | 超过 10000 条自动裁剪 |
| test_appstate_log | 日志写入 |
| test_appstate_channel_insert_and_remove | 通道增删 |
| test_appstate_send_to_channel | 向指定通道发送 |
| test_appstate_send_to_nonexistent_channel | 不存在通道发送失败 |
| test_appstate_rx_broadcast | RX 广播发送/接收 |

### 事件桥接测试
| 测试 | 验证点 |
|------|--------|
| test_log_broadcast | 日志广播订阅 |
| test_rx_broadcast_multi_subscriber | 多订阅者同时接收 |
| test_log_writes_to_both_logs_and_broadcast | 同时写入 logs 和广播 |

### TCP 功能测试
| 测试 | 验证点 |
|------|--------|
| test_tcp_loopback_send_receive | TCP 回环收发 |
| test_tcp_loopback_multi_send | 多次收发 |
| test_tcp_peer_close | 对端关闭检测 |
| test_tcp_server_multi_client_concurrent | 多客户端并发读写 |
| test_tcp_server_take_new_clients_preserves_existing | 提取新客户端不影响已有 |

### 转发场景测试
| 测试 | 验证点 |
|------|--------|
| test_forward_mock_single_direction | Mock A → B 单向转发 |
| test_forward_bidirectional_mock | A ↔ B 双向转发 |
| test_forward_tcp_to_mock_serial | TCP → 串口转发 |
| test_forward_tcp_to_tcp | TCP ↔ TCP 转发 |
| test_forward_serial_to_tcp_mock | 串口 ↔ TCP 转发 |

## L4: 前端测试 (vitest)

**覆盖范围**: Store 逻辑、API 层

### terminalStore
| 测试 | 验证点 |
|------|--------|
| 初始化状态 | 空 lines、默认编码 |
| sendText 添加行 | TX 方向数据 |
| sendHex 添加行 | HEX 数据 |
| 按通道过滤 | activeChannelId 过滤 |
| TCP Server 子通道过滤 | server + client 数据合并 |
| RX/TX 计数 | 方向统计 |
| 编码显示 | UTF-8/HEX 切换 |
| 清空 | 清除所有数据 |

### connectionStore
| 测试 | 验证点 |
|------|--------|
| 初始化状态 | 空 channels/ports |
| refreshStatus | 从后端同步状态 |
| loadPorts | 加载串口列表 |
| connect | 连接命令调用 |
| disconnect | 断开并移除 |
| disconnectAll | 全部断开 |
| connectedChannels | 已连接通道计算 |

### logStore
| 测试 | 验证点 |
|------|--------|
| 初始化状态 | 空 logs |
| fetchLogs | 获取日志 |
| clearLogs | 清空日志 |
| 级别过滤 | filterLevel 参数 |

### sessionStore
| 测试 | 验证点 |
|------|--------|
| 初始化状态 | 空 sessions |
| loadList | 加载会话列表 |
| load | 加载会话内容 |
| save | 保存会话 |
| remove | 删除会话 |
| 删除非当前会话 | currentSession 不变 |

### API 层
| 测试 | 验证点 |
|------|--------|
| isTauri 无 window | 返回 false |
| invoke 非 Tauri 环境 | 抛出错误 |

## L5: 数据总线测试

| 测试 | 验证点 |
|------|--------|
| test_bus_create_and_list | 创建总线、验证列表 |
| test_bus_mock_forward | Mock A.RX → bus → B.TX 转发验证 |
| test_bus_direction_enum | BusDirection 枚举正确性 |
