//! Typed, serializable errors returned by every Tauri command. Commands never
//! panic; the frontend switches on `kind`.

use serde::Serialize;

use crate::fsguard::FileStamp;

#[derive(Debug, thiserror::Error, Serialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    #[error("I/O error: {message}")]
    Io { message: String },
    #[error("no project folder is open")]
    NoProject,
    #[error("path is outside the project folder: {path}")]
    OutsideProject { path: String },
    #[error("file not found: {path}")]
    NotFound { path: String },
    /// The file changed on disk since it was read; nothing was written.
    #[error("file changed on disk: {path}")]
    Conflict {
        path: String,
        disk: Option<FileStamp>,
    },
    #[error("latexmk not found (checked the login shell PATH)")]
    LatexmkNotFound,
    #[error("compile failed to start: {message}")]
    Compile { message: String },
    #[error("GitHub rejected the token (401)")]
    Unauthorized,
    #[error("GitHub refused access (403): {message}")]
    Forbidden { message: String },
    #[error("GitHub resource not found (404): {message}")]
    GithubNotFound { message: String },
    #[error("GitHub conflict (409): {message}")]
    GithubConflict { message: String },
    #[error("GitHub rejected the request (422): {message}")]
    Unprocessable { message: String },
    #[error("GitHub error {status}: {message}")]
    Github { status: u16, message: String },
    /// Remote file differs from the SHA DevTex last pushed: someone else changed it.
    #[error("remote files changed since the last push: {paths:?}")]
    RemoteChanged { paths: Vec<String> },
    /// Remote file exists but DevTex has no record of pushing it.
    #[error("remote files exist that DevTex did not push: {paths:?}")]
    RemoteUntracked { paths: Vec<String> },
    #[error("network error: {message}")]
    Network { message: String },
    #[error("no GitHub token in the Keychain (github-papers-token)")]
    NoToken,
    #[error("Keychain error: {message}")]
    Keychain { message: String },
    #[error("Better BibTeX unavailable: {message}")]
    Bbt { message: String },
    #[error("not supported on this platform: {message}")]
    NotSupported { message: String },
    #[error("invalid config file name: {name}")]
    ConfigName { name: String },
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io {
            message: e.to_string(),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
