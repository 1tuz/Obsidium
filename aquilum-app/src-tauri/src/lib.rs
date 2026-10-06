#[cfg(all(desktop, not(debug_assertions)))]
mod autostart;
mod blocking;
mod export;
mod files;
mod history;
mod link_title;
mod mcp;
mod migration;
mod search;
mod settings;
mod ui_state;
mod window_state;
mod wikixiv;
mod updater;
mod web_agent;

use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

pub fn run_mcp_stdio_bridge() -> i32 {
    mcp::run_stdio_bridge()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        None,
    ));

    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let notifier: search::ChangeNotifier = Arc::new(move |paths| {
                let paths = paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                let _ = handle.emit(search::WORKSPACE_CHANGED_EVENT, paths);
            });
            let handle = app.handle().clone();
            let watch_sink: files::watcher::WatchSink = Arc::new(move |batch| {
                use files::watcher::WatchScope;
                let names = batch
                    .paths
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                if !names.is_empty() {
                    let _ = handle.emit(search::DOCUMENTS_CHANGED_EVENT, &names);
                }
                if batch.scope >= WatchScope::Structure {
                    let _ = handle.emit(search::WORKSPACE_CHANGED_EVENT, &names);
                }
                handle
                    .state::<search::SearchService>()
                    .ingest_watch(batch.paths, batch.scope == WatchScope::Rescan);
            });
            app.manage(files::watcher::WorkspaceWatcher::new(watch_sink));
            let handle = app.handle().clone();
            let index_notifier: search::IndexNotifier = Arc::new(move |event| {
                let _ = handle.emit(search::LINKS_CHANGED_EVENT, event);
            });
            
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            migration::migrate_legacy_data(&app_data_dir);
            
            let settings_manager = settings::SettingsManager::new(&app_data_dir);
            let mcp_settings = settings_manager.get_config().mcp;
            app.manage(settings_manager);
            let window_state_manager = window_state::WindowStateManager::new(&app_data_dir);
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                allow_pinch_gestures(&window);
                window_state_manager.restore(&window);
                window_state_manager.initialize(&window);
            }
            app.manage(window_state_manager);
            app.manage(wikixiv::WikixivService::new());

            let ui_state_service = ui_state::UiStateService::open(&app_data_dir.join("ui-state.sqlite3"));
            let search_service = search::SearchService::new(
                app_data_dir.join("search-v2"),
                notifier,
                index_notifier,
            );
            app.manage(ui_state_service);
            app.manage(history::HistoryService::new(&app_data_dir));
            app.manage(search_service);

            app.manage(mcp::active::ActiveNote::default());
            let mcp_server = mcp::McpServer::new();
            mcp_server.apply(app.handle(), &mcp_settings);
            app.manage(mcp_server);

            #[cfg(all(desktop, not(debug_assertions)))]
            autostart::repoint_to_current_exe(app.handle());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::commands::get_settings,
            settings::commands::update_settings,
            updater::check_for_update,
            updater::install_update,
            files::commands::read_directory,
            files::commands::existing_files,
            files::commands::resolve_attachments,
            files::commands::read_file_snapshot,
            files::commands::read_file_hash,
            files::commands::read_file_stat,
            files::commands::hash_text,
            files::commands::write_file_atomic,
            files::commands::create_file,
            files::commands::create_binary_file,
            files::commands::ensure_directory,
            files::commands::trash_file,
            files::commands::get_trash_state,
            files::commands::list_trash,
            files::commands::restore_deletion,
            files::commands::open_trash,
            files::commands::cleanup_trash,
            history::commands::note_history,
            history::commands::read_note_version,
            history::commands::name_note_version,
            history::commands::cleanup_history,
            files::commands::copy_file,
            files::commands::rename_file,
            search::commands::prepare_search_index,
            search::commands::search_knowledge_base,
            search::commands::get_search_index_status,
            search::commands::get_backlinks,
            search::commands::get_outgoing_links,
            search::commands::resolve_wiki_links,
            search::commands::suggest_notes,
            search::commands::get_note_fields,
            search::commands::run_dataview_query,
            search::analysis::commands::analyze_document,
            search::graph::commands::get_graph_snapshot,
            search::graph::commands::get_graph_paths,
            wikixiv::commands::wikixiv_search,
            link_title::commands::fetch_page_title,
            ui_state::commands::list_ui_workspaces,
            ui_state::commands::forget_ui_workspace,
            ui_state::commands::set_ui_workspace_home_page,
            ui_state::commands::resolve_ui_workspace,
            ui_state::commands::resolve_ui_document,
            ui_state::commands::open_ui_session,
            ui_state::commands::save_ui_state_batch,
            ui_state::commands::load_ui_document_view,
            ui_state::commands::rename_ui_document,
            ui_state::commands::mark_ui_document_missing,
            ui_state::commands::reset_ui_state,
            ui_state::commands::cleanup_ui_state,
            ui_state::commands::load_ui_reader_state,
            ui_state::commands::save_ui_reader_state,
            mcp::commands::get_mcp_status,
            mcp::commands::apply_mcp_settings,
            mcp::commands::set_active_note,
            export::commands::export_pdf,
            export::commands::pdf_export_is_native
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let state = window.state::<window_state::WindowStateManager>();
            match event {
                WindowEvent::Resized(_) => state.observe(window),
                WindowEvent::CloseRequested { .. } => {
                    state.capture_and_persist(window);
                    window.state::<mcp::McpServer>().shutdown();
                    window.state::<files::watcher::WorkspaceWatcher>().stop();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
fn allow_pinch_gestures(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows::core::Interface;
    let _ = window.with_webview(|webview| {
        let enabled = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings5>())
                .and_then(|settings| settings.SetIsPinchZoomEnabled(true))
        };
        if let Err(error) = enabled {
            eprintln!("[aquilum:input] pinch gestures stay disabled: {error}");
        }
    });
}
