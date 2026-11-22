const COMMANDS: &[&str] = &["pick_folder", "restore_vault"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
