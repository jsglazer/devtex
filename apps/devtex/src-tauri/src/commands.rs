//! Tauri commands: thin wrappers over the pure modules. Every file path from
//! the frontend is project-relative and resolved through [`ProjectScope`];
//! every .tex write goes through [`fsguard::save_guarded`].

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::fsguard::{self, FileStamp, FileStore, ProjectScope};
use crate::github::{GitDataClient, PushFile, PushOutcome, RepoTarget, GITHUB_API};
use crate::store::{self, SecretStore, TOKEN_NAME};

/// Review pushes always go to this repository and branch (markup-reviewer convention).
pub const PAPERS_TARGET: (&str, &str, &str) = ("jsglazer", "papers", "main");

pub struct AppState {
    pub scope: Mutex<Option<ProjectScope>>,
    /// std::fs on macOS; NSFileCoordinator-backed store on iOS (swapped in at setup).
    pub files: std::sync::RwLock<Arc<dyn FileStore>>,
    pub secrets: Arc<dyn SecretStore>,
    pub http: reqwest::Client,
    #[cfg(target_os = "macos")]
    pub watcher: Mutex<Option<crate::watcher::mac::ProjectWatcher>>,
    #[cfg(target_os = "macos")]
    pub runner: Arc<crate::latexmk::SystemRunner>,
    #[cfg(target_os = "macos")]
    pub paths: Arc<crate::latexmk::PathCache>,
}

impl AppState {
    pub fn files(&self) -> Arc<dyn FileStore> {
        match self.files.read() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    fn scope(&self) -> AppResult<ProjectScope> {
        self.scope
            .lock()
            .map_err(|_| AppError::NoProject)?
            .clone()
            .ok_or(AppError::NoProject)
    }
}

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    #[cfg(target_os = "macos")]
    let dir = app.path().data_dir().map(|d| d.join("DevTex"));
    #[cfg(not(target_os = "macos"))]
    let dir = app.path().app_config_dir();
    dir.map_err(|e| AppError::Io {
        message: e.to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub name: String,
    pub vault_root: Option<String>,
    /// Project folder relative to the vault root ("" when it is the vault root).
    pub vault_relative: Option<String>,
}

#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<ProjectInfo> {
    let scope = ProjectScope::new(PathBuf::from(&path))?;
    let root = scope.root().to_path_buf();
    #[cfg(target_os = "macos")]
    {
        let w = crate::watcher::mac::watch(app.clone(), &root)?;
        if let Ok(mut g) = state.watcher.lock() {
            *g = Some(w);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = &app;
    let vault_root = fsguard::find_vault_root(&root);
    let vault_relative = vault_root
        .as_ref()
        .and_then(|v| root.strip_prefix(v).ok())
        .map(|r| r.to_string_lossy().replace('\\', "/"));
    if let Ok(mut g) = state.scope.lock() {
        *g = Some(scope);
    }
    Ok(ProjectInfo {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        root: root.display().to_string(),
        vault_root: vault_root.map(|v| v.display().to_string()),
        vault_relative,
    })
}

#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let scope = state.scope()?;
    let files = state.files().list(scope.root())?;
    Ok(files.iter().filter_map(|p| scope.relative(p)).collect())
}

#[derive(Serialize)]
pub struct ReadResult {
    pub text: String,
    pub stamp: FileStamp,
}

#[tauri::command]
pub async fn read_file(state: State<'_, AppState>, path: String) -> AppResult<ReadResult> {
    let abs = state.scope()?.resolve(&path)?;
    let (text, stamp) = fsguard::read_text(state.files().as_ref(), &abs)?;
    Ok(ReadResult { text, stamp })
}

#[tauri::command]
pub async fn read_bytes(state: State<'_, AppState>, path: String) -> AppResult<Response> {
    let abs = state.scope()?.resolve(&path)?;
    let bytes = state
        .files()
        .read(&abs)?
        .ok_or(AppError::NotFound { path })?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn stat_file(state: State<'_, AppState>, path: String) -> AppResult<Option<FileStamp>> {
    let abs = state.scope()?.resolve(&path)?;
    fsguard::stamp_of(state.files().as_ref(), &abs)
}

/// The only write path for project files: mtime + content-hash checked.
#[tauri::command]
pub async fn save_file(
    state: State<'_, AppState>,
    path: String,
    text: String,
    expected: Option<FileStamp>,
) -> AppResult<FileStamp> {
    let abs = state.scope()?.resolve(&path)?;
    fsguard::save_guarded(state.files().as_ref(), &abs, &text, expected.as_ref())
}

#[tauri::command]
pub async fn compile(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
    engine: crate::latexmk::Engine,
    latexmk_path: Option<String>,
) -> AppResult<crate::latexmk::CompileOutcome> {
    #[cfg(target_os = "macos")]
    {
        let abs = state.scope()?.resolve(&root)?;
        let cache = app.path().cache_dir().map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        let runner = state.runner.clone();
        let paths = state.paths.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let req = crate::latexmk::CompileRequest {
                root_abs: &abs,
                engine,
                cache_base: &cache,
                latexmk_override: latexmk_path.as_deref(),
            };
            crate::latexmk::compile(&req, runner.as_ref(), paths.as_ref())
        })
        .await
        .map_err(|e| AppError::Compile {
            message: e.to_string(),
        })?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, root, engine, latexmk_path);
        Err(AppError::NotSupported {
            message: "PDF compile is macOS-only".into(),
        })
    }
}

#[tauri::command]
pub async fn cancel_compile(state: State<'_, AppState>) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use crate::latexmk::ProcessRunner;
        state.runner.kill_current()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Ok(())
    }
}

/// Read a .synctex(.gz) produced by `compile` (only inside the DevTex cache).
#[tauri::command]
pub async fn read_synctex(app: AppHandle, path: String) -> AppResult<Response> {
    let cache = app
        .path()
        .cache_dir()
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?
        .join("DevTex");
    let p = PathBuf::from(&path).canonicalize()?;
    if !p.starts_with(cache.canonicalize().unwrap_or(cache)) || !path.contains(".synctex") {
        return Err(AppError::OutsideProject { path });
    }
    Ok(Response::new(std::fs::read(p)?))
}

/// Cached .synctex.gz for the existing PDF of `root` (see latexmk::cached_synctex).
#[tauri::command]
pub async fn cached_synctex(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> AppResult<Option<String>> {
    let abs = state.scope()?.resolve(&root)?;
    let cache = app.path().cache_dir().map_err(|e| AppError::Io {
        message: e.to_string(),
    })?;
    Ok(crate::latexmk::cached_synctex(&cache, &abs).map(|p| p.display().to_string()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushEntry {
    pub local_path: String,
    pub repo_path: String,
}

#[tauri::command]
pub async fn push_review(
    app: AppHandle,
    state: State<'_, AppState>,
    entries: Vec<PushEntry>,
    message: String,
    allow_untracked: bool,
) -> AppResult<PushOutcome> {
    let scope = state.scope()?;
    let token = state.secrets.get(TOKEN_NAME)?.ok_or(AppError::NoToken)?;
    let mut files = Vec::with_capacity(entries.len());
    for e in &entries {
        let abs = scope.resolve(&e.local_path)?;
        let bytes = state
            .files()
            .read(&abs)?
            .ok_or_else(|| AppError::NotFound {
                path: e.local_path.clone(),
            })?;
        files.push(PushFile {
            repo_path: e.repo_path.clone(),
            bytes,
        });
    }
    let (owner, repo, branch) = PAPERS_TARGET;
    let target = RepoTarget {
        owner: owner.into(),
        repo: repo.into(),
        branch: branch.into(),
    };
    let key = store::push_state_key(owner, repo, branch);
    let state_file = config_dir(&app)?.join("push-state.json");
    let last: BTreeMap<String, String> = store::load_push_state(&state_file)?
        .remove(&key)
        .unwrap_or_default();
    let client = GitDataClient::new(state.http.clone(), GITHUB_API, &token, target);
    let outcome = client
        .push(&files, &message, &last, allow_untracked)
        .await?;
    store::record_push(&state_file, &key, &outcome.blob_shas)?;
    Ok(outcome)
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, token: String) -> AppResult<()> {
    state.secrets.set(TOKEN_NAME, token.trim())
}

#[tauri::command]
pub async fn has_token(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.secrets.get(TOKEN_NAME)?.is_some())
}

#[tauri::command]
pub async fn delete_token(state: State<'_, AppState>) -> AppResult<()> {
    state.secrets.delete(TOKEN_NAME)
}

#[tauri::command]
pub async fn bbt_rpc(state: State<'_, AppState>, body: String) -> AppResult<String> {
    #[cfg(target_os = "macos")]
    {
        crate::bbt::post(
            &state.http,
            crate::bbt::BBT_ENDPOINT,
            body,
            crate::bbt::BBT_TIMEOUT,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (state, body);
        Err(AppError::NotSupported {
            message: "Zotero is not reachable on iOS; using .bib files".into(),
        })
    }
}

#[tauri::command]
pub async fn read_config(app: AppHandle, name: String) -> AppResult<Option<String>> {
    store::read_config(&config_dir(&app)?, &name)
}

#[tauri::command]
pub async fn write_config(app: AppHandle, name: String, content: String) -> AppResult<()> {
    store::write_config(&config_dir(&app)?, &name, &content)
}

#[tauri::command]
pub async fn list_syntax_files(app: AppHandle) -> AppResult<Vec<String>> {
    store::list_syntax_files(&config_dir(&app)?)
}

#[tauri::command]
pub async fn config_location(app: AppHandle) -> AppResult<String> {
    Ok(config_dir(&app)?.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: &'static str,
    pub can_compile: bool,
    pub can_watch: bool,
    pub has_zotero: bool,
    /// Debug builds only: project folder from DEVTEX_OPEN, for manual QA.
    pub initial_project: Option<String>,
    /// Debug builds only: comma-separated command ids from DEVTEX_RUN, run after opening.
    pub initial_commands: Option<String>,
}

#[tauri::command]
pub fn platform() -> PlatformInfo {
    let mac = cfg!(target_os = "macos");
    PlatformInfo {
        os: if mac {
            "macos"
        } else if cfg!(target_os = "ios") {
            "ios"
        } else {
            "other"
        },
        can_compile: mac,
        can_watch: mac,
        has_zotero: mac,
        initial_project: if cfg!(debug_assertions) {
            std::env::var("DEVTEX_OPEN").ok()
        } else {
            None
        },
        initial_commands: if cfg!(debug_assertions) {
            std::env::var("DEVTEX_RUN").ok()
        } else {
            None
        },
    }
}

/// Commands registered with the app (also the ACL list in build.rs).
pub const COMMANDS: [&str; 20] = [
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
    "config_location",
];
