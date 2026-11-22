//! Guarded file I/O for shared .tex files.
//!
//! Every save goes through [`save_guarded`], which re-reads the file's
//! current mtime and SHA-256 and refuses to write ([`AppError::Conflict`])
//! unless the content hash still equals the stamp the editor last read. A
//! changed mtime with an identical hash (touch, sync metadata) is not a
//! conflict, since no external content would be lost. Writes are atomic
//! (temp file + rename in the same folder).
//!
//! The [`FileStore`] trait is the injectable I/O boundary: macOS uses
//! [`StdFileStore`]; iOS uses a store whose reads/writes go through
//! NSFileCoordinator (tauri-plugin-ios-bookmarks).

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub mtime_ms: f64,
    /// Lower-case hex SHA-256 of the file bytes.
    pub hash: String,
}

pub trait FileStore: Send + Sync {
    /// `Ok(None)` when the file does not exist.
    fn read(&self, path: &Path) -> AppResult<Option<Vec<u8>>>;
    fn mtime_ms(&self, path: &Path) -> AppResult<Option<f64>>;
    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> AppResult<()>;
    fn list(&self, root: &Path) -> AppResult<Vec<PathBuf>>;
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut s = String::with_capacity(64);
    for b in digest.iter() {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub fn stamp_of(store: &dyn FileStore, path: &Path) -> AppResult<Option<FileStamp>> {
    let Some(bytes) = store.read(path)? else {
        return Ok(None);
    };
    let mtime_ms = store.mtime_ms(path)?.unwrap_or(0.0);
    Ok(Some(FileStamp {
        mtime_ms,
        hash: sha256_hex(&bytes),
    }))
}

pub fn read_text(store: &dyn FileStore, path: &Path) -> AppResult<(String, FileStamp)> {
    let Some(bytes) = store.read(path)? else {
        return Err(AppError::NotFound {
            path: path.display().to_string(),
        });
    };
    let mtime_ms = store.mtime_ms(path)?.unwrap_or(0.0);
    let stamp = FileStamp {
        mtime_ms,
        hash: sha256_hex(&bytes),
    };
    Ok((String::from_utf8_lossy(&bytes).into_owned(), stamp))
}

/// Write `content` only if the file still matches `expected` (None = must not exist).
pub fn save_guarded(
    store: &dyn FileStore,
    path: &Path,
    content: &str,
    expected: Option<&FileStamp>,
) -> AppResult<FileStamp> {
    let current = stamp_of(store, path)?;
    let unchanged = match (expected, current.as_ref()) {
        (None, None) => true,
        (Some(e), Some(c)) => e.hash == c.hash,
        _ => false,
    };
    if !unchanged {
        return Err(AppError::Conflict {
            path: path.display().to_string(),
            disk: current,
        });
    }
    store.write_atomic(path, content.as_bytes())?;
    stamp_of(store, path)?.ok_or_else(|| AppError::Io {
        message: format!("{} vanished after write", path.display()),
    })
}

/// std::fs implementation (macOS, tests).
pub struct StdFileStore;

impl FileStore for StdFileStore {
    fn read(&self, path: &Path) -> AppResult<Option<Vec<u8>>> {
        match fs::read(path) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn mtime_ms(&self, path: &Path) -> AppResult<Option<f64>> {
        match fs::metadata(path) {
            Ok(m) => {
                let t = m.modified()?;
                let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
                Ok(Some(d.as_secs_f64() * 1000.0))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        let dir = path.parent().ok_or_else(|| AppError::Io {
            message: format!("{} has no parent folder", path.display()),
        })?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tmp = dir.join(format!(".{name}.devtex-tmp"));
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, path)?;
        Ok(())
    }

    fn list(&self, root: &Path) -> AppResult<Vec<PathBuf>> {
        let mut out = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || name == "node_modules" {
                    continue;
                }
                let ft = entry.file_type()?;
                if ft.is_dir() {
                    stack.push(p);
                } else if ft.is_file() && is_project_file(&p) {
                    out.push(p);
                }
            }
        }
        out.sort();
        Ok(out)
    }
}

pub fn is_project_file(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()),
        Some("tex") | Some("bib") | Some("sty") | Some("cls")
    )
}

/// The user-chosen project folder; every path from the frontend is resolved
/// through it and rejected if it escapes.
#[derive(Debug, Clone)]
pub struct ProjectScope {
    root: PathBuf,
}

impl ProjectScope {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        let root = root.canonicalize()?;
        if !root.is_dir() {
            return Err(AppError::NotFound {
                path: root.display().to_string(),
            });
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a project-relative POSIX path. Rejects absolute paths and `..`
    /// escapes; resolves symlinks of existing parents and re-checks containment.
    pub fn resolve(&self, rel: &str) -> AppResult<PathBuf> {
        let outside = || AppError::OutsideProject {
            path: rel.to_string(),
        };
        let p = Path::new(rel);
        if p.is_absolute() {
            return Err(outside());
        }
        let mut out = self.root.clone();
        for c in p.components() {
            match c {
                Component::Normal(s) => out.push(s),
                Component::CurDir => {}
                _ => return Err(outside()),
            }
        }
        // canonicalize the deepest existing ancestor to catch symlinks out of the root
        let mut probe = out.clone();
        while !probe.exists() {
            if !probe.pop() {
                return Err(outside());
            }
        }
        let canon = probe.canonicalize()?;
        if !canon.starts_with(&self.root) {
            return Err(outside());
        }
        Ok(out)
    }

    /// Project-relative POSIX path for an absolute path inside the root.
    pub fn relative(&self, abs: &Path) -> Option<String> {
        let rel = abs.strip_prefix(&self.root).ok()?;
        let parts: Vec<String> = rel
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect();
        Some(parts.join("/"))
    }
}

/// Folder containing `.obsidian` at or above `start` (the vault root), if any.
pub fn find_vault_root(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        if dir.join(".obsidian").is_dir() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write(p: &Path, s: &str) {
        fs::write(p, s).unwrap();
    }

    #[test]
    fn read_returns_text_and_stamp() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        write(&f, "hello");
        let (text, stamp) = read_text(&StdFileStore, &f).unwrap();
        assert_eq!(text, "hello");
        assert_eq!(stamp.hash, sha256_hex(b"hello"));
        assert!(stamp.mtime_ms > 0.0);
    }

    #[test]
    fn save_succeeds_when_disk_matches_last_read() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        write(&f, "v1");
        let (_, s1) = read_text(&StdFileStore, &f).unwrap();
        let s2 = save_guarded(&StdFileStore, &f, "v2", Some(&s1)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "v2");
        assert_eq!(s2.hash, sha256_hex(b"v2"));
        // the new stamp allows the next save
        save_guarded(&StdFileStore, &f, "v3", Some(&s2)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "v3");
    }

    #[test]
    fn external_edit_is_detected_and_never_overwritten() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        write(&f, "original");
        let (_, stamp) = read_text(&StdFileStore, &f).unwrap();
        // Obsidian (or Obsidian Sync) writes the file
        write(&f, "edited in obsidian");
        let err = save_guarded(&StdFileStore, &f, "mine", Some(&stamp)).unwrap_err();
        match err {
            AppError::Conflict {
                disk: Some(disk), ..
            } => {
                assert_eq!(disk.hash, sha256_hex(b"edited in obsidian"))
            }
            other => panic!("expected conflict, got {other:?}"),
        }
        assert_eq!(fs::read_to_string(&f).unwrap(), "edited in obsidian");
    }

    #[test]
    fn touch_without_content_change_is_not_a_conflict() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        write(&f, "same");
        let (_, mut stamp) = read_text(&StdFileStore, &f).unwrap();
        stamp.mtime_ms -= 10_000.0; // simulate a newer mtime on disk
        save_guarded(&StdFileStore, &f, "next", Some(&stamp)).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "next");
    }

    #[test]
    fn deleted_or_created_files_conflict() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        write(&f, "x");
        let (_, stamp) = read_text(&StdFileStore, &f).unwrap();
        fs::remove_file(&f).unwrap();
        assert!(matches!(
            save_guarded(&StdFileStore, &f, "y", Some(&stamp)),
            Err(AppError::Conflict { disk: None, .. })
        ));
        // creating a new file requires that it still does not exist
        save_guarded(&StdFileStore, &f, "new", None).unwrap();
        assert!(matches!(
            save_guarded(&StdFileStore, &f, "again", None),
            Err(AppError::Conflict { disk: Some(_), .. })
        ));
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let d = tempdir().unwrap();
        let f = d.path().join("a.tex");
        save_guarded(&StdFileStore, &f, "x", None).unwrap();
        let names: Vec<_> = fs::read_dir(d.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("a.tex")]);
    }

    #[test]
    fn scope_rejects_escapes_and_symlinks_out() {
        let d = tempdir().unwrap();
        let root = d.path().join("proj");
        fs::create_dir_all(root.join("chapters")).unwrap();
        let outside = d.path().join("secret.tex");
        write(&outside, "s");
        let scope = ProjectScope::new(root.clone()).unwrap();
        assert!(scope.resolve("chapters/one.tex").is_ok());
        assert!(scope.resolve("./main.tex").is_ok());
        assert!(matches!(
            scope.resolve("../secret.tex"),
            Err(AppError::OutsideProject { .. })
        ));
        assert!(matches!(
            scope.resolve("/etc/passwd"),
            Err(AppError::OutsideProject { .. })
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.path(), root.join("link")).unwrap();
            assert!(matches!(
                scope.resolve("link/secret.tex"),
                Err(AppError::OutsideProject { .. })
            ));
        }
        let abs = scope.resolve("chapters/one.tex").unwrap();
        assert_eq!(scope.relative(&abs).as_deref(), Some("chapters/one.tex"));
    }

    #[test]
    fn lists_project_files_skipping_hidden_dirs() {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join("ch")).unwrap();
        fs::create_dir_all(d.path().join(".obsidian")).unwrap();
        write(&d.path().join("main.tex"), "");
        write(&d.path().join("refs.bib"), "");
        write(&d.path().join("ch/one.tex"), "");
        write(&d.path().join("notes.md"), "");
        write(&d.path().join(".obsidian/x.tex"), "");
        let files = StdFileStore.list(d.path()).unwrap();
        let names: Vec<_> = files
            .iter()
            .map(|p| {
                p.strip_prefix(d.path())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["ch/one.tex", "main.tex", "refs.bib"]);
    }

    #[test]
    fn finds_vault_root() {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join("vault/.obsidian")).unwrap();
        fs::create_dir_all(d.path().join("vault/Research/paper")).unwrap();
        let root = find_vault_root(&d.path().join("vault/Research/paper")).unwrap();
        assert_eq!(root, d.path().join("vault"));
        assert!(find_vault_root(d.path()).is_none());
    }
}
