use tauri::{command, AppHandle, Runtime};

use crate::{IosBookmarksExt, Result, VaultFolder};

#[command]
pub(crate) async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<VaultFolder> {
    app.ios_bookmarks().pick_folder()
}

#[command]
pub(crate) async fn restore_vault<R: Runtime>(app: AppHandle<R>) -> Result<VaultFolder> {
    app.ios_bookmarks().restore()
}
