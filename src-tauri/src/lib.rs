//! Serial Tools - Tauri 后端入口

pub mod commands;
pub mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // 连接管理
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::list_ports,
            commands::connection::get_connection_status,
            // 数据收发
            commands::data::send_data,
            commands::data::get_packets,
            commands::data::clear_packets,
            // 协议解析
            commands::protocol::get_parsed_results,
            commands::protocol::clear_parsed,
            // 端口转发
            commands::forward::start_forward,
            commands::forward::stop_forward,
            commands::forward::list_forwarders,
            // 配置管理
            commands::config::load_session,
            commands::config::save_session,
            commands::config::list_sessions,
            commands::config::delete_session,
            // 日志管理
            commands::log::get_logs,
            commands::log::export_logs,
            commands::log::clear_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
