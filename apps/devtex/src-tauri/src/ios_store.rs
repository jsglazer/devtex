//! iOS FileStore: every read, write, stat and listing goes through
//! NSFileCoordinator via tauri-plugin-ios-bookmarks, inside the vault folder
//! whose security-scoped access the plugin restored at launch.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Wry};
use tauri_plugin_ios_bookmarks::IosBookmarksExt;

use crate::error::{AppError, AppResult};
use crate::fsguard::{is_project_file, FileStore};

pub struct CoordinatedStore {
    app: AppHandle<Wry>,
}

impl CoordinatedStore {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

fn native(e: tauri_plugin_ios_bookmarks::Error) -> AppError {
    AppError::Io {
        message: e.to_string(),
    }
}

fn path_str(p: &Path) -> String {
    p.display().to_string()
}

impl FileStore for CoordinatedStore {
    fn read(&self, path: &Path) -> AppResult<Option<Vec<u8>>> {
        self.app
            .ios_bookmarks()
            .read(&path_str(path))
            .map_err(native)
    }

    fn mtime_ms(&self, path: &Path) -> AppResult<Option<f64>> {
        Ok(self
            .app
            .ios_bookmarks()
            .stat(&path_str(path))
            .map_err(native)?
            .mtime_ms)
    }

    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        self.app
            .ios_bookmarks()
            .write(&path_str(path), bytes)
            .map_err(native)
    }

    fn list(&self, root: &Path) -> AppResult<Vec<PathBuf>> {
        let listing = self
            .app
            .ios_bookmarks()
            .list(&path_str(root))
            .map_err(native)?;
        Ok(listing
            .files
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| is_project_file(p))
            .collect())
    }
}
