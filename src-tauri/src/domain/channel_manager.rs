//! 通道注册表领域服务 — transport / cancel / 读线程 / Server / 父子关系五表收口
//!
//! 原 `AppState.channels + tcp_servers + client_parents` 三份平行状态存在漂移风险；
//! 收敛为单一入口后，`remove` 原子取走各项，杜绝「cancel 清了但 channel 还在」。

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::sync::RwLock;
use transport::tcp::TcpServerTransport;
use transport::Transport;

/// 通道注册表：注册 / 查询 / 原子移除 + TCP Server 与父子关系
pub struct ChannelManager {
    channels: Arc<RwLock<HashMap<String, Arc<dyn Transport>>>>,
    cancels: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    readers: Arc<RwLock<HashMap<String, std::thread::JoinHandle<()>>>>,
    tcp_servers: Arc<RwLock<HashMap<String, Arc<TcpServerTransport>>>>,
    client_parents: Arc<RwLock<HashMap<String, String>>>,
}

impl ChannelManager {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            cancels: Arc::new(RwLock::new(HashMap::new())),
            readers: Arc::new(RwLock::new(HashMap::new())),
            tcp_servers: Arc::new(RwLock::new(HashMap::new())),
            client_parents: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 注册传输（读线程启动前调用）
    pub async fn put_transport(&self, channel_id: String, transport: Arc<dyn Transport>) {
        self.channels.write().await.insert(channel_id, transport);
    }

    /// 注册取消标志（读线程启动前调用，保证并发移除可及时 cancel）
    pub async fn put_cancel(&self, channel_id: String, cancel: Arc<AtomicBool>) {
        self.cancels.write().await.insert(channel_id, cancel);
    }

    /// 注册读线程句柄（读线程创建后调用）
    pub async fn put_reader(&self, channel_id: String, reader: std::thread::JoinHandle<()>) {
        self.readers.write().await.insert(channel_id, reader);
    }

    pub async fn get_transport(&self, channel_id: &str) -> Option<Arc<dyn Transport>> {
        self.channels.read().await.get(channel_id).cloned()
    }

    pub async fn contains(&self, channel_id: &str) -> bool {
        self.channels.read().await.contains_key(channel_id)
    }

    pub async fn is_active(&self, channel_id: &str) -> bool {
        self.channels
            .read()
            .await
            .get(channel_id)
            .map(|t| t.is_active())
            .unwrap_or(false)
    }

    pub async fn ids(&self) -> Vec<String> {
        self.channels.read().await.keys().cloned().collect()
    }

    pub async fn count(&self) -> usize {
        self.channels.read().await.len()
    }

    /// 遍历全部通道（含传输引用），供状态快照
    pub async fn all(&self) -> Vec<(String, Arc<dyn Transport>)> {
        self.channels
            .read()
            .await
            .iter()
            .map(|(id, t)| (id.clone(), t.clone()))
            .collect()
    }

    /// 原子取走 transport + cancel + 读线程句柄；未注册的项返回 None
    pub async fn remove(
        &self,
        channel_id: &str,
    ) -> (
        Option<Arc<dyn Transport>>,
        Option<Arc<AtomicBool>>,
        Option<std::thread::JoinHandle<()>>,
    ) {
        let transport = self.channels.write().await.remove(channel_id);
        let cancel = self.cancels.write().await.remove(channel_id);
        let reader = self.readers.write().await.remove(channel_id);
        (transport, cancel, reader)
    }

    // ── TCP Server ────────────────────────────────────────────

    pub async fn put_server(&self, server_id: String, server: Arc<TcpServerTransport>) {
        self.tcp_servers.write().await.insert(server_id, server);
    }

    pub async fn get_server(&self, server_id: &str) -> Option<Arc<TcpServerTransport>> {
        self.tcp_servers.read().await.get(server_id).cloned()
    }

    pub async fn remove_server(&self, server_id: &str) -> Option<Arc<TcpServerTransport>> {
        self.tcp_servers.write().await.remove(server_id)
    }

    // ── 父子关系 ──────────────────────────────────────────────

    /// 记录 tcp_server 子客户端的父 Server 通道
    pub async fn set_parent(&self, client_id: String, parent_server_id: String) {
        self.client_parents
            .write()
            .await
            .insert(client_id, parent_server_id);
    }

    pub async fn parent_of(&self, client_id: &str) -> Option<String> {
        self.client_parents.read().await.get(client_id).cloned()
    }

    /// 同步查询父通道（总线订阅线程内使用；阻塞锁但持锁时间极短）
    pub fn parent_of_sync(&self, client_id: &str) -> Option<String> {
        self.client_parents.blocking_read().get(client_id).cloned()
    }

    pub async fn remove_parent(&self, client_id: &str) {
        self.client_parents.write().await.remove(client_id);
    }

    /// 某 Server 的全部在线子客户端通道
    pub async fn children_of(&self, parent_server_id: &str) -> Vec<String> {
        self.client_parents
            .read()
            .await
            .iter()
            .filter(|(_, parent)| *parent == parent_server_id)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 全部 (client_id, parent_server_id) 对，供客户端清单 / 状态快照
    pub async fn all_parents(&self) -> Vec<(String, String)> {
        self.client_parents
            .read()
            .await
            .iter()
            .map(|(id, parent)| (id.clone(), parent.clone()))
            .collect()
    }
}

impl Default for ChannelManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use transport::mock::MockTransport;

    #[tokio::test]
    async fn put_get_contains_remove() {
        use transport::Transport;

        let mgr = ChannelManager::new();
        let mut mock = MockTransport::new("serial", "COM1");
        mock.open().unwrap();
        let t: Arc<dyn Transport> = Arc::new(mock);
        mgr.put_transport("ch1".to_string(), t).await;
        assert!(mgr.contains("ch1").await);
        assert_eq!(mgr.count().await, 1);
        assert!(mgr.is_active("ch1").await);

        let (t, _, _) = mgr.remove("ch1").await;
        assert!(t.is_some());
        assert!(!mgr.contains("ch1").await);
    }

    #[tokio::test]
    async fn parent_relations() {
        let mgr = ChannelManager::new();
        mgr.set_parent("tcp_client-1".to_string(), "server".to_string())
            .await;
        mgr.set_parent("tcp_client-2".to_string(), "server".to_string())
            .await;
        mgr.set_parent("tcp_client-3".to_string(), "other".to_string())
            .await;

        assert_eq!(
            mgr.parent_of("tcp_client-1").await.as_deref(),
            Some("server")
        );
        assert_eq!(mgr.children_of("server").await.len(), 2);
        assert_eq!(mgr.all_parents().await.len(), 3);

        mgr.remove_parent("tcp_client-1").await;
        assert_eq!(mgr.parent_of("tcp_client-1").await, None);
    }
}
