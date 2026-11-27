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
    /// Watches `<config>/themes` for user.css hot reload.
    #[cfg(target_os = "macos")]
    pub theme_watcher: Mutex<Option<crate::watcher::mac::ProjectWatcher>>,
    /// Watches DevStyle's shared folder (another app changed the style).
    #[cfg(target_os = "macos")]
    pub devstyle_watcher: Mutex<Option<crate::watcher::mac::ProjectWatcher>>,
    #[cfg(target_os = "macos")]
    pub runner: Arc<crate::latexmk::SystemRunner>,
    #[cfg(target_os = "macos")]
    pub paths: Arc<crate::latexmk::PathCache>,
    /// Files/folders handed over by Finder (double-click, Open With, drop on
    /// the Dock icon) that the frontend has not taken yet. Finder can deliver
    /// them before the webview is listening, so they wait here.
    pub opened: Mutex<Vec<OpenRequest>>,
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

pub(crate) fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
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
pub async fn list_theme_files(app: AppHandle) -> AppResult<Vec<String>> {
    store::list_theme_files(&config_dir(&app)?)
}

#[tauri::command]
pub async fn delete_theme_file(app: AppHandle, name: String) -> AppResult<()> {
    store::delete_theme_file(&config_dir(&app)?, &name)
}

/// DevStyle's shared folder (macOS only: iOS has no Mac App Group container).
pub(crate) fn devstyle_dir(app: &AppHandle) -> AppResult<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = app.path().home_dir().map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        Ok(crate::devstyle::folder(&home))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(AppError::NotSupported {
            message: "the shared DevStyle folder is macOS-only".into(),
        })
    }
}

#[tauri::command]
pub async fn devstyle_read(app: AppHandle, path: String) -> AppResult<Option<String>> {
    crate::devstyle::read(&devstyle_dir(&app)?, &path)
}

#[tauri::command]
pub async fn devstyle_write(app: AppHandle, path: String, text: String) -> AppResult<()> {
    crate::devstyle::write(&devstyle_dir(&app)?, &path, &text)
}

#[tauri::command]
pub async fn devstyle_list(app: AppHandle, dir: String) -> AppResult<Vec<String>> {
    crate::devstyle::list(&devstyle_dir(&app)?, &dir)
}

#[tauri::command]
pub async fn devstyle_location(app: AppHandle) -> AppResult<String> {
    Ok(devstyle_dir(&app)?.display().to_string())
}

#[tauri::command]
pub async fn config_location(app: AppHandle) -> AppResult<String> {
    Ok(config_dir(&app)?.display().to_string())
}

/// Show the config folder in Finder (macOS), creating it first if needed.
#[tauri::command]
pub async fn open_config_folder(app: AppHandle) -> AppResult<()> {
    let dir = config_dir(&app)?;
    #[cfg(target_os = "macos")]
    {
        std::fs::create_dir_all(dir.join("themes"))?;
        std::process::Command::new("/usr/bin/open")
            .arg(&dir)
            .status()?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dir;
        Err(AppError::NotSupported {
            message: "Opening the config folder is macOS-only".into(),
        })
    }
}

/// Check the View ▸ Style Profile item for `family` (e.g. "Paper") and
/// uncheck the others; an unknown family (a custom profile) unchecks all.
/// A no-op where there is no app menu (iOS).
#[tauri::command]
pub async fn set_style_profile_check(app: AppHandle, family: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    crate::menu::set_checked_choice(
        &app,
        crate::menu::STYLE_PROFILE_PREFIX,
        &format!("{}{family}", crate::menu::STYLE_PROFILE_PREFIX),
    )
    .map_err(|e| AppError::Io {
        message: format!("menu: {e}"),
    })?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, family);
    Ok(())
}

/// The system's light/dark setting, independent of any appearance DevTex
/// forced on its window: "dark" or "light" on macOS, null elsewhere.
#[tauri::command]
pub async fn system_appearance() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleInterfaceStyle"])
            .output()
            .ok()?;
        Some(appearance_from_defaults(&String::from_utf8_lossy(&out.stdout)).to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// `defaults read -g AppleInterfaceStyle` prints "Dark" in dark mode and
/// fails (empty stdout) in light mode.
pub fn appearance_from_defaults(stdout: &str) -> &'static str {
    if stdout.trim().eq_ignore_ascii_case("dark") {
        "dark"
    } else {
        "light"
    }
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
pub const COMMANDS: [&str; 31] = [
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
    "delete_theme_file",
    "devstyle_read",
    "devstyle_write",
    "devstyle_list",
    "devstyle_location",
    "config_location",
    "open_config_folder",
    "system_appearance",
    "resolve_open_paths",
    "take_opened_paths",
    "set_style_profile_check",
];

// ---------- Finder open requests (macOS) ----------

/// Event the frontend listens on; it then calls `take_opened_paths`.
pub const OPEN_EVENT: &str = "devtex://open-files";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    /// Canonical absolute path (matches `ProjectInfo.root`'s form).
    pub path: String,
    pub is_dir: bool,
    /// Folder to open as the project: the folder itself, or for a file the
    /// folder holding its main document (see [`project_dir_for`]).
    pub project: String,
}

/// Turn a path from Finder into an open request: folders open as projects;
/// files only if DevTex edits them (.tex/.bib/.sty/.cls). Missing paths and
/// other file types are dropped.
pub fn open_request(path: &std::path::Path) -> Option<OpenRequest> {
    let canon = path.canonicalize().ok()?;
    let is_dir = canon.is_dir();
    if !is_dir && !(canon.is_file() && fsguard::is_project_file(&canon)) {
        return None;
    }
    let project = if is_dir {
        canon.clone()
    } else {
        project_dir_for(
            &canon,
            std::env::var_os("HOME").map(PathBuf::from).as_deref(),
        )
    };
    Some(OpenRequest {
        path: canon.display().to_string(),
        is_dir,
        project: project.display().to_string(),
    })
}

/// How many folders above a subfile to search for its main document.
const MAX_ROOT_SEARCH_LEVELS: usize = 3;

fn has_documentclass(text: &str) -> bool {
    text.lines()
        .map(str::trim_start)
        .any(|l| !l.starts_with('%') && l.contains("\\documentclass"))
}

/// `% !TEX root = <path>` (TeXShop/TeXstudio convention), relative to the file's folder.
fn magic_root(text: &str) -> Option<&str> {
    text.lines().take(20).find_map(|l| {
        let l = l.trim_start().strip_prefix('%')?.trim_start();
        let rest = l.strip_prefix("!TEX")?.trim_start().strip_prefix("root")?;
        let v = rest.trim_start().strip_prefix('=')?.trim();
        (!v.is_empty()).then_some(v)
    })
}

/// The folder to open as the project for a .tex/.bib/.sty/.cls file opened
/// from Finder, so a chapter in `paper/ch/` opens the `paper/` project:
/// 1. `% !TEX root` pointing into an ancestor folder → that root's folder;
/// 2. the file has its own `\documentclass` (or isn't .tex) → its folder;
/// 3. the nearest ancestor (≤ 3 up; not above `home` for files inside it, never `/`) holding a .tex file
///    with `\documentclass`;
/// 4. otherwise its own folder.
pub fn project_dir_for(file: &std::path::Path, home: Option<&std::path::Path>) -> PathBuf {
    let Some(dir) = file.parent().map(std::path::Path::to_path_buf) else {
        return file.to_path_buf();
    };
    if file.extension().and_then(|e| e.to_str()) != Some("tex") {
        return dir;
    }
    let text = std::fs::read_to_string(file).unwrap_or_default();
    if let Some(root) = magic_root(&text) {
        if let Some(root_dir) = dir
            .join(root)
            .canonicalize()
            .ok()
            .and_then(|r| r.parent().map(std::path::Path::to_path_buf))
        {
            if file.starts_with(&root_dir) {
                return root_dir;
            }
        }
    }
    if has_documentclass(&text) {
        return dir;
    }
    let mut cur = dir.as_path();
    for _ in 0..MAX_ROOT_SEARCH_LEVELS {
        let Some(up) = cur.parent() else { break };
        // never search `/`, and never climb out of home for a file inside it
        if up.parent().is_none() || home.is_some_and(|h| file.starts_with(h) && !up.starts_with(h))
        {
            break;
        }
        let has_main = std::fs::read_dir(up)
            .into_iter()
            .flatten()
            .flatten()
            .any(|e| {
                let p = e.path();
                p.extension().and_then(|x| x.to_str()) == Some("tex")
                    && std::fs::read_to_string(&p).is_ok_and(|t| has_documentclass(&t))
            });
        if has_main {
            return up.to_path_buf();
        }
        cur = up;
    }
    dir
}

/// Queue paths from a Finder open event and tell the frontend to take them.
pub fn queue_opened(app: &AppHandle, paths: Vec<PathBuf>) {
    use tauri::Emitter;
    let reqs: Vec<OpenRequest> = paths.iter().filter_map(|p| open_request(p)).collect();
    if reqs.is_empty() {
        return;
    }
    let state = app.state::<AppState>();
    if let Ok(mut g) = state.opened.lock() {
        g.extend(reqs);
    }
    if let Some(w) = app.get_webview_window("main") {
        // unminimize is desktop-only (iOS has no minimized windows)
        #[cfg(desktop)]
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit(OPEN_EVENT, ());
}

/// File ▸ Open File…: turn paths chosen in the open dialog into open
/// requests (same rules as Finder: the project folder of each file).
#[tauri::command]
pub fn resolve_open_paths(paths: Vec<String>) -> Vec<OpenRequest> {
    paths
        .iter()
        .filter_map(|p| open_request(std::path::Path::new(p)))
        .collect()
}

#[tauri::command]
pub fn take_opened_paths(state: State<'_, AppState>) -> Vec<OpenRequest> {
    match state.opened.lock() {
        Ok(mut g) => std::mem::take(&mut *g),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod appearance_tests {
    #[test]
    fn defaults_output_maps_to_appearance() {
        assert_eq!(super::appearance_from_defaults("Dark\n"), "dark");
        assert_eq!(super::appearance_from_defaults(""), "light");
        assert_eq!(super::appearance_from_defaults("Light"), "light");
    }
}

#[cfg(test)]
mod open_tests {
    use super::*;
    use std::path::Path;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("devtex-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    fn write(p: &Path, text: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    const MAIN: &str =
        "\\documentclass{article}\n\\begin{document}\\input{ch/one}\\end{document}\n";

    #[test]
    fn open_request_accepts_folders_and_project_files_only() {
        let dir = tmp("open");
        write(&dir.join("paper.tex"), MAIN);
        write(&dir.join("paper.pdf"), "x");
        let d = dir.display().to_string();
        assert_eq!(
            open_request(&dir),
            Some(OpenRequest {
                path: d.clone(),
                is_dir: true,
                project: d.clone()
            })
        );
        assert_eq!(
            open_request(&dir.join("paper.tex")),
            Some(OpenRequest {
                path: format!("{d}/paper.tex"),
                is_dir: false,
                project: d.clone()
            })
        );
        assert_eq!(open_request(&dir.join("paper.pdf")), None);
        assert_eq!(open_request(&dir.join("missing.tex")), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn subfile_opens_the_folder_of_its_main_document() {
        let dir = tmp("sub");
        write(&dir.join("main.tex"), MAIN);
        write(&dir.join("ch/one.tex"), "Chapter one\n");
        assert_eq!(project_dir_for(&dir.join("ch/one.tex"), Some(&dir)), dir);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn magic_root_comment_wins() {
        let dir = tmp("magic");
        write(&dir.join("paper/main.tex"), MAIN);
        write(
            &dir.join("paper/a/b/c/d/deep.tex"),
            "% !TEX root = ../../../../main.tex\nx\n",
        );
        assert_eq!(
            project_dir_for(&dir.join("paper/a/b/c/d/deep.tex"), Some(&dir)),
            dir.join("paper")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn standalone_and_orphan_files_open_their_own_folder() {
        let dir = tmp("own");
        write(&dir.join("main.tex"), MAIN);
        write(&dir.join("talk/slides.tex"), "\\documentclass{beamer}\n");
        write(&dir.join("talk/refs.bib"), "@book{x,}\n");
        assert_eq!(
            project_dir_for(&dir.join("talk/slides.tex"), Some(&dir)),
            dir.join("talk")
        );
        assert_eq!(
            project_dir_for(&dir.join("talk/refs.bib"), Some(&dir)),
            dir.join("talk")
        );
        // the search never climbs above `home`
        write(&dir.join("h/notes/part.tex"), "no class\n");
        assert_eq!(
            project_dir_for(&dir.join("h/notes/part.tex"), Some(&dir.join("h"))),
            dir.join("h/notes")
        );
        // a file outside home (e.g. an external volume) still finds its main document
        write(&dir.join("ext/ch/two.tex"), "no class\n");
        write(&dir.join("ext/thesis.tex"), MAIN);
        assert_eq!(
            project_dir_for(
                &dir.join("ext/ch/two.tex"),
                Some(Path::new("/nonexistent-home"))
            ),
            dir.join("ext")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn commented_documentclass_does_not_count() {
        assert!(!has_documentclass("% \\documentclass{article}\n"));
        assert!(has_documentclass("  \\documentclass[11pt]{article}\n"));
        assert_eq!(magic_root("%!TEX root=../main.tex\n"), Some("../main.tex"));
        assert_eq!(magic_root("% !TEX program = xelatex\n"), None);
    }
}
