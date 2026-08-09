//! Serial Tools - Tauri 后端入口

pub mod channel_lifecycle;
pub mod commands;
pub mod disconnect_reason;
pub mod domain;
pub mod error;
pub mod event_bridge;
pub mod logger;
pub mod recording;
pub mod state;
pub mod tcp_server_monitor;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            event_bridge::start_event_bridge(app.handle().clone(), state.packets.rx_sender());
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
            commands::connection::set_serial_rx_timeout,
            // 数据收发
            commands::data::send_data,
            commands::data::get_packets,
            commands::data::clear_packets,
            // 数据录制
            commands::recording::start_channel_recording,
            commands::recording::stop_channel_recording,
            commands::recording::list_recordings,
            // 数据总线
            commands::forward::create_bus,
            commands::forward::subscribe_bus,
            commands::forward::unsubscribe_bus,
            commands::forward::list_buses,
            commands::forward::start_bus,
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
            // 导出 / 通道实时日志
            commands::fs_util::get_data_dirs,
            commands::fs_util::write_export_file,
            commands::fs_util::write_binary_export_file,
            commands::fs_util::create_channel_log_file,
            commands::fs_util::append_channel_log,
            commands::fs_util::reveal_in_folder,
            // 协议解析
            commands::protocol::get_parsed_results,
            commands::protocol::clear_parsed,
            // 协议扩展包管理
            commands::protocol_fs::list_protocols,
            commands::protocol_fs::read_protocol_file,
            commands::protocol_fs::protocol_content_mtime,
            commands::protocol_fs::install_protocol_zip,
            commands::protocol_fs::link_protocol_dev,
            commands::protocol_fs::remove_protocol,
            // 更新检查
            commands::updater::check_for_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
