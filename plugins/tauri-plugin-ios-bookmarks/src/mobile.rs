use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{Error, FileData, FileStat, Listing, PathArgs, Result, VaultFolder, WriteArgs};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ios_bookmarks);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<IosBookmarks<R>> {
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_ios_bookmarks)?;
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("", "Unsupported")?;
    Ok(IosBookmarks(handle))
}

/// Native calls (synchronous: each waits for the Swift reply).
pub struct IosBookmarks<R: Runtime>(PluginHandle<R>);

fn b64_encode(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn b64_decode(s: &str) -> Result<Vec<u8>> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| Error::Native(format!("invalid base64 from native side: {e}")))
}

impl<R: Runtime> IosBookmarks<R> {
    pub fn pick_folder(&self) -> Result<VaultFolder> {
        self.0
            .run_mobile_plugin("pickFolder", ())
            .map_err(Into::into)
    }
    pub fn restore(&self) -> Result<VaultFolder> {
        self.0.run_mobile_plugin("restore", ()).map_err(Into::into)
    }
    pub fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let r: FileData = self
            .0
            .run_mobile_plugin("readFile", PathArgs { path: path.into() })?;
        r.data.map(|d| b64_decode(&d)).transpose()
    }
    pub fn write(&self, path: &str, bytes: &[u8]) -> Result<()> {
        let _: serde::de::IgnoredAny = self.0.run_mobile_plugin(
            "writeFile",
            WriteArgs {
                path: path.into(),
                data: b64_encode(bytes),
            },
        )?;
        Ok(())
    }
    pub fn stat(&self, path: &str) -> Result<FileStat> {
        self.0
            .run_mobile_plugin("stat", PathArgs { path: path.into() })
            .map_err(Into::into)
    }
    pub fn list(&self, path: &str) -> Result<Listing> {
        self.0
            .run_mobile_plugin("list", PathArgs { path: path.into() })
            .map_err(Into::into)
    }
}
