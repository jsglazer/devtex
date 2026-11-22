//! PDF compile on macOS via the user's TeX Live `latexmk`.
//!
//! - Arguments: `-pdf` (or the engine flag), `-synctex=1`,
//!   `-interaction=nonstopmode`, `-file-line-error`,
//!   `-outdir=~/Library/Caches/DevTex/<project-hash>/`, so aux files never
//!   enter the Obsidian Sync vault; only the final PDF is copied next to the
//!   root .tex.
//! - Finder-launched apps lack the TeX Live PATH, so the PATH is resolved once
//!   from the user's login shell and cached; latexmk is found on it.
//! - Process spawning is behind [`ProcessRunner`] so argument building, path
//!   resolution and output handling are unit-tested without TeX.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Pdflatex,
    Xelatex,
    Lualatex,
}

impl Engine {
    pub fn flag(self) -> &'static str {
        match self {
            Engine::Pdflatex => "-pdf",
            Engine::Xelatex => "-xelatex",
            Engine::Lualatex => "-lualatex",
        }
    }
}

/// latexmk argument vector (root file name relative to its folder, which is the cwd).
pub fn latexmk_args(engine: Engine, root_file_name: &str, outdir: &Path) -> Vec<String> {
    vec![
        engine.flag().to_string(),
        "-synctex=1".to_string(),
        "-interaction=nonstopmode".to_string(),
        "-file-line-error".to_string(),
        "-halt-on-error".to_string(),
        format!("-outdir={}", outdir.display()),
        root_file_name.to_string(),
    ]
}

/// `<cache>/DevTex/<first 16 hex of sha256(root path)>`.
pub fn project_cache_dir(cache_base: &Path, root_abs: &Path) -> PathBuf {
    let digest = Sha256::digest(root_abs.to_string_lossy().as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    cache_base.join("DevTex").join(hex)
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub trait ProcessRunner: Send + Sync {
    /// Run `program args…` in `cwd` with PATH set to `path_env`.
    fn run(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        path_env: &str,
    ) -> AppResult<ProcessOutput>;
    /// Run a login shell command and return stdout (used to read PATH).
    fn login_shell(&self, script: &str) -> AppResult<String>;
    fn kill_current(&self) -> AppResult<()>;
}

/// Login-shell PATH, cached for the app's lifetime.
#[derive(Default)]
pub struct PathCache {
    path: Mutex<Option<String>>,
}

const FALLBACK_PATH: &str =
    "/Library/TeX/texbin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

impl PathCache {
    pub fn get(&self, runner: &dyn ProcessRunner) -> String {
        if let Ok(guard) = self.path.lock() {
            if let Some(p) = guard.as_ref() {
                return p.clone();
            }
        }
        let resolved = runner
            .login_shell("printf '%s' \"$PATH\"")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| format!("{s}:{FALLBACK_PATH}"))
            .unwrap_or_else(|| FALLBACK_PATH.to_string());
        if let Ok(mut guard) = self.path.lock() {
            *guard = Some(resolved.clone());
        }
        resolved
    }
}

/// Find latexmk: explicit override, else first PATH entry containing it.
pub fn find_latexmk(
    override_path: Option<&str>,
    path_env: &str,
    exists: &dyn Fn(&Path) -> bool,
) -> AppResult<PathBuf> {
    if let Some(p) = override_path.filter(|p| !p.is_empty()) {
        let pb = PathBuf::from(p);
        return if exists(&pb) {
            Ok(pb)
        } else {
            Err(AppError::LatexmkNotFound)
        };
    }
    path_env
        .split(':')
        .filter(|d| !d.is_empty())
        .map(|d| Path::new(d).join("latexmk"))
        .find(|p| exists(p))
        .ok_or(AppError::LatexmkNotFound)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompileOutcome {
    pub ok: bool,
    pub exit_code: Option<i32>,
    /// Contents of `<outdir>/<root>.log` (falls back to latexmk stdout).
    pub log: String,
    /// Absolute path of the PDF copied next to the root .tex.
    pub pdf: Option<String>,
    /// Absolute path of the .synctex.gz in the cache dir.
    pub synctex: Option<String>,
    pub outdir: String,
}

/// TeX writes `\include{chapters/one}` aux files to `<outdir>/chapters/one.aux`
/// but never creates `<outdir>/chapters`, so mirror the project's (non-hidden)
/// folder tree into the outdir before compiling.
pub fn mirror_subdirs(src: &Path, outdir: &Path) -> AppResult<()> {
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in std::fs::read_dir(src.join(&rel))? {
            let entry = entry?;
            let name = entry.file_name();
            let n = name.to_string_lossy();
            if n.starts_with('.') || n == "node_modules" || !entry.file_type()?.is_dir() {
                continue;
            }
            let child = rel.join(&name);
            std::fs::create_dir_all(outdir.join(&child))?;
            stack.push(child);
        }
    }
    Ok(())
}

pub struct CompileRequest<'a> {
    pub root_abs: &'a Path,
    pub engine: Engine,
    pub cache_base: &'a Path,
    pub latexmk_override: Option<&'a str>,
}

pub fn compile(
    req: &CompileRequest<'_>,
    runner: &dyn ProcessRunner,
    paths: &PathCache,
) -> AppResult<CompileOutcome> {
    let dir = req.root_abs.parent().ok_or_else(|| AppError::Compile {
        message: "root has no folder".into(),
    })?;
    let file_name = req
        .root_abs
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Compile {
            message: "root has no file name".into(),
        })?;
    let stem = req
        .root_abs
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let outdir = project_cache_dir(req.cache_base, req.root_abs);
    std::fs::create_dir_all(&outdir)?;
    mirror_subdirs(dir, &outdir)?;
    let path_env = paths.get(runner);
    let latexmk = find_latexmk(req.latexmk_override, &path_env, &|p| p.is_file())?;
    let out = runner.run(
        &latexmk,
        &latexmk_args(req.engine, &file_name, &outdir),
        dir,
        &path_env,
    )?;

    let log = std::fs::read_to_string(outdir.join(format!("{stem}.log")))
        .unwrap_or_else(|_| format!("{}\n{}", out.stdout, out.stderr));
    let built_pdf = outdir.join(format!("{stem}.pdf"));
    let mut pdf = None;
    if built_pdf.is_file() {
        let dest = dir.join(format!("{stem}.pdf"));
        std::fs::copy(&built_pdf, &dest)?;
        pdf = Some(dest.display().to_string());
    }
    let synctex_path = outdir.join(format!("{stem}.synctex.gz"));
    let synctex = synctex_path
        .is_file()
        .then(|| synctex_path.display().to_string());
    Ok(CompileOutcome {
        ok: out.status == Some(0) && pdf.is_some(),
        exit_code: out.status,
        log,
        pdf,
        synctex,
        outdir: outdir.display().to_string(),
    })
}

/// Real process runner (macOS). Keeps the running child's pid for cancel.
#[cfg(target_os = "macos")]
#[derive(Default)]
pub struct SystemRunner {
    current: Mutex<Option<u32>>,
}

#[cfg(target_os = "macos")]
impl ProcessRunner for SystemRunner {
    fn run(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        path_env: &str,
    ) -> AppResult<ProcessOutput> {
        use std::process::{Command, Stdio};
        let child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env("PATH", path_env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Compile {
                message: e.to_string(),
            })?;
        if let Ok(mut g) = self.current.lock() {
            *g = Some(child.id());
        }
        let output = child.wait_with_output();
        if let Ok(mut g) = self.current.lock() {
            *g = None;
        }
        let output = output?;
        Ok(ProcessOutput {
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    fn login_shell(&self, script: &str) -> AppResult<String> {
        use std::process::{Command, Stdio};
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let out = Command::new(shell)
            .args(["-l", "-c", script])
            .stdin(Stdio::null())
            .output()?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn kill_current(&self) -> AppResult<()> {
        let pid = self.current.lock().ok().and_then(|g| *g);
        if let Some(pid) = pid {
            std::process::Command::new("/bin/kill")
                .args(["-TERM", &pid.to_string()])
                .status()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use tempfile::tempdir;

    /// (program, args, cwd, PATH)
    type Call = (PathBuf, Vec<String>, PathBuf, String);

    struct FakeRunner {
        shell_path: String,
        calls: StdMutex<Vec<Call>>,
        /// Files the fake latexmk "produces" in the outdir.
        produce: Vec<(&'static str, &'static str)>,
        status: i32,
        shell_calls: StdMutex<u32>,
    }

    impl ProcessRunner for FakeRunner {
        fn run(
            &self,
            program: &Path,
            args: &[String],
            cwd: &Path,
            path_env: &str,
        ) -> AppResult<ProcessOutput> {
            self.calls.lock().unwrap().push((
                program.to_path_buf(),
                args.to_vec(),
                cwd.to_path_buf(),
                path_env.to_string(),
            ));
            let outdir = args
                .iter()
                .find_map(|a| a.strip_prefix("-outdir="))
                .unwrap();
            for (name, body) in &self.produce {
                std::fs::write(Path::new(outdir).join(name), body).unwrap();
            }
            Ok(ProcessOutput {
                status: Some(self.status),
                stdout: "stdout".into(),
                stderr: String::new(),
            })
        }
        fn login_shell(&self, _script: &str) -> AppResult<String> {
            *self.shell_calls.lock().unwrap() += 1;
            Ok(self.shell_path.clone())
        }
        fn kill_current(&self) -> AppResult<()> {
            Ok(())
        }
    }

    #[test]
    fn builds_the_required_latexmk_arguments() {
        let args = latexmk_args(Engine::Pdflatex, "main.tex", Path::new("/c/DevTex/ab"));
        assert_eq!(
            args,
            vec![
                "-pdf",
                "-synctex=1",
                "-interaction=nonstopmode",
                "-file-line-error",
                "-halt-on-error",
                "-outdir=/c/DevTex/ab",
                "main.tex"
            ]
        );
        assert_eq!(
            latexmk_args(Engine::Xelatex, "m.tex", Path::new("/o"))[0],
            "-xelatex"
        );
        assert_eq!(
            latexmk_args(Engine::Lualatex, "m.tex", Path::new("/o"))[0],
            "-lualatex"
        );
    }

    #[test]
    fn cache_dir_is_stable_and_per_project() {
        let a = project_cache_dir(Path::new("/cache"), Path::new("/v/paper/main.tex"));
        let b = project_cache_dir(Path::new("/cache"), Path::new("/v/paper/main.tex"));
        let c = project_cache_dir(Path::new("/cache"), Path::new("/v/other/main.tex"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("/cache/DevTex"));
        assert_eq!(a.file_name().unwrap().len(), 16);
    }

    #[test]
    fn finds_latexmk_on_login_path_or_override() {
        let exists = |p: &Path| p == Path::new("/Library/TeX/texbin/latexmk");
        assert_eq!(
            find_latexmk(None, "/usr/bin:/Library/TeX/texbin", &exists).unwrap(),
            PathBuf::from("/Library/TeX/texbin/latexmk")
        );
        assert!(matches!(
            find_latexmk(None, "/usr/bin", &exists),
            Err(AppError::LatexmkNotFound)
        ));
        assert!(matches!(
            find_latexmk(Some("/nope/latexmk"), "/Library/TeX/texbin", &exists),
            Err(AppError::LatexmkNotFound)
        ));
    }

    #[test]
    fn login_path_is_resolved_once_and_cached() {
        let runner = FakeRunner {
            shell_path: "/custom/bin\n".into(),
            calls: StdMutex::new(vec![]),
            produce: vec![],
            status: 0,
            shell_calls: StdMutex::new(0),
        };
        let cache = PathCache::default();
        let p1 = cache.get(&runner);
        let p2 = cache.get(&runner);
        assert_eq!(p1, p2);
        assert!(p1.starts_with("/custom/bin:"));
        assert!(p1.contains("/Library/TeX/texbin"));
        assert_eq!(*runner.shell_calls.lock().unwrap(), 1);
    }

    #[test]
    fn compile_uses_cache_outdir_and_copies_only_the_pdf_next_to_root() {
        let vault = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let bin = tempdir().unwrap();
        let latexmk = bin.path().join("latexmk");
        std::fs::write(&latexmk, "#!/bin/sh\n").unwrap();
        let root = vault.path().join("main.tex");
        std::fs::write(&root, "\\documentclass{article}").unwrap();
        let runner = FakeRunner {
            shell_path: bin.path().display().to_string(),
            calls: StdMutex::new(vec![]),
            produce: vec![
                ("main.pdf", "%PDF"),
                ("main.log", "This is pdfTeX"),
                ("main.aux", "aux"),
                ("main.synctex.gz", "gz"),
            ],
            status: 0,
            shell_calls: StdMutex::new(0),
        };
        let req = CompileRequest {
            root_abs: &root,
            engine: Engine::Pdflatex,
            cache_base: cache.path(),
            latexmk_override: None,
        };
        let out = compile(&req, &runner, &PathCache::default()).unwrap();
        assert!(out.ok);
        assert_eq!(out.log, "This is pdfTeX");
        assert_eq!(
            out.pdf.as_deref(),
            Some(vault.path().join("main.pdf").display().to_string().as_str())
        );
        assert!(out
            .synctex
            .unwrap()
            .starts_with(&cache.path().display().to_string()));
        // aux files stay in the cache: the vault holds only the source and the PDF
        let mut names: Vec<_> = std::fs::read_dir(vault.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["main.pdf", "main.tex"]);
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls[0].0, latexmk);
        assert_eq!(calls[0].2, vault.path());
        assert!(calls[0].3.starts_with(&bin.path().display().to_string()));
    }

    #[test]
    fn include_subfolders_are_mirrored_into_the_outdir() {
        let proj = tempdir().unwrap();
        let out = tempdir().unwrap();
        std::fs::create_dir_all(proj.path().join("chapters/appendix")).unwrap();
        std::fs::create_dir_all(proj.path().join(".obsidian")).unwrap();
        mirror_subdirs(proj.path(), out.path()).unwrap();
        assert!(out.path().join("chapters/appendix").is_dir());
        assert!(!out.path().join(".obsidian").exists());
    }

    #[test]
    fn failed_compile_reports_log_without_pdf() {
        let vault = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let bin = tempdir().unwrap();
        std::fs::write(bin.path().join("latexmk"), "").unwrap();
        let root = vault.path().join("paper.tex");
        std::fs::write(&root, "x").unwrap();
        let runner = FakeRunner {
            shell_path: bin.path().display().to_string(),
            calls: StdMutex::new(vec![]),
            produce: vec![("paper.log", "./paper.tex:1: Undefined control sequence.")],
            status: 12,
            shell_calls: StdMutex::new(0),
        };
        let req = CompileRequest {
            root_abs: &root,
            engine: Engine::Pdflatex,
            cache_base: cache.path(),
            latexmk_override: None,
        };
        let out = compile(&req, &runner, &PathCache::default()).unwrap();
        assert!(!out.ok);
        assert_eq!(out.exit_code, Some(12));
        assert!(out.pdf.is_none());
        assert!(out.log.contains("Undefined control sequence"));
    }
}
