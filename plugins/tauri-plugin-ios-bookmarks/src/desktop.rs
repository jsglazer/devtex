use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, FileStat, Listing, Result, VaultFolder};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<IosBookmarks<R>> {
    Ok(IosBookmarks(app.clone()))
}

/// Desktop stub: macOS uses std::fs with ProjectScope; nothing here is needed.
pub struct IosBookmarks<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> IosBookmarks<R> {
    pub fn pick_folder(&self) -> Result<VaultFolder> {
        Err(Error::Unsupported)
    }
    pub fn restore(&self) -> Result<VaultFolder> {
        Ok(VaultFolder::default())
    }
    pub fn read(&self, _path: &str) -> Result<Option<Vec<u8>>> {
        Err(Error::Unsupported)
    }
    pub fn write(&self, _path: &str, _bytes: &[u8]) -> Result<()> {
        Err(Error::Unsupported)
    }
    pub fn stat(&self, _path: &str) -> Result<FileStat> {
        Err(Error::Unsupported)
    }
    pub fn list(&self, _path: &str) -> Result<Listing> {
        Err(Error::Unsupported)
    }
}
