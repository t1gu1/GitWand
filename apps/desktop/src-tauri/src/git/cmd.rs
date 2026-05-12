use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// Windows-only: `creation_flags` is an inherent method added by the
// `CommandExt` trait. Without this `use`, `cmd.creation_flags(...)` at
// `hidden_cmd` below would fail to compile on Windows, defeating the
// CREATE_NO_WINDOW flag and causing visible console windows to flash
// for every spawned subprocess (see issue #6).
//
// This `use` was historically at the top of `lib.rs`. The §3.4 split
// moved `hidden_cmd` into this module but the trait import didn't
// follow — re-imported here so it's collocated with the call site.
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Ensure `rel_path`, resolved under `cwd`, stays inside the canonical `cwd`.
///
/// Rejects empty paths, absolute `rel_path` that would escape the root,
/// and any resolution that lands outside `cwd` (defense against `..` traversal
/// and symlink escapes).
pub(crate) fn safe_repo_path(cwd: &str, rel_path: &str) -> Result<PathBuf, String> {
    if cwd.trim().is_empty() {
        return Err("cwd must not be empty".to_string());
    }
    if rel_path.trim().is_empty() {
        return Err("path must not be empty".to_string());
    }

    let cwd_path = Path::new(cwd);
    if !cwd_path.is_absolute() {
        return Err(format!("cwd must be absolute (got: {})", cwd));
    }

    let cwd_canonical = cwd_path
        .canonicalize()
        .map_err(|e| format!("cwd does not resolve: {}", e))?;

    let joined = cwd_canonical.join(rel_path);

    let resolved = match joined.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = joined.parent().ok_or("path has no parent")?;
            let parent_canonical = parent
                .canonicalize()
                .map_err(|e| format!("parent path does not resolve: {}", e))?;
            let file_name = joined.file_name().ok_or("path has no file name")?;
            parent_canonical.join(file_name)
        }
    };

    if !resolved.starts_with(&cwd_canonical) {
        return Err(format!(
            "path escapes cwd (resolved: {}, cwd: {})",
            resolved.display(),
            cwd_canonical.display()
        ));
    }

    Ok(resolved)
}

pub(crate) static GIT_BINARY: OnceLock<Mutex<String>> = OnceLock::new();

pub(crate) fn git_binary() -> String {
    GIT_BINARY
        .get_or_init(|| Mutex::new("git".to_string()))
        .lock()
        .unwrap()
        .clone()
}

/// Builds a `Command` for any binary with CREATE_NO_WINDOW on Windows.
/// Prevents black CMD console windows from flashing when spawning child processes.
///
/// On macOS the app launched from Finder/Dock inherits a minimal PATH
/// (/usr/bin:/bin:/usr/sbin:/sbin) that does not include Homebrew.
/// We extend PATH with the common Homebrew prefixes so that tools like
/// `gh`, `git` (custom path), `claude`, `codex`, etc. are resolvable.
pub(crate) fn hidden_cmd(bin: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(bin);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(crate::types::CREATE_NO_WINDOW);
    #[cfg(target_os = "macos")]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extras = ["/opt/homebrew/bin", "/opt/homebrew/sbin",
                      "/usr/local/bin", "/usr/local/sbin",
                      "/opt/local/bin"];
        let mut enriched = current_path.clone();
        for extra in extras {
            if !current_path.split(':').any(|p| p == extra) {
                enriched.push(':');
                enriched.push_str(extra);
            }
        }
        cmd.env("PATH", enriched);
    }
    // Defensive: propagate auth tokens explicitly to every subprocess so
    // `gh` (and any other CLI that respects these env vars) bypasses the
    // macOS keychain helper, which hangs ≥30s when called from a signed
    // Tauri app due to per-binary ACL trust differences vs the user's
    // terminal. Shell-env preload in `shell_env.rs` populates `GH_TOKEN`
    // at app startup. `Command::new` already inherits the parent env
    // by default, but explicit propagation makes it survive any future
    // `env_clear()` or tokio-runtime peculiarity.
    if let Ok(tok) = std::env::var("GH_TOKEN") {
        cmd.env("GH_TOKEN", tok);
    }
    if let Ok(tok) = std::env::var("GITHUB_TOKEN") {
        cmd.env("GITHUB_TOKEN", tok);
    }
    cmd
}

/// Builds a `Command` for the configured Git binary (no console window on Windows).
pub(crate) fn git_cmd() -> std::process::Command {
    hidden_cmd(&git_binary())
}

/// Returns the list of files that differ between two revs (names only).
/// Shared between `commands::read::preview_merge` and the rebase preview in
/// `commands::ops::*`.
pub(crate) fn git_changed_files(git: &str, cwd: &str, base: &str, rev: &str) -> Result<Vec<String>, String> {
    let out = hidden_cmd(git)
        .args(["diff", "--name-only", base, rev])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("diff --name-only failed: {}", e))?;

    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.to_string())
        .collect())
}

static GIT_DIR_CACHE: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

/// Resolve the `.git` directory for a given cwd, with caching (P2.3).
/// Handles worktrees (where `.git` is a file pointing elsewhere) via the
/// authoritative `git rev-parse --git-dir`.
pub(crate) fn resolve_git_dir(cwd: &str) -> Result<PathBuf, String> {
    let cache = GIT_DIR_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Some(cached) = cache.lock().unwrap().get(cwd) {
        return Ok(cached.clone());
    }

    let out = git_cmd()
        .args(["rev-parse", "--git-dir"])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("rev-parse --git-dir failed: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "rev-parse --git-dir failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let rel = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let path = if rel.starts_with('/') || (rel.len() > 2 && rel.chars().nth(1) == Some(':')) {
        PathBuf::from(&rel)
    } else {
        Path::new(cwd).join(&rel)
    };

    cache.lock().unwrap().insert(cwd.to_string(), path.clone());
    Ok(path)
}


