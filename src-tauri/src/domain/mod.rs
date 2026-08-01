//! 领域服务模块 — 按职责收敛 AppState 的字段与操作
//!
//! - [`packet_store`]：收发包缓冲、全局 RX 广播、单调序号
//! - [`bus_registry`]：数据总线生命周期（创建 / 订阅 / 停止 / 删除）
//! - [`channel_manager`]：通道注册表与生命周期
//! - [`log_source`]：日志来源枚举（可观测性）

pub mod bus_registry;
pub mod channel_manager;
pub mod log_source;
pub mod packet_store;
