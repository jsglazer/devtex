use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultFolder {
    /// Filesystem path of the folder (access already started), or None.
    pub path: Option<String>,
    /// True when the stored bookmark was stale and has been refreshed.
    #[serde(default)]
    pub refreshed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathArgs {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteArgs {
    pub path: String,
    /// Base64 file contents.
    pub data: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    /// Base64 contents; None when the file does not exist.
    pub data: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// Modification time in ms since the epoch; None when the file does not exist.
    pub mtime_ms: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// Absolute paths of regular files under the folder (recursive, hidden entries skipped).
    pub files: Vec<String>,
}
