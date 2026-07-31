//! Serial Tools - Tauri 后端入口

pub mod commands;
pub mod state;
pub mod logger;
pub mod event_bridge;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            event_bridge::start_event_bridge(app.handle().clone(), state.rx_broadcast.clone());
            event_bridge::start_log_bridge(app.handle().clone(), state.log_broadcast.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 连接管理
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::disconnect_all,
            commands::connection::disconnect_client,
            commands::connection::list_server_clients,
            commands::connection::list_ports,
            commands::connection::get_connection_status,
            // 数据收发
            commands::data::send_data,
            commands::data::get_packets,
            commands::data::clear_packets,
            // 数据总线
            commands::forward::create_bus,
            commands::forward::subscribe_bus,
            commands::forward::unsubscribe_bus,
            commands::forward::list_buses,
            commands::forward::stop_bus,
            commands::forward::delete_bus,
            // 日志
            commands::log::get_logs,
            commands::log::clear_logs,
            // 配置管理
            commands::config::load_session,
            commands::config::save_session,
            commands::config::list_sessions,
            commands::config::delete_session,
            // 协议解析
            commands::protocol::get_parsed_results,
            commands::protocol::clear_parsed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
