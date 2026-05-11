pub(crate) mod git;
pub(crate) mod types;
pub(crate) mod commands;

pub(crate) use crate::types::*;
pub(crate) use crate::git::*;

use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// GitWand Desktop — Tauri backend
///
/// Most of the resolution logic runs in the frontend via @gitwand/core (TypeScript).
/// This Rust backend handles:
/// - Native file system access (reading conflicted files, browsing directories)
/// - Git command execution
/// - Window management
///
/// ─── Trust boundaries ──────────────────────────────────────
///
/// Tauri commands live on a trust boundary: inputs come from the webview,
/// where they may originate from untrusted repo content (READMEs, PR bodies,
/// file names). Categories of commands and their security invariants:
///
/// 1. **Filesystem read/write** (`read_file`, `write_file`, `list_dir`):
///    - Paths are constrained under an explicit `cwd` root via `safe_repo_path`.
///    - No `..` segments may escape the root.
///
/// 2. **Git command execution** (`get_conflicted_files`, diff/log/status, etc.):
///    - Arguments are passed mechanically via `.arg()` — never interpolated
///      into a shell string. Safe by construction against command injection.
///    - `cwd` is used as `.current_dir()` for the process, so the git binary
///      itself confines filesystem access to the repo.
///
/// 3. **External CLI execution** (`gh`, `claude`, editor): same rules as (2).
///    `claude` runs with API-key env vars stripped to force the OAuth session.
///
/// 4. **Window / IPC events**: trusted frontend-only surface.
///
/// When adding a new command, classify it against one of these categories and
/// reuse the helpers below.

// ─── Git status ───────────────────────────────────────────

// ─── git_status — libgit2 fast path with CLI fallback (P3.3b) ───────────────
//
// The user-facing Tauri command tries the libgit2 implementation first
// (avoids 1-3 git subprocess spawns per call — `git status` was the
// 2-second poll's hottest IPC). On any libgit2 error it falls back to
// the CLI parser, which remains the parity-test reference.
//
// Robustness: libgit2 occasionally chokes on edge-case repo layouts
// (partial clones, exotic submodule configs, malformed configs). The
// fallback ensures we never regress vs. the v2.8 baseline.

#[tauri::command]
fn git_status(cwd: String) -> Result<GitStatus, String> {
    match git_status_libgit2(&cwd) {
        Ok(s) => Ok(s),
        Err(e) => {
            // Soft-fail: log but keep going. Don't surface libgit2 errors
            // to the UI when CLI works.
            eprintln!("[git_status] libgit2 fast path failed ({}); falling back to CLI", e);
            git_status_cli(cwd)
        }
    }
}

/// libgit2 implementation of git_status. Mirrors the GitStatus shape that
/// `git_status_cli` produces from `git status --porcelain=v2 --branch`.
///
/// What it covers in-process:
///   - Current branch (HEAD shorthand)
///   - Upstream tracking branch (`origin/main` etc.)
///   - Ahead/behind via `repo.graph_ahead_behind`
///   - Staged / unstaged / untracked / conflicted file lists with
///     rename detection enabled to match porcelain v2 behavior
///
/// What it delegates to git CLI:
///   - Push remote detection (`@{push}`) and ahead-of-push count.
///     This is a rare path (only fires when a triangular workflow is
///     configured) and `@{push}` syntax is git-CLI-only — libgit2 has
///     no direct equivalent. Calling git here for the few users with
///     triangular setups is acceptable; the common case is unaffected.
fn git_status_libgit2(cwd: &str) -> Result<GitStatus, String> {
    let repo = git2::Repository::open(cwd)
        .map_err(|e| format!("git2 open: {}", e))?;

    // ── Branch + upstream + ahead/behind ────────────────────────────────
    let (branch, ahead, behind, remote) = libgit2_branch_status(&repo);

    // ── File status buckets ─────────────────────────────────────────────
    let (staged, unstaged, untracked, conflicted) = libgit2_file_statuses(&repo)?;

    // ── Push remote (triangular workflow) — CLI fallback ────────────────
    let (push_remote, ahead_push) =
        compute_push_remote_via_cli(cwd, remote.as_deref());

    Ok(GitStatus {
        branch,
        remote,
        ahead,
        behind,
        push_remote,
        ahead_push,
        staged,
        unstaged,
        untracked,
        conflicted,
    })
}

/// Branch shorthand + ahead/behind + upstream name (e.g. "origin/main").
/// Returns ("unknown", 0, 0, None) on any failure path so the caller can
/// still produce a valid GitStatus.
fn libgit2_branch_status(repo: &git2::Repository) -> (String, i32, i32, Option<String>) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (String::from("unknown"), 0, 0, None),
    };
    let branch = head.shorthand().unwrap_or("").to_string();
    let local_oid = match head.target() {
        Some(o) => o,
        None => return (branch, 0, 0, None),
    };
    // Detached HEAD (or shorthand resolves to "HEAD") → no local branch object,
    // therefore no upstream. CLI returns the same in that case.
    let local_branch = match repo.find_branch(&branch, git2::BranchType::Local) {
        Ok(b) => b,
        Err(_) => return (branch, 0, 0, None),
    };
    let upstream = match local_branch.upstream() {
        Ok(u) => u,
        Err(_) => return (branch, 0, 0, None), // no upstream configured
    };
    // upstream.name() returns Result<Option<&str>>: None when the ref name
    // is non-UTF-8 (extremely rare). Keep ahead/behind=0 in that case.
    let upstream_name = upstream
        .name()
        .ok()
        .flatten()
        .map(|s| s.to_string());
    let upstream_oid = match upstream.get().target() {
        Some(o) => o,
        None => return (branch, 0, 0, upstream_name),
    };
    let (a, b) = match repo.graph_ahead_behind(local_oid, upstream_oid) {
        Ok(pair) => pair,
        Err(_) => return (branch, 0, 0, upstream_name),
    };
    (branch, a as i32, b as i32, upstream_name)
}

/// Build (staged, unstaged, untracked, conflicted) from `repo.statuses()`.
/// Mirrors the porcelain v2 logic in `git_status_cli`: a single file with
/// both index and worktree changes appears in BOTH `staged` and `unstaged`.
fn libgit2_file_statuses(
    repo: &git2::Repository,
) -> Result<(Vec<FileChange>, Vec<FileChange>, Vec<String>, Vec<String>), String> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .renames_from_rewrites(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("git2 statuses: {}", e))?;

    let mut staged: Vec<FileChange> = Vec::new();
    let mut unstaged: Vec<FileChange> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    let mut conflicted: Vec<String> = Vec::new();

    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }

        // Conflicted is mutually exclusive with the other buckets in the CLI
        // output (porcelain v2 emits `u` lines that the CLI parser routes to
        // `conflicted`, never to staged/unstaged).
        if s.contains(git2::Status::CONFLICTED) {
            conflicted.push(path);
            continue;
        }

        if s.contains(git2::Status::WT_NEW) {
            // Untracked. CLI also uses a separate bucket here.
            untracked.push(path);
            continue;
        }

        // Index (staged) side — pick the most specific status, with the same
        // priority order the CLI parser applies:
        //   A > M > D > R > TypeChange (mapped to "modified")
        let staged_kind = if s.contains(git2::Status::INDEX_NEW) {
            Some("added")
        } else if s.contains(git2::Status::INDEX_MODIFIED) {
            Some("modified")
        } else if s.contains(git2::Status::INDEX_DELETED) {
            Some("deleted")
        } else if s.contains(git2::Status::INDEX_RENAMED) {
            Some("renamed")
        } else if s.contains(git2::Status::INDEX_TYPECHANGE) {
            Some("modified")
        } else {
            None
        };

        if let Some(kind) = staged_kind {
            let old_path = if kind == "renamed" {
                entry
                    .head_to_index()
                    .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().to_string()))
            } else {
                None
            };
            staged.push(FileChange {
                path: path.clone(),
                status: kind.to_string(),
                old_path,
            });
        }

        // Worktree (unstaged) side — same priority logic.
        let unstaged_kind = if s.contains(git2::Status::WT_MODIFIED) {
            Some("modified")
        } else if s.contains(git2::Status::WT_DELETED) {
            Some("deleted")
        } else if s.contains(git2::Status::WT_RENAMED) {
            Some("renamed")
        } else if s.contains(git2::Status::WT_TYPECHANGE) {
            Some("modified")
        } else {
            None
        };

        if let Some(kind) = unstaged_kind {
            let old_path = if kind == "renamed" {
                entry
                    .index_to_workdir()
                    .and_then(|d| d.old_file().path().map(|p| p.to_string_lossy().to_string()))
            } else {
                None
            };
            unstaged.push(FileChange {
                path,
                status: kind.to_string(),
                old_path,
            });
        }
    }

    Ok((staged, unstaged, untracked, conflicted))
}

/// Triangular-workflow detection — uses git CLI for `@{push}` resolution
/// since libgit2 has no first-class equivalent. Returns (push_remote_ref,
/// ahead_count) only when the push remote differs from the upstream;
/// otherwise (None, 0) so the UI shows a single ahead badge.
fn compute_push_remote_via_cli(cwd: &str, upstream: Option<&str>) -> (Option<String>, i32) {
    let push_out = git_cmd()
        .args(["rev-parse", "--abbrev-ref", "@{push}"])
        .current_dir(cwd)
        .output();
    let push_ref = match push_out {
        Ok(p) if p.status.success() => String::from_utf8_lossy(&p.stdout).trim().to_string(),
        _ => return (None, 0),
    };
    if push_ref.is_empty() || Some(push_ref.as_str()) == upstream {
        return (None, 0);
    }
    let count_out = git_cmd()
        .args(["rev-list", "--count", &format!("{}..HEAD", push_ref)])
        .current_dir(cwd)
        .output();
    let ahead_push = match count_out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .parse()
            .unwrap_or(0),
        _ => 0,
    };
    (Some(push_ref), ahead_push)
}

/// CLI-backed implementation of `git_status`. Kept as the reference for the
/// parity tests (`tests/parity/git-status.test.mjs` compares Rust output
/// against the Node dev-server, both calling `git status --porcelain=v2`).
///
/// The user-facing Tauri command `git_status` (above) routes to the libgit2
/// implementation `git_status_libgit2` instead, with this CLI version as a
/// fallback on libgit2 errors.
fn git_status_cli(cwd: String) -> Result<GitStatus, String> {
    let output = git_cmd()
        .args(["status", "--porcelain=v2", "--branch"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git status: {}", e))?;

    if !output.status.success() {
        return Err("git status failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branch = String::from("unknown");
    let mut remote: Option<String> = None;
    let mut ahead: i32 = 0;
    let mut behind: i32 = 0;
    let mut staged: Vec<FileChange> = Vec::new();
    let mut unstaged: Vec<FileChange> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    let mut conflicted: Vec<String> = Vec::new();

    for line in stdout.lines() {
        if line.starts_with("# branch.head ") {
            branch = line.strip_prefix("# branch.head ").unwrap_or("unknown").to_string();
        } else if line.starts_with("# branch.ab ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                ahead = parts[2].strip_prefix('+').unwrap_or("0").parse().unwrap_or(0);
                behind = parts[3].strip_prefix('-').unwrap_or("0").parse().unwrap_or(0);
            }
        } else if line.starts_with("# branch.oid ") {
            // track oid if needed
        } else if line.starts_with("# branch.upstream ") {
            remote = Some(line.strip_prefix("# branch.upstream ").unwrap_or("").to_string());
        } else if line.starts_with("u ") {
            // unmerged (conflicted) — porcelain v2 format:
            // u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            // All fields separated by spaces (no tabs)
            let parts: Vec<&str> = line.splitn(11, ' ').collect();
            if parts.len() >= 11 {
                conflicted.push(parts[10].to_string());
            }
        } else if line.starts_with("1 ") {
            // ordinary changed entry — porcelain v2 format:
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            // All fields separated by spaces (no tabs)
            let fields: Vec<&str> = line.splitn(9, ' ').collect();
            if fields.len() < 9 {
                continue;
            }
            let xy = fields[1];
            let path = fields[8].to_string();

            if xy.len() < 2 {
                continue;
            }

            let staged_char = xy.chars().next().unwrap();
            let unstaged_char = xy.chars().nth(1).unwrap();

            // Staged changes
            if staged_char != '.' {
                let status = match staged_char {
                    'A' => "added",
                    'M' => "modified",
                    'D' => "deleted",
                    'R' => "renamed",
                    _ => "modified",
                }
                .to_string();
                staged.push(FileChange {
                    path: path.clone(),
                    status,
                    old_path: None,
                });
            }

            // Unstaged changes
            if unstaged_char != '.' {
                let status = match unstaged_char {
                    'M' => "modified",
                    'D' => "deleted",
                    _ => "modified",
                }
                .to_string();
                unstaged.push(FileChange {
                    path,
                    status,
                    old_path: None,
                });
            }
        } else if line.starts_with("2 ") {
            // renamed/copied entry — porcelain v2 format:
            // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>\t<origPath>
            // Fields separated by spaces, but path and origPath separated by tab
            let tab_idx = line.find('\t');
            let meta_part = if let Some(idx) = tab_idx { &line[..idx] } else { line };
            let fields: Vec<&str> = meta_part.split_whitespace().collect();
            if fields.len() < 10 {
                continue;
            }
            let xy = fields[1];
            let path = fields[9].to_string();
            let old_path = tab_idx.map(|idx| line[idx + 1..].to_string());

            if xy.len() < 2 {
                continue;
            }

            let staged_char = xy.chars().next().unwrap();
            let unstaged_char = xy.chars().nth(1).unwrap();

            // Staged changes
            if staged_char != '.' {
                let status = match staged_char {
                    'A' => "added",
                    'M' => "modified",
                    'D' => "deleted",
                    'R' => "renamed",
                    _ => "modified",
                }
                .to_string();
                staged.push(FileChange {
                    path: path.clone(),
                    status,
                    old_path: old_path.clone(),
                });
            }

            // Unstaged changes
            if unstaged_char != '.' {
                let status = match unstaged_char {
                    'M' => "modified",
                    'D' => "deleted",
                    _ => "modified",
                }
                .to_string();
                unstaged.push(FileChange {
                    path,
                    status,
                    old_path,
                });
            }
        } else if line.starts_with("? ") {
            // untracked
            let path = line.strip_prefix("? ").unwrap_or("").to_string();
            if !path.is_empty() {
                untracked.push(path);
            }
        }
    }

    // If upstream exists but ahead/behind are 0, try rev-list as fallback
    if remote.is_some() && ahead == 0 && behind == 0 {
        if let Ok(rev_output) = git_cmd()
            .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
            .current_dir(&cwd)
            .output()
        {
            if rev_output.status.success() {
                let rev_str = String::from_utf8_lossy(&rev_output.stdout);
                let nums: Vec<i32> = rev_str
                    .trim()
                    .split_whitespace()
                    .filter_map(|s| s.parse().ok())
                    .collect();
                if nums.len() >= 2 {
                    ahead = nums[0];
                    behind = nums[1];
                }
            }
        }
    }

    // ── Triangular / fork workflow ───────────────────────────────────────────
    // When push.default = "upstream" or a fork is set up, the push remote may
    // differ from the upstream (fetch) remote. Detect this and compute a
    // separate ahead count so the UI can show two distinct badges.
    let mut push_remote: Option<String> = None;
    let mut ahead_push: i32 = 0;

    let push_ref_out = git_cmd()
        .args(["rev-parse", "--abbrev-ref", "@{push}"])
        .current_dir(&cwd)
        .output();

    if let Ok(p) = push_ref_out {
        if p.status.success() {
            let push_ref = String::from_utf8_lossy(&p.stdout).trim().to_string();
            let upstream_ref = remote.as_deref().unwrap_or("");
            // Only proceed if push remote is set AND differs from upstream
            if !push_ref.is_empty() && push_ref != upstream_ref {
                // ahead of push remote (how many commits would be pushed)
                let rl = git_cmd()
                    .args(["rev-list", "--count", &format!("{}..HEAD", push_ref)])
                    .current_dir(&cwd)
                    .output();
                if let Ok(o) = rl {
                    if o.status.success() {
                        ahead_push = String::from_utf8_lossy(&o.stdout)
                            .trim().parse().unwrap_or(0);
                    }
                }
                push_remote = Some(push_ref);
            }
        }
    }

    Ok(GitStatus {
        branch,
        remote,
        ahead,
        behind,
        push_remote,
        ahead_push,
        staged,
        unstaged,
        untracked,
        conflicted,
    })
}

#[tauri::command]
fn git_diff(cwd: String, path: String, staged: bool) -> Result<GitDiff, String> {
    let mut cmd = git_cmd();
    if staged {
        cmd.arg("diff").arg("--cached");
    } else {
        cmd.arg("diff");
    }
    cmd.arg("--").arg(&path).current_dir(&cwd);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    // Defensive truncation. We slice at the last newline within the cap so
    // we never split a hunk header mid-line.
    let original_size = output.stdout.len();
    let truncated_from_bytes: Option<u64> = if original_size > DIFF_TRUNCATE_BYTES {
        Some(original_size as u64)
    } else {
        None
    };
    let stdout_slice: &[u8] = if truncated_from_bytes.is_some() {
        let mut cut = DIFF_TRUNCATE_BYTES;
        // Walk back to the last \n so the parser sees complete lines.
        while cut > 0 && output.stdout[cut - 1] != b'\n' {
            cut -= 1;
        }
        &output.stdout[..cut]
    } else {
        &output.stdout
    };
    let stdout = String::from_utf8_lossy(stdout_slice);
    let (mut hunks, mut status) = parse_diff_hunks(&stdout);

    // Untracked (not-yet-staged) files produce no output from `git diff`.
    // Fall back to `git diff --no-index -- /dev/null <path>` which generates
    // a proper "new file" diff with every line shown as an addition.
    // Note: --no-index always exits with code 1 when files differ, so we
    // ignore the exit status and only look at stdout.
    if !staged && hunks.is_empty() && truncated_from_bytes.is_none() {
        if let Ok(fb) = git_cmd()
            .args(["diff", "--no-index", "--", "/dev/null", &path])
            .current_dir(&cwd)
            .output()
        {
            let fb_stdout = String::from_utf8_lossy(&fb.stdout);
            let (fb_hunks, fb_status) = parse_diff_hunks(&fb_stdout);
            if !fb_hunks.is_empty() {
                hunks = fb_hunks;
                status = fb_status.or(Some("added".to_string()));
            }
        }
    }

    Ok(GitDiff {
        path,
        hunks,
        status,
        old_path: None,
        truncated_from_bytes,
    })
}

#[tauri::command]
fn git_log(
    cwd: String,
    count: Option<i32>,
    all: Option<bool>,
    author: Option<String>,
) -> Result<Vec<GitLogEntry>, String> {
    let limit = count.unwrap_or(50);
    // Default: current branch only (like `git log`). Pass `all: true` to include all refs.
    let include_all = all.unwrap_or(false);

    // Use unit separator (ASCII 0x1f) to delimit fields
    let format = "%h%x1f%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f%P%x1f%D%x1e";

    let mut args: Vec<String> = vec!["log".to_string()];
    if include_all {
        args.push("--all".to_string());
    }
    if let Some(ref author_filter) = author {
        if !author_filter.is_empty() {
            args.push(format!("--author={}", author_filter));
        }
    }
    args.push(format!("-n{}", limit));
    args.push(format!("--format={}", format));

    let output = git_cmd()
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        return Err("git log failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<GitLogEntry> = Vec::new();

    // Split by record separator (0x1e)
    for record in stdout.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 9 {
            continue;
        }

        let parents: Vec<String> = fields[7]
            .trim()
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();

        entries.push(GitLogEntry {
            hash: fields[0].to_string(),
            hash_full: fields[1].to_string(),
            author: fields[2].to_string(),
            email: fields[3].to_string(),
            date: fields[4].to_string(),
            message: fields[5].to_string(),
            body: fields[6].trim().to_string(),
            parents,
            refs: fields[8].trim().to_string(),
        });
    }

    Ok(entries)
}

// ─── File system commands ──────────────────────────────────

#[tauri::command]
fn read_file(cwd: String, path: String) -> Result<String, String> {
    let full = safe_repo_path(&cwd, &path)?;
    std::fs::read_to_string(&full).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn write_file(cwd: String, path: String, content: String) -> Result<(), String> {
    let full = safe_repo_path(&cwd, &path)?;
    std::fs::write(&full, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn read_file_at_revision(
    cwd: String,
    rev: String,
    path: String,
) -> Result<FileAtRevision, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let mime = guess_mime_from_ext(&path).to_string();

    // Working tree read (rev empty) — go through the safe_repo_path helper.
    if rev.trim().is_empty() {
        let full = safe_repo_path(&cwd, &path)?;
        match std::fs::read(&full) {
            Ok(bytes) => Ok(FileAtRevision {
                byte_length: bytes.len(),
                bytes_base64: STANDARD.encode(&bytes),
                mime,
                absent: false,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileAtRevision {
                bytes_base64: String::new(),
                byte_length: 0,
                mime,
                absent: true,
            }),
            Err(e) => Err(format!("Failed to read {}: {}", path, e)),
        }
    } else {
        // Revision read — shell out to `git show <rev>:<path>`.
        // `current_dir(cwd)` keeps git confined to the repo.
        if cwd.trim().is_empty() {
            return Err("cwd must not be empty".to_string());
        }
        let spec = format!("{}:{}", rev, path);
        let output = git_cmd()
            .args(["show", &spec])
            .current_dir(&cwd)
            .output()
            .map_err(|e| format!("Failed to run git show: {}", e))?;

        if !output.status.success() {
            // Missing file at that revision → treat as absent (not an error).
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("exists on disk, but not in")
                || stderr.contains("does not exist")
                || stderr.contains("unknown revision")
                || stderr.contains("Path")
            {
                return Ok(FileAtRevision {
                    bytes_base64: String::new(),
                    byte_length: 0,
                    mime,
                    absent: true,
                });
            }
            return Err(format!("git show {} failed: {}", spec, stderr.trim()));
        }

        Ok(FileAtRevision {
            byte_length: output.stdout.len(),
            bytes_base64: STANDARD.encode(&output.stdout),
            mime,
            absent: false,
        })
    }
}

#[tauri::command]
fn folder_diff(cwd: String, ref_a: String, ref_b: String) -> Result<FolderDiffNode, String> {
    if cwd.trim().is_empty() {
        return Err("cwd must not be empty".to_string());
    }

    let refs = folder_diff_args(&ref_a, &ref_b);

    // --- name-status (to recover the status letter + rename old path) ---
    let mut ns_args: Vec<String> = vec![
        "diff".to_string(),
        "-z".to_string(),
        "--name-status".to_string(),
        "--find-renames".to_string(),
    ];
    ns_args.extend(refs.iter().cloned());
    let ns_output = git_cmd()
        .args(&ns_args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git diff --name-status: {}", e))?;
    if !ns_output.status.success() {
        let stderr = String::from_utf8_lossy(&ns_output.stderr);
        return Err(format!("git diff --name-status failed: {}", stderr.trim()));
    }
    let ns_text = String::from_utf8_lossy(&ns_output.stdout).to_string();
    let name_status = parse_name_status_z(&ns_text);

    // --- numstat (to recover line counts + binary flag) ---
    let mut numstat_args: Vec<String> = vec![
        "diff".to_string(),
        "-z".to_string(),
        "--numstat".to_string(),
        "--find-renames".to_string(),
    ];
    numstat_args.extend(refs.iter().cloned());
    let ns2_output = git_cmd()
        .args(&numstat_args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git diff --numstat: {}", e))?;
    if !ns2_output.status.success() {
        let stderr = String::from_utf8_lossy(&ns2_output.stderr);
        return Err(format!("git diff --numstat failed: {}", stderr.trim()));
    }
    let numstat_text = String::from_utf8_lossy(&ns2_output.stdout).to_string();
    let numstat = parse_numstat_z(&numstat_text);

    // --- Merge into raw changes (key = new_path) ---
    let mut changes: Vec<RawFileChange> = Vec::with_capacity(name_status.len());
    for (new_path, status, old_path) in name_status.into_iter() {
        let (additions, deletions, binary) = numstat
            .get(&new_path)
            .copied()
            .unwrap_or((0, 0, false));
        changes.push(RawFileChange {
            new_path,
            old_path,
            status,
            additions,
            deletions,
            binary,
        });
    }

    // --- Build tree ---
    let mut root = FolderDiffNode {
        path: String::new(),
        name: String::new(),
        kind: "folder".to_string(),
        status: None,
        old_path: None,
        files_changed: 0,
        additions: 0,
        deletions: 0,
        binary: false,
        children: Vec::new(),
    };
    for change in changes.iter() {
        insert_change(&mut root, change);
    }
    sort_node(&mut root);
    Ok(root)
}

// ─── Directory listing (for FolderPicker) ──────────────────

#[tauri::command]
fn list_dir(path: Option<String>) -> Result<ListDirResult, String> {
    let home_path = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let home = home_path.to_string_lossy().to_string();

    let dir_path = match &path {
        Some(p) if !p.is_empty() => {
            let expanded = if p.starts_with('~') {
                p.replacen('~', &home, 1)
            } else {
                p.clone()
            };
            PathBuf::from(expanded)
        }
        _ => home_path.clone(),
    };

    let dir_path = dir_path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {}", e))?;

    let entries = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Cannot read directory: {}", e))?;

    // Is this the home directory? If so, we want to avoid probing
    // inside TCC-protected subfolders on macOS (Documents/Desktop/...)
    // because each probe triggers a system permission prompt.
    let at_home = home_path
        .canonicalize()
        .map(|h| h == dir_path)
        .unwrap_or(false);

    let mut dirs: Vec<DirEntry> = Vec::new();

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden dirs (starting with .)
        if name.starts_with('.') {
            continue;
        }

        // Skip noisy directories
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let full_path = entry.path();

        // Avoid probing `.git` inside TCC-protected folders at the home
        // level on macOS — it would trigger a permission dialog each time.
        let is_git_repo = if at_home && MACOS_TCC_PROTECTED.contains(&name.as_str()) {
            false
        } else {
            full_path.join(".git").exists()
        };

        dirs.push(DirEntry {
            name,
            path: full_path.to_string_lossy().to_string(),
            is_git_repo,
        });
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let parent = dir_path
        .parent()
        .filter(|p| *p != dir_path)
        .map(|p| p.to_string_lossy().to_string());

    Ok(ListDirResult {
        current: dir_path.to_string_lossy().to_string(),
        parent,
        home,
        dirs,
    })
}

// ─── Git repo state (rebase / merge in progress) ─────────────

/// Returns the current operation state of the repository by inspecting the
/// .git directory directly — more reliable than parsing locale-dependent
/// `git status` messages.
#[tauri::command]
fn git_repo_state(cwd: String) -> Result<RepoOperationState, String> {
    let git_dir = resolve_git_dir(&cwd)?;

    // ── Plain or interactive rebase (git >= 2.26: rebase-merge dir) ───────
    let rebase_merge = git_dir.join("rebase-merge");
    if rebase_merge.exists() {
        let is_interactive = rebase_merge.join("interactive").exists();
        let step  = read_git_u32(&rebase_merge.join("msgnum"));
        let total = read_git_u32(&rebase_merge.join("end"));
        let head  = read_git_file(&git_dir.join("REBASE_HEAD"));
        let branch = read_git_file(&rebase_merge.join("head-name"))
            .map(|s| s.trim_start_matches("refs/heads/").to_string());
        return Ok(RepoOperationState {
            state: if is_interactive { "rebase_interactive".into() } else { "rebase".into() },
            has_conflict: has_unresolved_conflicts(&cwd),
            operation_head: head,
            target_branch: branch,
            step,
            total,
        });
    }

    // ── Old-style rebase-apply (git am / old --apply) ─────────────────────
    let rebase_apply = git_dir.join("rebase-apply");
    if rebase_apply.exists() {
        let step  = read_git_u32(&rebase_apply.join("next"));
        let total = read_git_u32(&rebase_apply.join("last"));
        let head  = read_git_file(&git_dir.join("REBASE_HEAD"));
        let branch = read_git_file(&rebase_apply.join("head-name"))
            .map(|s| s.trim_start_matches("refs/heads/").to_string());
        return Ok(RepoOperationState {
            state: "rebase".into(),
            has_conflict: has_unresolved_conflicts(&cwd),
            operation_head: head,
            target_branch: branch,
            step,
            total,
        });
    }

    // ── Merge in progress ─────────────────────────────────────────────────
    let merge_head = git_dir.join("MERGE_HEAD");
    if merge_head.exists() {
        return Ok(RepoOperationState {
            state: "merge".into(),
            has_conflict: has_unresolved_conflicts(&cwd),
            operation_head: read_git_file(&merge_head),
            target_branch: None,
            step: 0,
            total: 0,
        });
    }

    // ── Cherry-pick in progress ───────────────────────────────────────────
    let cherry_head = git_dir.join("CHERRY_PICK_HEAD");
    if cherry_head.exists() {
        return Ok(RepoOperationState {
            state: "cherry_pick".into(),
            has_conflict: has_unresolved_conflicts(&cwd),
            operation_head: read_git_file(&cherry_head),
            target_branch: None,
            step: 0,
            total: 0,
        });
    }

    // ── Revert in progress ────────────────────────────────────────────────
    let revert_head = git_dir.join("REVERT_HEAD");
    if revert_head.exists() {
        return Ok(RepoOperationState {
            state: "revert".into(),
            has_conflict: has_unresolved_conflicts(&cwd),
            operation_head: read_git_file(&revert_head),
            target_branch: None,
            step: 0,
            total: 0,
        });
    }

    // ── Clean ─────────────────────────────────────────────────────────────
    Ok(RepoOperationState {
        state: "clean".into(),
        has_conflict: false,
        operation_head: None,
        target_branch: None,
        step: 0,
        total: 0,
    })
}

// ─── Git show (commit diff) ──────────────────────────────────

#[tauri::command]
fn git_show(cwd: String, hash: String) -> Result<Vec<GitDiff>, String> {
    let output = git_cmd()
        .args(["show", "-m", "--first-parent", "--format=", &hash])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git show: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut diffs: Vec<GitDiff> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line_no = 0;
    let mut new_line_no = 0;
    let mut current_hunks: Vec<DiffHunk> = Vec::new();
    // Extended-header state tracked per file, captured before any @@ hunk and
    // flushed alongside the file's hunks when the next `diff --git` appears.
    let mut current_status: Option<String> = None;
    let mut current_old_path: Option<String> = None;

    for line in stdout.lines() {
        if line.starts_with("diff --git ") {
            // Save previous file diff
            if let Some(hunk) = current_hunk.take() {
                current_hunks.push(hunk);
            }
            if let Some(path) = current_path.take() {
                diffs.push(GitDiff {
                    path,
                    hunks: std::mem::take(&mut current_hunks),
                    status: current_status.take(),
                    old_path: current_old_path.take(),
                    // P2.4 — multi-file commit diff parsing has no per-file
                    // cap (the caller is `git_show`/`git_log_with_diff`,
                    // not the polled `git_diff` that `pollStatus` re-fires).
                    // Truncation is only meaningful for the per-file diff
                    // command. Set None unconditionally here.
                    truncated_from_bytes: None,
                });
            }
            current_status = None;
            current_old_path = None;

            // Extract file path from "diff --git a/path b/path"
            let parts: Vec<&str> = line.split(" b/").collect();
            if parts.len() >= 2 {
                current_path = Some(parts[1].to_string());
            }
        } else if line.starts_with("new file mode") {
            current_status = Some("added".to_string());
        } else if line.starts_with("deleted file mode") {
            current_status = Some("deleted".to_string());
        } else if let Some(rest) = line.strip_prefix("rename from ") {
            current_status = Some("renamed".to_string());
            current_old_path = Some(rest.to_string());
        } else if line.starts_with("rename to ") {
            if current_status.is_none() {
                current_status = Some("renamed".to_string());
            }
        } else if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                current_hunks.push(hunk);
            }

            let header = line.to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();
            let mut old_start = 0;
            let mut old_count = 1;
            let mut new_start = 0;
            let mut new_count = 1;

            if parts.len() >= 3 {
                let old_range = parts[1].strip_prefix('-').unwrap_or("0");
                let new_range = parts[2].strip_prefix('+').unwrap_or("0");

                if let Some(comma_idx) = old_range.find(',') {
                    old_start = old_range[..comma_idx].parse().unwrap_or(0);
                    old_count = old_range[comma_idx + 1..].parse().unwrap_or(1);
                } else {
                    old_start = old_range.parse().unwrap_or(0);
                }

                if let Some(comma_idx) = new_range.find(',') {
                    new_start = new_range[..comma_idx].parse().unwrap_or(0);
                    new_count = new_range[comma_idx + 1..].parse().unwrap_or(1);
                } else {
                    new_start = new_range.parse().unwrap_or(0);
                }
            }

            old_line_no = old_start;
            new_line_no = new_start;

            current_hunk = Some(DiffHunk {
                header,
                old_start,
                old_count,
                new_start,
                new_count,
                lines: Vec::new(),
            });
        } else if let Some(ref mut hunk) = current_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                hunk.lines.push(DiffLine {
                    r#type: "add".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: None,
                    new_line_no: Some(new_line_no),
                });
                new_line_no += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                hunk.lines.push(DiffLine {
                    r#type: "delete".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: Some(old_line_no),
                    new_line_no: None,
                });
                old_line_no += 1;
            } else if line.starts_with(' ') {
                // Only accept lines that start with a literal space as context.
                // Empty strings (from split on blank separator lines or trailing
                // EOF newline) must NOT be classified as context — doing so adds
                // a phantom zero-length context line to the hunk, which makes
                // `git apply` reject the patch with "depends on old contents"
                // for new-file hunks (header becomes `-0,1` instead of `-0,0`).
                hunk.lines.push(DiffLine {
                    r#type: "context".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: Some(old_line_no),
                    new_line_no: Some(new_line_no),
                });
                old_line_no += 1;
                new_line_no += 1;
            }
        }
    }

    // Save last file diff
    if let Some(hunk) = current_hunk.take() {
        current_hunks.push(hunk);
    }
    if let Some(path) = current_path.take() {
        diffs.push(GitDiff {
            path,
            hunks: current_hunks,
            status: current_status.take(),
            old_path: current_old_path.take(),
            truncated_from_bytes: None, // see P2.4 note above
        });
    }

    Ok(diffs)
}

// ─── File log (v1.9) — pickaxe + line-range ──────────────
#[tauri::command]
fn git_file_log(cwd: String, path: String, count: Option<u32>) -> Result<Vec<FileLogEntry>, String> {
    let n = count.unwrap_or(50).to_string();
    let fmt = "%H\n%h\n%an\n%aI\n%s\n%b\n---END---";
    let output = git_cmd()
        .args(["log", "--follow", "-n", &n, &format!("--format={}", fmt), "--", &path])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git log failed: {}", e))?;
    if !output.status.success() {
        return Err(format!("git log failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(parse_file_log_output(&String::from_utf8_lossy(&output.stdout)))
}

/// Pickaxe: find commits that added or removed `search` string.
/// mode: "S" (literal string) | "G" (regex)
#[tauri::command]
fn git_file_log_pickaxe(cwd: String, path: String, search: String, mode: String) -> Result<Vec<FileLogEntry>, String> {
    let flag = if mode == "G" { "-G" } else { "-S" };
    let fmt = "%H\n%h\n%an\n%aI\n%s\n%b\n---END---";
    let output = git_cmd()
        .args(["log", "--follow", flag, &search, &format!("--format={}", fmt), "--", &path])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git log pickaxe failed: {}", e))?;
    if !output.status.success() {
        return Err(format!("git log pickaxe failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(parse_file_log_output(&String::from_utf8_lossy(&output.stdout)))
}

/// Line-range history: commits that touched lines [start..end] in path.
/// Uses git log -L <start>,<end>:<path> (no --follow; incompatible with -L).
#[tauri::command]
fn git_file_log_range(cwd: String, path: String, start_line: u32, end_line: u32) -> Result<Vec<FileLogEntry>, String> {
    let range = format!("{},{}:{}", start_line, end_line, path);
    let fmt = "%H\n%h\n%an\n%aI\n%s\n%b\n---END---";
    let output = git_cmd()
        .args(["log", "-L", &range, &format!("--format={}", fmt)])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("git log -L failed: {}", e))?;
    if !output.status.success() {
        return Err(format!("git log -L failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(parse_file_log_output(&String::from_utf8_lossy(&output.stdout)))
}

/// Run `git blame --porcelain` on a file.
/// algorithm: "histogram" | "patience" | "minimal" | "myers" (default "histogram").
#[tauri::command]
fn git_blame(cwd: String, path: String, algorithm: Option<String>) -> Result<Vec<BlameLine>, String> {
    let algo = algorithm.as_deref().unwrap_or("histogram");
    let diff_algo_flag = format!("--diff-algorithm={}", algo);
    let output = git_cmd()
        .args(["blame", "--porcelain", &diff_algo_flag, "--", &path])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git blame: {}", e))?;
    if !output.status.success() {
        return Err(format!("git blame failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = raw.lines().collect();
    let mut blame_lines: Vec<BlameLine> = Vec::new();
    // Limit to 10 000 blame entries to cap memory & runtime on huge files.
    const BLAME_MAX_ENTRIES: usize = 10_000;
    let mut i = 0;
    while i < lines.len() && blame_lines.len() < BLAME_MAX_ENTRIES {
        // Header: <40-char-sha> <orig-line> <final-line> [<num-lines-in-group>]
        let parts: Vec<&str> = lines[i].split_whitespace().collect();
        if parts.len() < 3 || parts[0].len() != 40 {
            i += 1;
            continue;
        }
        let hash_full = parts[0].to_string();
        let hash = hash_full[..7].to_string();
        let orig_line: u32 = parts[1].parse().unwrap_or(0);
        let final_line: u32 = parts[2].parse().unwrap_or(0);
        i += 1;
        let mut author = String::new();
        let mut author_date = String::new();
        let mut summary = String::new();
        let mut content = String::new();
        while i < lines.len() && !lines[i].starts_with('\t') {
            if lines[i].starts_with("author ") {
                author = lines[i][7..].to_string();
            } else if lines[i].starts_with("author-time ") {
                author_date = lines[i][12..].to_string();
            } else if lines[i].starts_with("summary ") {
                summary = lines[i][8..].to_string();
            }
            i += 1;
        }
        if i < lines.len() && lines[i].starts_with('\t') {
            content = lines[i][1..].to_string();
            i += 1;
        }
        blame_lines.push(BlameLine { hash, hash_full, final_line, orig_line, author, author_date, summary, content });
    }
    Ok(blame_lines)
}

// `gh_*` commands (list_prs, create_pr, list_reviewer_candidates,
// checkout_pr, merge_pr, pr_detail, pr_diff, pr_checks) migrated to
// `src/commands/gh.rs` (§3.4e). Handler entries below route to
// `commands::gh::*`.

// `parse_gh_pr_json` + `gh_pr_raw_to_pr` migrated to `src/git/parse.rs`
// as part of §3.4 (lib.rs split). Resolved here via the glob
// `pub(crate) use crate::git::*;` at the top of this file.

// gh_create_pr → commands/gh.rs

// gh_list_reviewer_candidates → commands/gh.rs

// gh_checkout_pr → commands/gh.rs

// gh_merge_pr → commands/gh.rs

// gh_pr_detail → commands/gh.rs

// gh_pr_diff → commands/gh.rs

// gh_pr_checks → commands/gh.rs

// ─── Read .gitwandrc ──────────────────────────────────────

// ─── Merge Preview (Phase 8.1) ───────────────────────────
//
// Calcule un aperçu "sans effet de bord" de ce qui se passerait
// si on mergait `source_branch` dans HEAD.
//
// Algorithme :
//   1. git merge-base HEAD <branch>  → ancêtre commun
//   2. git diff --name-only <base> HEAD   → fichiers modifiés côté ours
//   3. git diff --name-only <base> <branch> → fichiers modifiés côté theirs
//   4. intersection → fichiers potentiellement en conflit
//   5. Pour chaque fichier : git show <ref>:<file> pour les 3 versions
//   6. git merge-file -p (dans un répertoire temp) → contenu avec marqueurs
//   7. Retourner la liste brute — le résolveur tourne côté frontend (TypeScript)

#[tauri::command]
fn preview_merge(cwd: String, source_branch: String) -> Result<Vec<FileMergePreview>, String> {
    let git = git_binary();

    // 1. Merge-base
    let base_out = hidden_cmd(&git)
        .args(["merge-base", "HEAD", &source_branch])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("merge-base failed: {}", e))?;
    if !base_out.status.success() {
        return Err(format!(
            "Cannot find merge-base: {}",
            String::from_utf8_lossy(&base_out.stderr)
        ));
    }
    let base = String::from_utf8_lossy(&base_out.stdout).trim().to_string();

    // 2. Fichiers modifiés dans HEAD depuis base
    let ours_files = git_changed_files(&git, &cwd, &base, "HEAD")?;
    // 3. Fichiers modifiés dans source_branch depuis base
    let theirs_files = git_changed_files(&git, &cwd, &base, &source_branch)?;

    // 4. Intersection : modifiés des deux côtés
    let ours_set: std::collections::HashSet<&String> = ours_files.iter().collect();
    let both_modified: Vec<&String> = theirs_files.iter().filter(|f| ours_set.contains(f)).collect();

    // 5. Fichiers supprimés/ajoutés unilatéralement
    let theirs_set: std::collections::HashSet<&String> = theirs_files.iter().collect();
    let only_ours: Vec<&String> = ours_files.iter().filter(|f| !theirs_set.contains(f)).collect();
    let only_theirs: Vec<&String> = theirs_files.iter().filter(|f| !ours_set.contains(f)).collect();

    let tmp = std::env::temp_dir();
    let mut results: Vec<FileMergePreview> = Vec::new();

    // 6. Pour chaque fichier modifié des deux côtés → tenter git merge-file
    for file_path in both_modified {
        let preview = merge_file_preview(&git, &cwd, &base, "HEAD", &source_branch, file_path, &tmp);
        results.push(preview);
    }

    // Fichiers seulement modifiés côté ours → pas de conflit
    for file_path in only_ours {
        results.push(FileMergePreview {
            file_path: file_path.clone(),
            conflict_content: String::new(),
            has_conflicts: false,
            is_add_delete: false,
        });
    }

    // Fichiers seulement modifiés côté theirs → pas de conflit (theirs gagne)
    for file_path in only_theirs {
        results.push(FileMergePreview {
            file_path: file_path.clone(),
            conflict_content: String::new(),
            has_conflicts: false,
            is_add_delete: false,
        });
    }

    // Trier : conflits en premier, puis par chemin
    results.sort_by(|a, b| {
        b.has_conflicts.cmp(&a.has_conflicts)
            .then(a.file_path.cmp(&b.file_path))
    });

    Ok(results)
}

/// Retourne la liste des fichiers modifiés entre `base` et `rev` (noms relatifs uniquement).
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

/// Tente de merger les trois versions d'un fichier avec git merge-file.
/// Retourne le contenu résultant (avec ou sans marqueurs de conflit).
fn merge_file_preview(
    git: &str,
    cwd: &str,
    base_ref: &str,
    ours_ref: &str,
    theirs_ref: &str,
    file_path: &str,
    tmp: &std::path::Path,
) -> FileMergePreview {
    /// Lire le contenu d'un fichier à une révision donnée. Retourne None si absent.
    fn git_show_file(git: &str, cwd: &str, rev: &str, path: &str) -> Option<Vec<u8>> {
        let spec = format!("{}:{}", rev, path);
        let out = hidden_cmd(git)
            .args(["show", &spec])
            .current_dir(cwd)
            .output()
            .ok()?;
        if out.status.success() { Some(out.stdout) } else { None }
    }

    let base_bytes = git_show_file(git, cwd, base_ref, file_path);
    let ours_bytes = git_show_file(git, cwd, ours_ref, file_path);
    let theirs_bytes = git_show_file(git, cwd, theirs_ref, file_path);

    // Si un côté n'a pas le fichier → add/delete conflict
    match (&ours_bytes, &theirs_bytes) {
        (None, _) | (_, None) => {
            return FileMergePreview {
                file_path: file_path.to_string(),
                conflict_content: String::new(),
                has_conflicts: true,
                is_add_delete: true,
            };
        }
        _ => {}
    }

    // Écrire les trois versions dans des fichiers temporaires
    let prefix = file_path.replace(['/', '\\', '.'], "_");
    let tmp_base  = tmp.join(format!("{}_base.tmp", prefix));
    let tmp_ours  = tmp.join(format!("{}_ours.tmp", prefix));
    let tmp_theirs = tmp.join(format!("{}_theirs.tmp", prefix));

    let write_or_empty = |path: &std::path::Path, bytes: &Option<Vec<u8>>| {
        let content = bytes.as_deref().unwrap_or(b"");
        std::fs::write(path, content)
    };

    if write_or_empty(&tmp_base, &base_bytes).is_err()
        || write_or_empty(&tmp_ours, &ours_bytes).is_err()
        || write_or_empty(&tmp_theirs, &theirs_bytes).is_err()
    {
        return FileMergePreview {
            file_path: file_path.to_string(),
            conflict_content: String::new(),
            has_conflicts: true,
            is_add_delete: false,
        };
    }

    // git merge-file -p <ours> <base> <theirs>  (note: ordre ours/base/theirs)
    let merge_out = git_cmd()
        .args([
            "merge-file",
            "-p",
            "--diff3",
            tmp_ours.to_str().unwrap_or(""),
            tmp_base.to_str().unwrap_or(""),
            tmp_theirs.to_str().unwrap_or(""),
        ])
        .output();

    // Nettoyer
    let _ = std::fs::remove_file(&tmp_base);
    let _ = std::fs::remove_file(&tmp_ours);
    let _ = std::fs::remove_file(&tmp_theirs);

    match merge_out {
        Ok(out) => {
            let content = String::from_utf8_lossy(&out.stdout).to_string();
            // git merge-file retourne exit code 1 si conflit, 0 si merge propre
            let has_conflicts = !out.status.success() || content.contains("<<<<<<<");
            FileMergePreview {
                file_path: file_path.to_string(),
                conflict_content: content,
                has_conflicts,
                is_add_delete: false,
            }
        }
        Err(_) => FileMergePreview {
            file_path: file_path.to_string(),
            conflict_content: String::new(),
            has_conflicts: true,
            is_add_delete: false,
        },
    }
}

// ─── Claude Code CLI (piggyback on user's local install) ─────
//
// Wraps the official `claude` CLI (Claude Code) so GitWand can use the
// user's existing Claude Max/Pro subscription without implementing OAuth
// ourselves. Inspired by Solo's approach, but headless (no PTY): we only
// need one-shot prompts for commit messages, merge resolution and PR review.

// `ClaudeCliInfo` struct + `CLAUDE_AUTH_OVERRIDE_ENV` const migrated
// to `src/types.rs` as part of §3.4. Resolved here via
// `pub(crate) use crate::types::*;`.

// `strip_claude_auth_env` + `resolve_claude_binary` + `resolve_codex_binary`
// + 5 AI CLI commands (detect_claude_cli, claude_cli_prompt, detect_codex_cli,
// codex_cli_prompt, claude_cli_login) migrated to `src/commands/ai.rs` (§3.4f).
// Handler entries below route to `commands::ai::*`.

// ─── Workspaces ───────────────────────────────────────────────

// `WorkspaceRepo` and `WorkspaceConfig` migrated to `src/types.rs` as
// part of §3.4. Resolved here via `pub(crate) use crate::types::*;`.

// `WorkspaceRepoStatus`, `WorkspaceWipItem`, and `WorkspaceRepoPrs`
// migrated to `src/types.rs` as part of §3.4. Resolved here via
// `pub(crate) use crate::types::*;`.

// `Issue`, `GhIssue*` deserialization helpers, `parse_gh_issue_json`,
// and `WorkspaceRepoIssues` migrated to `src/types.rs` and
// `src/git/parse.rs` as part of §3.4. Resolved here via
// `pub(crate) use crate::types::*;` and `pub(crate) use crate::git::*;`.

// `workspace_read` + `workspace_write` migrated to
// `src/commands/workspace.rs` (§3.4). The handler entries below now
// point to `commands::workspace::*`.

// `libgit2_*` helpers + `format_iso8601` + `unix_to_ymdhms` migrated
// to `src/git/libgit2.rs` (§3.4 / P3.3a).
// `workspace_status_all` + `workspace_fetch_all` + `workspace_pull_all`
// + `workspace_wip_all` + `workspace_prs_all` + `workspace_issues_all`
// migrated to `src/commands/workspace.rs` (§3.4). Handler entries below
// route to `commands::workspace::*`.

// detect_claude_cli → commands/ai.rs

// claude_cli_prompt → commands/ai.rs

// ─── Codex CLI provider (v2.0) ─────────────────────────────
//
// OpenAI Codex CLI integration — mirrors the Claude Code CLI flow but
// shells out to `codex exec "<prompt>"` instead of `claude -p`. `codex
// exec` is the official non-interactive entry point (the REPL-style
// `codex` without subcommand would hang waiting for user input). No
// `--quiet` flag — it doesn't exist on `codex exec` and adding one
// fails with `unexpected argument '--quiet'`.
//
// Auth: either OAuth via `codex login` (uses ChatGPT subscription) or
// `OPENAI_API_KEY` env var. The CLI surfaces a clear error at first call
// when neither is set, so detection matches the Claude pattern: tiny ping
// prompt that exits 0 when auth works.

// `CodexCliInfo` migrated to `src/types.rs` as part of §3.4.
// Resolved here via `pub(crate) use crate::types::*;`.

// resolve_codex_binary → commands/ai.rs

// detect_codex_cli → commands/ai.rs

// codex_cli_prompt → commands/ai.rs

// ─── Clone & Fork (v2.0) ───────────────────────────────────
//
// Both commands are synchronous shell-outs that block on completion.
// Real-time progress events are deliberately deferred — they'd require
// introducing async commands + Tauri event emit + SSE on the dev-server,
// which is a chantier of its own. The frontend shows a spinner while
// these run; on a fast network a typical clone is sub-second to a few
// seconds and the spinner is acceptable.

// claude_cli_login → commands/ai.rs

// ─── Parity probe re-exports ───────────────────────────────
//
// `#[tauri::command]` generates a helper `pub struct __cmd__<fn_name>` next
// to the function, and making the wrapped fn itself `pub` collides with that
// helper's name in the macro namespace (E0255). So we keep the Tauri commands
// private and expose tiny `pub fn <name>_parity` wrappers that the
// `parity-probe` example (see `examples/parity_probe.rs`) imports to run the
// *same* code paths as the Tauri handler, without going through a Tauri
// `Invoke`.
//
// These wrappers are always compiled — they're 3-line passthroughs with no
// runtime cost, and keeping them unconditional avoids the "works with this
// feature, breaks without it" class of bugs.

/// Parity entry point — explicitly calls the CLI-backed implementation.
/// The user-facing `git_status` Tauri command uses libgit2 (P3.3b), but
/// parity tests must compare against the CLI implementation that the Node
/// dev-server also uses. Don't redirect this to the libgit2 version.
pub fn git_status_parity(cwd: String) -> Result<GitStatus, String> {
    git_status_cli(cwd)
}

/// Bench entry point — calls the libgit2 fast path *in isolation*, so the
/// bench can measure it directly without the CLI fallback masking the
/// numbers. NOT used for parity testing — the libgit2 output may diverge
/// from CLI on edge cases (and the CLI fallback handles those at runtime).
///
/// The bench runs both `git_status_parity` (CLI) and this function
/// (libgit2) on the same fixture so the delta is visible.
pub fn git_status_libgit2_parity(cwd: String) -> Result<GitStatus, String> {
    git_status_libgit2(&cwd)
}

pub fn git_log_parity(
    cwd: String,
    count: Option<i32>,
    all: Option<bool>,
    author: Option<String>,
) -> Result<Vec<GitLogEntry>, String> {
    git_log(cwd, count, all, author)
}

pub fn git_branches_parity(cwd: String) -> Result<Vec<types::GitBranch>, String> {
    commands::ops::git_branches(cwd)
}

// ─── Tauri entry point ─────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Register Cmd+Shift+G (macOS) / Ctrl+Shift+G (Linux/Windows)
            // to bring GitWand to the foreground from anywhere.
            use tauri_plugin_global_shortcut::ShortcutState;
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+G", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    // Show + focus the main window
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    // Emit event so frontend can react (e.g. open folder picker)
                    let _ = handle.emit("global-shortcut-activate", ());
                }
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ops::get_conflicted_files,
            read_file,
            write_file,
            read_file_at_revision,
            folder_diff,
            list_dir,
            git_status,
            git_diff,
            git_log,
            commands::ops::git_stage,
            commands::ops::git_unstage,
            commands::ops::git_stage_patch,
            commands::ops::git_unstage_patch,
            commands::ops::git_commit,
            commands::ops::git_amend_commit,
            commands::ops::git_split_commit,
            commands::ops::git_push,
            commands::ops::git_pull,
            commands::ops::git_fetch,
            commands::ops::git_merge,
            commands::ops::git_merge_abort,
            commands::ops::git_merge_continue,
            git_repo_state,
            commands::ops::git_rebase_action,
            commands::ops::git_discard,
            git_show,
            commands::ops::git_branches,
            commands::ops::git_create_branch,
            commands::ops::git_switch_branch,
            commands::ops::git_delete_branch,
            commands::ops::git_rename_branch,
            commands::ops::git_stash,
            commands::ops::git_stash_pop,
            commands::ops::open_in_editor,
            commands::ops::set_git_config,
            commands::ops::read_gitwandrc,
            preview_merge,
            commands::ops::git_conflict_check,
            commands::ops::git_cherry_pick,
            commands::ops::git_cherry_pick_abort,
            commands::ops::git_cherry_pick_continue,
            commands::ops::git_stash_list,
            commands::ops::git_stash_apply,
            commands::ops::git_stash_drop,
            commands::ops::git_stash_show,
            commands::ops::detect_monorepo,
            commands::ops::git_remote_info,
            commands::gh::gh_list_prs,
            commands::gh::gh_create_pr,
            commands::gh::gh_list_reviewer_candidates,
            commands::gh::gh_checkout_pr,
            commands::gh::gh_merge_pr,
            commands::gh::gh_pr_detail,
            commands::gh::gh_pr_diff,
            commands::gh::gh_pr_checks,
            commands::ops::git_exec,
            commands::ops::git_autocomplete,
            commands::ops::git_get_user,
            commands::ai::detect_claude_cli,
            commands::ai::claude_cli_prompt,
            commands::ai::claude_cli_login,
            commands::ops::git_hook_list,
            commands::ops::git_hook_toggle,
            commands::ops::git_hook_create,
            commands::ops::git_hook_delete,
            commands::ops::shell_exec,
            commands::workspace::workspace_read,
            commands::workspace::workspace_write,
            commands::workspace::workspace_status_all,
            commands::workspace::workspace_fetch_all,
            commands::workspace::workspace_pull_all,
            commands::workspace::workspace_wip_all,
            commands::workspace::workspace_prs_all,
            commands::workspace::workspace_issues_all,
            commands::ops::git_worktree_status_all,
            commands::ops::git_worktree_list,
            commands::ops::git_worktree_add,
            commands::ops::git_worktree_remove,
            commands::ops::git_worktree_prune,
            commands::ops::agent_session_list,
            commands::ops::agent_session_launch,
            commands::ops::git_submodule_list,
            commands::ops::git_submodule_init,
            commands::ops::git_submodule_update,
            commands::ops::git_submodule_add,
            git_file_log,
            git_file_log_pickaxe,
            git_file_log_range,
            git_blame,
            commands::ops::git_checkout_commit,
            commands::ops::git_reset_to_commit,
            commands::ops::git_revert_commit,
            commands::ops::git_create_tag,
            commands::ops::git_list_tags,
            commands::ops::git_delete_tag,
            commands::ops::git_push_tags,
            commands::ops::git_unpushed_tags,
            commands::ops::git_delete_remote_tag,
            commands::ops::git_clone,
            commands::ops::gh_fork,
            commands::ops::git_shortlog,
            commands::ops::gh_current_user,
            commands::ops::pr_files,
            commands::ai::detect_codex_cli,
            commands::ai::codex_cli_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitWand");
}

/// Parse `git status --porcelain` output.
/// Returns (staged_count, unstaged_count, untracked_count).
///
/// P3.3a — No longer called by production code: `workspace_wip_all` now uses
/// `libgit2_wip_status` instead. We keep this parser around because its
/// `#[cfg(test)]` tests below validate the porcelain v1 status XY semantics
/// (a documented invariant) AND because libgit2 may need to be disabled
/// or rolled back in the future, in which case we'd reinstate this path.
/// `dead_code` because cargo's non-test build doesn't see the test callers.
#[allow(dead_code)]
fn parse_wip_status(output: &str) -> (u32, u32, u32) {
    let mut staged = 0u32;
    let mut unstaged = 0u32;
    let mut untracked = 0u32;
    // Note: merge-conflict codes (UU, AA, AU, etc.) have U in X and/or Y positions.
    // Under this classification, they increment both staged and unstaged counts,
    // which is intentional for v1 — the WIP panel shows "activity", not a detailed conflict view.
    // A future iteration may add a dedicated conflict_count field.
    for line in output.lines() {
        if line.len() < 2 {
            continue;
        }
        let x = &line[0..1];
        let y = &line[1..2];
        if x == "?" && y == "?" {
            untracked += 1;
        } else {
            if x != " " && x != "?" && x != "!" {
                staged += 1;
            }
            if y != " " && y != "?" && y != "!" {
                unstaged += 1;
            }
        }
    }
    (staged, unstaged, untracked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_pr_list() {
        let result = parse_gh_pr_json("[]").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_empty_string() {
        let result = parse_gh_pr_json("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_single_basic_pr() {
        let json = r#"[{
          "number": 42,
          "title": "Add feature",
          "state": "OPEN",
          "author": {"login": "alice"},
          "headRefName": "feature/foo",
          "baseRefName": "main",
          "isDraft": false,
          "createdAt": "2026-01-01T00:00:00Z",
          "updatedAt": "2026-01-02T00:00:00Z",
          "url": "https://github.com/org/repo/pull/42",
          "additions": 10,
          "deletions": 3,
          "labels": [{"name": "bug"}],
          "assignees": [{"login": "bob"}],
          "reviewRequests": [{"requestedReviewer": {"login": "carol"}}],
          "reviewDecision": "REVIEW_REQUIRED",
          "mergeStateStatus": "BLOCKED",
          "statusCheckRollup": [{"conclusion": "SUCCESS"}]
        }]"#;
        let prs = parse_gh_pr_json(json).unwrap();
        assert_eq!(prs.len(), 1);
        let pr = &prs[0];
        assert_eq!(pr.number, 42);
        assert_eq!(pr.title, "Add feature");
        assert_eq!(pr.author, "alice");
        assert_eq!(pr.branch, "feature/foo");
        assert_eq!(pr.base, "main");
        assert!(!pr.draft);
        assert_eq!(pr.labels, vec!["bug"]);
        assert_eq!(pr.assignees, vec!["bob"]);
        assert_eq!(pr.review_requested, vec!["carol"]);
        assert_eq!(pr.review_decision, "REVIEW_REQUIRED");
        assert_eq!(pr.merge_state_status, "BLOCKED");
        assert_eq!(pr.checks_rollup, "SUCCESS");
    }

    #[test]
    fn parse_pr_with_braces_in_title_does_not_silently_drop() {
        // Regression test: the old char-scanning parser broke when PR titles
        // or branch names contained '{' or '}', silently producing 0 results.
        let json = r#"[{
          "number": 1,
          "title": "Fix {broken} thing",
          "state": "OPEN",
          "author": {"login": "alice"},
          "headRefName": "fix/{broken}",
          "baseRefName": "main",
          "isDraft": false,
          "createdAt": "2026-01-01T00:00:00Z",
          "updatedAt": "2026-01-01T00:00:00Z",
          "url": "https://github.com/org/repo/pull/1",
          "additions": 1,
          "deletions": 1,
          "labels": [],
          "assignees": [],
          "reviewRequests": [],
          "reviewDecision": null,
          "mergeStateStatus": null,
          "statusCheckRollup": []
        }]"#;
        let prs = parse_gh_pr_json(json).unwrap();
        assert_eq!(prs.len(), 1, "PR with braces in title must not be dropped");
        assert_eq!(prs[0].title, "Fix {broken} thing");
        assert_eq!(prs[0].branch, "fix/{broken}");
        assert_eq!(prs[0].review_decision, "");
        assert_eq!(prs[0].merge_state_status, "");
        assert_eq!(prs[0].checks_rollup, "");
    }

    #[test]
    fn parse_multiple_prs_all_parsed() {
        let json = r#"[
          {"number":1,"title":"A","state":"OPEN","author":{"login":"x"},
           "headRefName":"a","baseRefName":"main","isDraft":false,
           "createdAt":"","updatedAt":"","url":"","additions":0,"deletions":0,
           "labels":[],"assignees":[],"reviewRequests":[],
           "reviewDecision":null,"mergeStateStatus":null,"statusCheckRollup":[]},
          {"number":2,"title":"B","state":"OPEN","author":{"login":"y"},
           "headRefName":"b","baseRefName":"main","isDraft":true,
           "createdAt":"","updatedAt":"","url":"","additions":5,"deletions":2,
           "labels":[{"name":"wip"}],"assignees":[],"reviewRequests":[],
           "reviewDecision":"APPROVED","mergeStateStatus":"CLEAN","statusCheckRollup":[]}
        ]"#;
        let prs = parse_gh_pr_json(json).unwrap();
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].number, 1);
        assert_eq!(prs[1].number, 2);
        assert!(prs[1].draft);
        assert_eq!(prs[1].review_decision, "APPROVED");
    }

    #[test]
    fn wip_status_empty() {
        let (s, u, t) = parse_wip_status("");
        assert_eq!((s, u, t), (0, 0, 0));
    }

    #[test]
    fn wip_status_untracked_only() {
        let out = "?? new_file.rs\n?? another.txt\n";
        let (s, u, t) = parse_wip_status(out);
        assert_eq!(s, 0, "no staged");
        assert_eq!(u, 0, "no unstaged");
        assert_eq!(t, 2, "two untracked");
    }

    #[test]
    fn wip_status_staged_only() {
        // Format: "XY filename" — X=index status, Y=worktree status, space before filename
        // "A " = X=A (added to index), Y=' ' (clean worktree) → staged only
        // "M " = X=M (modified in index), Y=' ' (clean worktree) → staged only
        // The double space: XY + separator space = "A  filename"
        let out = "A  staged_new.rs\nM  staged_mod.rs\n";
        let (s, u, t) = parse_wip_status(out);
        assert_eq!(s, 2, "two staged");
        assert_eq!(u, 0, "no unstaged");
        assert_eq!(t, 0, "no untracked");
    }

    #[test]
    fn wip_status_unstaged_only() {
        // " M" = clean index, modified worktree
        let out = " M worktree_mod.rs\n D deleted_worktree.rs\n";
        let (s, u, t) = parse_wip_status(out);
        assert_eq!(s, 0, "no staged");
        assert_eq!(u, 2, "two unstaged");
        assert_eq!(t, 0, "no untracked");
    }

    #[test]
    fn wip_status_mixed() {
        // MM = both staged and unstaged modifications to same file
        let out = "MM both.rs\nA  staged.rs\n?? untracked.rs\n M unstaged.rs\n";
        let (s, u, t) = parse_wip_status(out);
        // "MM": X=M (staged), Y=M (unstaged)
        // "A ": X=A (staged), Y=' ' (not unstaged)
        // "??": untracked
        // " M": X=' ' (not staged), Y=M (unstaged)
        assert_eq!(s, 2, "MM + A = 2 staged");
        assert_eq!(u, 2, "MM + M = 2 unstaged");
        assert_eq!(t, 1, "one untracked");
    }

    #[test]
    fn wip_status_whitespace_only() {
        // git status --porcelain may emit a trailing newline with no content lines
        let out = "\n";
        let (s, u, t) = parse_wip_status(out);
        assert_eq!((s, u, t), (0, 0, 0), "trailing newline only = empty");
    }

    #[test]
    fn wip_status_conflicts() {
        // Merge-conflict codes (UU, AA, etc.) count in both staged and unstaged
        // because U != ' '/'?'/'!' for both X and Y.
        // This is intentional: conflict files show up as "active" in both dimensions.
        let out = "UU conflict.rs\nAA added_both.rs\n";
        let (s, u, t) = parse_wip_status(out);
        assert_eq!(s, 2, "UU and AA both staged (X = U or A)");
        assert_eq!(u, 2, "UU and AA both unstaged (Y = U or A)");
        assert_eq!(t, 0, "no untracked");
    }

    #[test]
    fn workspace_repo_prs_serializes_camel_case_fields() {
        let item = WorkspaceRepoPrs {
            repo_path: "/path/to/repo".to_string(),
            repo_name: "my-repo".to_string(),
            prs: vec![],
            error: None,
        };
        let json = serde_json::to_string(&item).unwrap();
        // #[serde(rename_all = "camelCase")] must produce camelCase keys
        assert!(json.contains("\"repoPath\""), "repo_path should serialize as repoPath, got: {}", json);
        assert!(json.contains("\"repoName\""), "repo_name should serialize as repoName, got: {}", json);
        assert!(!json.contains("\"repo_path\""), "snake_case must not appear: {}", json);
        assert!(!json.contains("\"repo_name\""), "snake_case must not appear: {}", json);
        assert!(json.contains("\"prs\""), "prs field must appear in JSON, got: {}", json);
    }

    #[test]
    fn workspace_repo_prs_error_serializes() {
        let item = WorkspaceRepoPrs {
            repo_path: "/path".to_string(),
            repo_name: "repo".to_string(),
            prs: vec![],
            error: Some("gh: command not found".to_string()),
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"gh: command not found\""), "error message must appear in JSON");
        // error field itself should be camelCase (it's a single word, stays "error")
        assert!(json.contains("\"error\":\"gh: command not found\""), "error key+value must appear together: {}", json);
    }

    #[test]
    fn parse_empty_issue_list() {
        let result = parse_gh_issue_json("[]").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_empty_issue_string() {
        let result = parse_gh_issue_json("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn parse_single_issue_all_fields() {
        let json = r#"[{
          "number": 7,
          "title": "Fix crash on startup",
          "state": "OPEN",
          "author": {"login": "alice"},
          "assignees": [{"login": "bob"}],
          "labels": [{"name": "bug"}, {"name": "urgent"}],
          "url": "https://github.com/org/repo/issues/7",
          "createdAt": "2026-03-01T10:00:00Z",
          "updatedAt": "2026-03-02T12:00:00Z",
          "milestone": {"title": "v2.9.0"}
        }]"#;
        let issues = parse_gh_issue_json(json).unwrap();
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.number, 7);
        assert_eq!(issue.title, "Fix crash on startup");
        assert_eq!(issue.state, "OPEN");
        assert_eq!(issue.author, "alice");
        assert_eq!(issue.assignees, vec!["bob"]);
        assert_eq!(issue.labels, vec!["bug", "urgent"]);
        assert_eq!(issue.url, "https://github.com/org/repo/issues/7");
        assert_eq!(issue.created_at, "2026-03-01T10:00:00Z");
        assert_eq!(issue.updated_at, "2026-03-02T12:00:00Z");
        assert_eq!(issue.milestone, "v2.9.0");
    }

    #[test]
    fn parse_issue_without_milestone() {
        let json = r#"[{
          "number": 1,
          "title": "Simple issue",
          "state": "OPEN",
          "author": {"login": "alice"},
          "url": "https://github.com/org/repo/issues/1",
          "createdAt": "2026-01-01T00:00:00Z",
          "updatedAt": "2026-01-01T00:00:00Z"
        }]"#;
        let issues = parse_gh_issue_json(json).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].milestone, "", "milestone should be empty string when absent");
        assert!(issues[0].assignees.is_empty());
        assert!(issues[0].labels.is_empty());
    }

    #[test]
    fn test_changed_files_extraction() {
        // Helper that mirrors the changed_files extraction logic in get_workspace_wip
        fn extract(status_out: &str) -> Vec<String> {
            let mut seen = std::collections::HashSet::new();
            for line in status_out.lines() {
                if line.len() < 4 { continue; }
                if &line[0..2] == "??" { continue; }
                let path_part = &line[3..];
                let path = if path_part.contains(" -> ") {
                    path_part.split(" -> ").last().unwrap_or(path_part).trim()
                } else {
                    path_part.trim()
                };
                let path = path.trim_matches('"');
                if !path.is_empty() {
                    seen.insert(path.to_string());
                }
            }
            let mut v: Vec<String> = seen.into_iter().collect();
            v.sort();
            v
        }

        // Normal modified file
        assert_eq!(extract(" M src/main.rs\n"), vec!["src/main.rs"]);

        // Untracked file is skipped
        assert_eq!(extract("?? untracked.rs\n"), Vec::<String>::new());

        // Rename: take the new path
        assert_eq!(extract("R  old.rs -> new.rs\n"), vec!["new.rs"]);

        // File with spaces: quotes stripped
        assert_eq!(extract(" M \"new file.ts\"\n"), vec!["new file.ts"]);

        // Rename with spaces: new path, quotes stripped
        assert_eq!(extract("R  \"old file.ts\" -> \"new file.ts\"\n"), vec!["new file.ts"]);

        // Deduplication
        assert_eq!(
            extract(" M src/auth.ts\nM  src/auth.ts\n"),
            vec!["src/auth.ts"]
        );

        // Mixed: modified + untracked
        assert_eq!(
            extract(" M src/auth.ts\n?? ignored.ts\n"),
            vec!["src/auth.ts"]
        );
    }
}
