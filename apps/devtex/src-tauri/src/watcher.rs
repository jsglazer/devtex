//! macOS file watching: `notify` with a 200 ms debounce. Emits the changed
//! project-relative paths to the frontend, which re-stamps them and applies
//! the core conflict policy (clean -> silent reload, dirty -> prompt). The
//! save path re-checks independently, so a missed event can never cause an
//! overwrite.

use std::path::{Path, PathBuf};

/// Keep only project files that matter to the editor, deduplicated and sorted.
pub fn relevant_changes(root: &Path, paths: &[PathBuf]) -> Vec<String> {
    let mut out: Vec<String> = paths
        .iter()
        .filter(|p| {
            crate::fsguard::is_project_file(p)
                || p.extension().and_then(|e| e.to_str()) == Some("pdf")
        })
        .filter(|p| {
            !p.file_name()
                .map(|n| n.to_string_lossy().starts_with('.'))
                .unwrap_or(true)
        })
        .filter_map(|p| p.strip_prefix(root).ok())
        .map(|r| {
            r.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Changed style-profile files under `themes_dir`, as `themes/<name>.css`
/// config names (what the frontend reads back), deduplicated and sorted.
pub fn theme_changes(themes_dir: &Path, paths: &[PathBuf]) -> Vec<String> {
    let config = themes_dir.parent().unwrap_or(themes_dir);
    let mut out: Vec<String> = paths
        .iter()
        .filter(|p| p.parent() == Some(themes_dir))
        .filter_map(|p| p.file_name())
        .map(|n| format!("themes/{}", n.to_string_lossy()))
        .filter(|n| crate::store::config_path(config, n).is_ok())
        .collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(target_os = "macos")]
pub mod mac {
    use std::path::Path;
    use std::time::Duration;

    use notify_debouncer_mini::notify::RecursiveMode;
    use notify_debouncer_mini::{
        new_debouncer, DebounceEventResult, DebouncedEventBatch, Debouncer,
    };
    use tauri::{AppHandle, Emitter};

    use crate::error::{AppError, AppResult};

    pub type ProjectWatcher = Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

    pub const EVENT: &str = "devtex://fs-changed";
    /// Sent instead of paths when the watcher lost events.
    pub const RESCAN: &str = "*";
    pub const DEBOUNCE: Duration = Duration::from_millis(200);

    pub fn watch(app: AppHandle, root: &Path) -> AppResult<ProjectWatcher> {
        let canon = root.canonicalize()?;
        let root_for_cb = canon.clone();
        let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
            match res {
                Ok(DebouncedEventBatch::Events(events)) => {
                    let paths: Vec<_> = events.into_iter().map(|e| e.path).collect();
                    let changed = super::relevant_changes(&root_for_cb, &paths);
                    if !changed.is_empty() {
                        let _ = app.emit(EVENT, changed);
                    }
                }
                // events were missed: ask the frontend to re-stamp every open file
                Ok(_) => {
                    let _ = app.emit(EVENT, vec![RESCAN.to_string()]);
                }
                Err(_) => {}
            }
        })
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        debouncer
            .watcher()
            .watch(&canon, RecursiveMode::Recursive)
            .map_err(|e| AppError::Io {
                message: e.to_string(),
            })?;
        Ok(debouncer)
    }

    /// Event carrying the changed `themes/<name>.css` names (style-profile hot reload).
    pub const THEME_EVENT: &str = "devtex://theme-changed";

    /// Watch `<config>/themes` (created if missing) for saved style profiles.
    pub fn watch_themes(app: AppHandle, themes_dir: &Path) -> AppResult<ProjectWatcher> {
        std::fs::create_dir_all(themes_dir)?;
        let canon = themes_dir.canonicalize()?;
        let dir_for_cb = canon.clone();
        let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
            if let Ok(DebouncedEventBatch::Events(events)) = res {
                let paths: Vec<_> = events.into_iter().map(|e| e.path).collect();
                let changed = super::theme_changes(&dir_for_cb, &paths);
                if !changed.is_empty() {
                    let _ = app.emit(THEME_EVENT, changed);
                }
            }
        })
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        debouncer
            .watcher()
            .watch(&canon, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::Io {
                message: e.to_string(),
            })?;
        Ok(debouncer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_and_relativizes_changes() {
        let root = Path::new("/v/paper");
        let paths = vec![
            PathBuf::from("/v/paper/main.tex"),
            PathBuf::from("/v/paper/ch/one.tex"),
            PathBuf::from("/v/paper/ch/one.tex"),
            PathBuf::from("/v/paper/.main.tex.devtex-tmp"),
            PathBuf::from("/v/paper/notes.md"),
            PathBuf::from("/v/paper/main.pdf"),
            PathBuf::from("/elsewhere/x.tex"),
        ];
        assert_eq!(
            relevant_changes(root, &paths),
            vec!["ch/one.tex", "main.pdf", "main.tex"]
        );
    }

    #[test]
    fn theme_changes_keep_only_profile_files() {
        let dir = Path::new("/c/DevTex/themes");
        let paths = vec![
            PathBuf::from("/c/DevTex/themes/Paper Light.css"),
            PathBuf::from("/c/DevTex/themes/Paper Light.css"),
            PathBuf::from("/c/DevTex/themes/user.css"),
            PathBuf::from("/c/DevTex/themes/.Paper Light.css.devtex-tmp"),
            PathBuf::from("/c/DevTex/themes/notes.txt"),
            PathBuf::from("/c/DevTex/settings.jsonc"),
            PathBuf::from("/c/DevTex/themes/sub/x.css"),
        ];
        assert_eq!(
            theme_changes(dir, &paths),
            vec!["themes/Paper Light.css", "themes/user.css"]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn debounce_is_200ms() {
        assert_eq!(mac::DEBOUNCE.as_millis(), 200);
    }
}
