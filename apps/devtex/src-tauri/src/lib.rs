//! DevTex Tauri core.
//!
//! Pure modules (no Tauri types): `fsguard` (guarded I/O, project scope),
//! `latexmk` (args, PATH, compile via an injectable runner), `github`
//! (Git Data API client), `bbt` (BBT transport), `store` (push state, config,
//! secrets), `menu::menu_spec`, `watcher::relevant_changes`. `commands` and
//! the setup below are the thin Tauri shell.

pub mod bbt;
pub mod commands;
pub mod error;
pub mod fsguard;
pub mod github;
#[cfg(target_os = "ios")]
pub mod ios_store;
pub mod latexmk;
pub mod menu;
pub mod store;
pub mod watcher;

use std::sync::{Arc, Mutex};

use commands::AppState;

fn app_state() -> AppState {
    AppState {
        scope: Mutex::new(None),
        files: std::sync::RwLock::new(Arc::new(fsguard::StdFileStore)),
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        secrets: Arc::new(store::Keychain),
        http: reqwest::Client::new(),
        #[cfg(target_os = "macos")]
        watcher: Mutex::new(None),
        #[cfg(target_os = "macos")]
        runner: Arc::new(latexmk::SystemRunner::default()),
        #[cfg(target_os = "macos")]
        paths: Arc::new(latexmk::PathCache::default()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_ios_bookmarks::init())
        .manage(app_state());

    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(|app, event| {
        use tauri::Emitter;
        let id = event.id().0.as_str();
        if menu::command_ids().contains(id) {
            let _ = app.emit(menu::MENU_EVENT, id.to_string());
        }
    });

    // iOS: route every project read/write through NSFileCoordinator (ios-bookmarks plugin).
    #[cfg(target_os = "ios")]
    let builder = builder.setup(|app| {
        use tauri::Manager;
        let store = ios_store::CoordinatedStore::new(app.handle().clone());
        if let Ok(mut g) = app.state::<AppState>().files.write() {
            *g = Arc::new(store);
        }
        Ok(())
    });

    let result = builder
        .invoke_handler(tauri::generate_handler![
            commands::platform,
            commands::open_project,
            commands::list_files,
            commands::read_file,
            commands::read_bytes,
            commands::stat_file,
            commands::save_file,
            commands::compile,
            commands::cancel_compile,
            commands::read_synctex,
            commands::push_review,
            commands::set_token,
            commands::has_token,
            commands::delete_token,
            commands::bbt_rpc,
            commands::read_config,
            commands::write_config,
            commands::list_syntax_files,
            commands::config_location,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("DevTex failed to start: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    /// The handler list, build.rs ACL list and capability must stay in sync.
    #[test]
    fn command_lists_agree() {
        let build_rs = include_str!("../build.rs");
        let capability = include_str!("../capabilities/default.json");
        let lib_rs = include_str!("lib.rs");
        for c in crate::commands::COMMANDS {
            assert!(
                build_rs.contains(&format!("\"{c}\"")),
                "{c} missing from build.rs"
            );
            assert!(
                capability.contains(&format!("\"allow-{}\"", c.replace('_', "-"))),
                "{c} missing from capability"
            );
            assert!(
                lib_rs.contains(&format!("commands::{c},")),
                "{c} missing from generate_handler"
            );
        }
    }
}
