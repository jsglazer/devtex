// Registers the app's own commands with Tauri's ACL so each must be granted
// by a capability (capabilities/default.json) — nothing is allowed implicitly.
const COMMANDS: &[&str] = &[
    "platform",
    "open_project",
    "list_files",
    "read_file",
    "read_bytes",
    "stat_file",
    "save_file",
    "compile",
    "cancel_compile",
    "read_synctex",
    "cached_synctex",
    "push_review",
    "set_token",
    "has_token",
    "delete_token",
    "bbt_rpc",
    "read_config",
    "write_config",
    "list_syntax_files",
    "list_theme_files",
    "config_location",
    "open_config_folder",
    "system_appearance",
    "resolve_open_paths",
    "take_opened_paths",
];

fn main() {
    let attrs = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(e) = tauri_build::try_build(attrs) {
        panic!("tauri build failed: {e:#}");
    }
}
