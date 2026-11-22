//! tauri-plugin-ios-bookmarks (DevTex, Phase B).
//!
//! iOS: the Swift side picks the vault folder with UIDocumentPickerViewController,
//! persists a security-scoped bookmark, and restores + starts access in the
//! plugin's `load()` on cold launch — i.e. before any filesystem call. Reads
//! and writes go through NSFileCoordinator (`read`, `write`, `stat`, `list`).
//! Desktop: every call returns `Error::Unsupported` (macOS uses std::fs).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
pub use desktop::IosBookmarks;
#[cfg(mobile)]
pub use mobile::IosBookmarks;

pub trait IosBookmarksExt<R: Runtime> {
    fn ios_bookmarks(&self) -> &IosBookmarks<R>;
}

impl<R: Runtime, T: Manager<R>> IosBookmarksExt<R> for T {
    fn ios_bookmarks(&self) -> &IosBookmarks<R> {
        self.state::<IosBookmarks<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ios-bookmarks")
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::restore_vault
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let b = mobile::init(app, api)?;
            #[cfg(desktop)]
            let b = desktop::init(app, api)?;
            app.manage(b);
            Ok(())
        })
        .build()
}
