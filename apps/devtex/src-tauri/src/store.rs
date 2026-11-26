//! Small persistent stores in the app's own data/config folders:
//! - push state: repo path -> blob SHA DevTex last pushed (remote-change check),
//! - config files: settings.jsonc, keymap.json, toolbars.json, recent.json, syntax/*.json,
//!   themes/*.css (style profiles and user.css).
//! - secrets: the GitHub token in the Keychain under `github-papers-token`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::fsguard::{FileStore, StdFileStore};

pub fn push_state_key(owner: &str, repo: &str, branch: &str) -> String {
    format!("{owner}/{repo}:{branch}")
}

type PushState = BTreeMap<String, BTreeMap<String, String>>;

pub fn load_push_state(file: &Path) -> AppResult<PushState> {
    match StdFileStore.read(file)? {
        None => Ok(BTreeMap::new()),
        // a corrupt state file must not block pushing; the remote check then treats files as untracked
        Some(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
    }
}

pub fn record_push(file: &Path, key: &str, shas: &BTreeMap<String, String>) -> AppResult<()> {
    let mut state = load_push_state(file)?;
    let entry = state.entry(key.to_string()).or_default();
    for (p, s) in shas {
        entry.insert(p.clone(), s.clone());
    }
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(&state).map_err(|e| AppError::Io {
        message: e.to_string(),
    })?;
    StdFileStore.write_atomic(file, &json)
}

pub const CONFIG_FILES: [&str; 4] = [
    "settings.jsonc",
    "keymap.json",
    "toolbars.json",
    "recent.json",
];

/// `<stem><ext>` with a non-empty stem of `[A-Za-z0-9_.-]` (plus spaces when
/// `spaces`), not starting with `.` or a space, and no `..`.
fn safe_file_name(n: &str, ext: &str, spaces: bool) -> bool {
    n.ends_with(ext)
        && n.len() > ext.len()
        && !n.starts_with('.')
        && !n.starts_with(' ')
        && !n.contains("..")
        && n.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || (spaces && c == ' ')
        })
}

/// Resolve a config file name inside the config dir. Only the fixed names,
/// `syntax/<name>.json` and `themes/<name>.css` are allowed.
pub fn config_path(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if CONFIG_FILES.contains(&name) {
        return Ok(dir.join(name));
    }
    if let Some(n) = name.strip_prefix("syntax/") {
        if safe_file_name(n, ".json", false) {
            return Ok(dir.join("syntax").join(n));
        }
    }
    if let Some(n) = name.strip_prefix("themes/") {
        // profile names are shown in menus, so "High Contrast Dark.css" is allowed
        if safe_file_name(n, ".css", true) {
            return Ok(dir.join("themes").join(n));
        }
    }
    Err(AppError::ConfigName {
        name: name.to_string(),
    })
}

pub fn read_config(dir: &Path, name: &str) -> AppResult<Option<String>> {
    let p = config_path(dir, name)?;
    Ok(StdFileStore
        .read(&p)?
        .map(|b| String::from_utf8_lossy(&b).into_owned()))
}

pub fn write_config(dir: &Path, name: &str, content: &str) -> AppResult<()> {
    let p = config_path(dir, name)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    StdFileStore.write_atomic(&p, content.as_bytes())
}

/// `<sub>/<name><ext>` for every file in `dir/sub` whose name `config_path` accepts.
fn list_config_dir(dir: &Path, sub: &str, ext: &str) -> AppResult<Vec<String>> {
    let sdir = dir.join(sub);
    if !sdir.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = std::fs::read_dir(sdir)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(ext))
        .map(|n| format!("{sub}/{n}"))
        .filter(|n| config_path(dir, n).is_ok())
        .collect();
    out.sort();
    Ok(out)
}

pub fn list_syntax_files(dir: &Path) -> AppResult<Vec<String>> {
    list_config_dir(dir, "syntax", ".json")
}

/// user.css and any DevTex 1.0.5–1.0.6 style profiles: `themes/<name>.css`, sorted.
pub fn list_theme_files(dir: &Path) -> AppResult<Vec<String>> {
    list_config_dir(dir, "themes", ".css")
}

/// Delete a DevTex 1.0.5–1.0.6 style profile once it has moved to DevStyle.
/// Only `themes/<name>.css`, never `themes/user.css`; a missing file is fine.
pub fn delete_theme_file(dir: &Path, name: &str) -> AppResult<()> {
    if !name.starts_with("themes/") || name == "themes/user.css" {
        return Err(AppError::ConfigName {
            name: name.to_string(),
        });
    }
    let p = config_path(dir, name)?;
    match std::fs::remove_file(&p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Injectable secret storage (Keychain in the app, memory in tests).
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> AppResult<Option<String>>;
    fn set(&self, name: &str, value: &str) -> AppResult<()>;
    fn delete(&self, name: &str) -> AppResult<()>;
}

pub const TOKEN_NAME: &str = "github-papers-token";
const KEYCHAIN_ACCOUNT: &str = "DevTex";

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct Keychain;

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl SecretStore for Keychain {
    fn get(&self, name: &str) -> AppResult<Option<String>> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(name, KEYCHAIN_ACCOUNT) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(e) => Err(AppError::Keychain {
                message: e.to_string(),
            }),
        }
    }
    fn set(&self, name: &str, value: &str) -> AppResult<()> {
        security_framework::passwords::set_generic_password(
            name,
            KEYCHAIN_ACCOUNT,
            value.as_bytes(),
        )
        .map_err(|e| AppError::Keychain {
            message: e.to_string(),
        })
    }
    fn delete(&self, name: &str) -> AppResult<()> {
        match security_framework::passwords::delete_generic_password(name, KEYCHAIN_ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(AppError::Keychain {
                message: e.to_string(),
            }),
        }
    }
}

#[cfg(test)]
pub struct MemorySecrets(pub std::sync::Mutex<BTreeMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn get(&self, name: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .map_err(|_| AppError::Keychain {
                message: "poisoned".into(),
            })?
            .get(name)
            .cloned())
    }
    fn set(&self, name: &str, value: &str) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|_| AppError::Keychain {
                message: "poisoned".into(),
            })?
            .insert(name.into(), value.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|_| AppError::Keychain {
                message: "poisoned".into(),
            })?
            .remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn push_state_round_trips_and_merges() {
        let d = tempdir().unwrap();
        let f = d.path().join("data/push-state.json");
        assert!(load_push_state(&f).unwrap().is_empty());
        let k = push_state_key("o", "r", "main");
        record_push(&f, &k, &BTreeMap::from([("a.tex".into(), "1".into())])).unwrap();
        record_push(
            &f,
            &k,
            &BTreeMap::from([("b.tex".into(), "2".into()), ("a.tex".into(), "3".into())]),
        )
        .unwrap();
        let s = load_push_state(&f).unwrap();
        assert_eq!(
            s[&k],
            BTreeMap::from([("a.tex".into(), "3".into()), ("b.tex".into(), "2".into())])
        );
    }

    #[test]
    fn corrupt_push_state_is_treated_as_empty() {
        let d = tempdir().unwrap();
        let f = d.path().join("push-state.json");
        std::fs::write(&f, "{not json").unwrap();
        assert!(load_push_state(&f).unwrap().is_empty());
    }

    #[test]
    fn config_names_are_whitelisted() {
        let d = tempdir().unwrap();
        assert!(config_path(d.path(), "settings.jsonc").is_ok());
        assert!(config_path(d.path(), "recent.json").is_ok());
        assert!(config_path(d.path(), "syntax/r-code.json").is_ok());
        for bad in [
            "../x",
            "syntax/../../x.json",
            "syntax/.json",
            "other.json",
            "syntax/a/b.json",
            "/etc/passwd",
        ] {
            assert!(
                matches!(config_path(d.path(), bad), Err(AppError::ConfigName { .. })),
                "{bad}"
            );
        }
    }

    #[test]
    fn theme_paths_allow_profile_names_and_reject_escapes() {
        let d = tempdir().unwrap();
        for ok in [
            "themes/Default Light.css",
            "themes/High Contrast Dark.css",
            "themes/user.css",
            "themes/my_theme-2.css",
        ] {
            assert_eq!(
                config_path(d.path(), ok).unwrap(),
                d.path().join(ok),
                "{ok}"
            );
        }
        for bad in [
            "themes/../settings.jsonc",
            "themes/../../x.css",
            "themes/.css",
            "themes/.hidden.css",
            "themes/ lead.css",
            "themes/a/b.css",
            "themes/x.json",
            "themes/x.css/",
            "themes/a\\b.css",
            "themes/x;y.css",
            "syntax/with space.json",
            "theme/x.css",
        ] {
            assert!(
                matches!(config_path(d.path(), bad), Err(AppError::ConfigName { .. })),
                "{bad}"
            );
        }
    }

    #[test]
    fn theme_files_are_listed_sorted_and_filtered() {
        let d = tempdir().unwrap();
        assert!(list_theme_files(d.path()).unwrap().is_empty());
        write_config(d.path(), "themes/Paper Light.css", ":root{}").unwrap();
        write_config(d.path(), "themes/Default Dark.css", ":root{}").unwrap();
        write_config(d.path(), "themes/user.css", "").unwrap();
        std::fs::write(d.path().join("themes/.DS_Store"), "x").unwrap();
        std::fs::write(d.path().join("themes/notes.txt"), "x").unwrap();
        std::fs::write(d.path().join("themes/.hidden.css"), "x").unwrap();
        assert_eq!(
            list_theme_files(d.path()).unwrap(),
            vec![
                "themes/Default Dark.css",
                "themes/Paper Light.css",
                "themes/user.css"
            ]
        );
        assert_eq!(
            read_config(d.path(), "themes/Paper Light.css")
                .unwrap()
                .as_deref(),
            Some(":root{}")
        );
    }

    #[test]
    fn config_files_read_write_and_list() {
        let d = tempdir().unwrap();
        assert_eq!(read_config(d.path(), "keymap.json").unwrap(), None);
        write_config(d.path(), "keymap.json", "[]").unwrap();
        write_config(d.path(), "syntax/b.json", "{}").unwrap();
        write_config(d.path(), "syntax/a.json", "{}").unwrap();
        assert_eq!(
            read_config(d.path(), "keymap.json").unwrap().as_deref(),
            Some("[]")
        );
        assert_eq!(
            list_syntax_files(d.path()).unwrap(),
            vec!["syntax/a.json", "syntax/b.json"]
        );
    }

    #[test]
    fn memory_secrets() {
        let s = MemorySecrets(std::sync::Mutex::new(BTreeMap::new()));
        assert_eq!(s.get(TOKEN_NAME).unwrap(), None);
        s.set(TOKEN_NAME, "t").unwrap();
        assert_eq!(s.get(TOKEN_NAME).unwrap().as_deref(), Some("t"));
        s.delete(TOKEN_NAME).unwrap();
        assert_eq!(s.get(TOKEN_NAME).unwrap(), None);
    }

    #[test]
    fn delete_theme_file_removes_old_profiles_only() {
        let d = tempdir().unwrap();
        write_config(d.path(), "themes/Paper Dark.css", "x").unwrap();
        write_config(d.path(), "themes/user.css", "u").unwrap();
        delete_theme_file(d.path(), "themes/Paper Dark.css").unwrap();
        assert!(!d.path().join("themes/Paper Dark.css").exists());
        // already gone is fine
        delete_theme_file(d.path(), "themes/Paper Dark.css").unwrap();
        for bad in [
            "themes/user.css",
            "settings.jsonc",
            "syntax/r.json",
            "themes/../settings.jsonc",
            "/etc/passwd",
        ] {
            assert!(delete_theme_file(d.path(), bad).is_err(), "{bad}");
        }
        assert!(d.path().join("themes/user.css").exists());
    }
}
