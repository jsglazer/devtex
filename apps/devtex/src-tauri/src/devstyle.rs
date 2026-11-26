//! DevStyle's shared folder (https://github.com/jsglazer/devstyle): the style
//! profiles every app reads, in the App Group container
//! `~/Library/Group Containers/PWGXN26URQ.com.jsglazer.devstyle/DevStyle/`.
//!
//! The frontend reaches it only through these functions, which accept exactly
//! two kinds of path relative to the folder: `devstyle.json` and
//! `profiles/<id>.css` with a DevStyle id (`[a-z0-9-]`, 1–64 characters). No
//! `..`, no absolute paths, nothing else in the container.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::fsguard::{FileStore, StdFileStore};

pub const GROUP_ID: &str = "PWGXN26URQ.com.jsglazer.devstyle";
pub const FOLDER_NAME: &str = "DevStyle";
pub const CONFIG_FILE: &str = "devstyle.json";
pub const PROFILES_DIR: &str = "profiles";
/// Profiles are small text files; anything bigger is refused.
pub const MAX_BYTES: usize = 512 * 1024;

/// The shared folder for a user's home directory.
pub fn folder(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Group Containers")
        .join(GROUP_ID)
        .join(FOLDER_NAME)
}

/// A DevStyle profile id.
pub fn is_profile_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn bad(path: &str) -> AppError {
    AppError::ConfigName {
        name: format!("DevStyle: {path}"),
    }
}

/// Resolve a path inside the shared folder; only `devstyle.json` and `profiles/<id>.css`.
pub fn resolve(root: &Path, rel: &str) -> AppResult<PathBuf> {
    if rel == CONFIG_FILE {
        return Ok(root.join(CONFIG_FILE));
    }
    if let Some(file) = rel.strip_prefix("profiles/") {
        if let Some(id) = file.strip_suffix(".css") {
            if is_profile_id(id) {
                return Ok(root.join(PROFILES_DIR).join(file));
            }
        }
    }
    Err(bad(rel))
}

pub fn read(root: &Path, rel: &str) -> AppResult<Option<String>> {
    let p = resolve(root, rel)?;
    Ok(StdFileStore
        .read(&p)?
        .map(|b| String::from_utf8_lossy(&b).into_owned()))
}

/// Atomic write (temp file + rename), so other apps never see half a profile.
pub fn write(root: &Path, rel: &str, text: &str) -> AppResult<()> {
    let p = resolve(root, rel)?;
    if text.len() > MAX_BYTES {
        return Err(AppError::Io {
            message: format!("DevStyle {rel}: larger than {MAX_BYTES} bytes"),
        });
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    StdFileStore.write_atomic(&p, text.as_bytes())
}

/// File names in `profiles/` that `resolve` accepts, sorted; `[]` when it does not exist.
pub fn list(root: &Path, dir: &str) -> AppResult<Vec<String>> {
    if dir != PROFILES_DIR {
        return Err(bad(dir));
    }
    let d = root.join(PROFILES_DIR);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = std::fs::read_dir(d)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| resolve(root, &format!("{PROFILES_DIR}/{n}")).is_ok())
        .collect();
    out.sort();
    Ok(out)
}

/// True when a changed path is something DevTex shows (devstyle.json or a profile).
pub fn is_relevant_change(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let rel = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    resolve(root, &rel).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn folder_is_the_app_group_container() {
        assert_eq!(
            folder(Path::new("/Users/me")),
            PathBuf::from(
                "/Users/me/Library/Group Containers/PWGXN26URQ.com.jsglazer.devstyle/DevStyle"
            )
        );
    }

    #[test]
    fn allows_only_the_config_and_profiles() {
        let root = Path::new("/r");
        assert_eq!(
            resolve(root, "devstyle.json").ok(),
            Some(root.join("devstyle.json"))
        );
        assert_eq!(
            resolve(root, "profiles/paper-dark.css").ok(),
            Some(root.join("profiles").join("paper-dark.css"))
        );
        for bad in [
            "",
            "/etc/passwd",
            "../x.css",
            "profiles/../devstyle.json",
            "profiles/../../x.css",
            "profiles/Paper Dark.css",
            "profiles/.hidden.css",
            "profiles/x.txt",
            "profiles/a/b.css",
            "profiles/.css",
            "other.json",
            "profiles/x.css/..",
        ] {
            assert!(resolve(root, bad).is_err(), "{bad}");
        }
        let long = format!("profiles/{}.css", "a".repeat(65));
        assert!(resolve(root, &long).is_err());
    }

    #[test]
    fn read_write_list_round_trip() {
        let d = tempdir().unwrap();
        let root = d.path().join("DevStyle");
        assert_eq!(read(&root, "devstyle.json").unwrap(), None);
        assert_eq!(list(&root, "profiles").unwrap(), Vec::<String>::new());
        write(&root, "profiles/b-light.css", "b").unwrap();
        write(&root, "profiles/a-dark.css", "a").unwrap();
        write(&root, "devstyle.json", "{}").unwrap();
        std::fs::write(root.join("profiles").join("Junk File.css"), "x").unwrap();
        std::fs::write(root.join("profiles").join("notes.txt"), "x").unwrap();
        assert_eq!(
            read(&root, "profiles/a-dark.css").unwrap(),
            Some("a".into())
        );
        assert_eq!(
            list(&root, "profiles").unwrap(),
            vec!["a-dark.css", "b-light.css"]
        );
        assert!(list(&root, "..").is_err());
        assert!(write(&root, "../escape.css", "x").is_err());
        assert!(write(&root, "profiles/big.css", &"x".repeat(MAX_BYTES + 1)).is_err());
        assert!(!d.path().join("escape.css").exists());
    }

    #[test]
    fn relevant_changes_are_config_and_profiles() {
        let root = Path::new("/r/DevStyle");
        assert!(is_relevant_change(root, &root.join("devstyle.json")));
        assert!(is_relevant_change(
            root,
            &root.join("profiles/paper-dark.css")
        ));
        assert!(!is_relevant_change(
            root,
            &root.join("profiles/.paper-dark.css.tmp")
        ));
        assert!(!is_relevant_change(root, &root.join("other.txt")));
        assert!(!is_relevant_change(
            root,
            Path::new("/elsewhere/devstyle.json")
        ));
    }
}
