//! Scratch worktree commands (v2.20.0).
//!
//! A "scratch worktree" is a temporary, isolated git worktree
//! (`gitwand-scratch-<timestamp>`) created as a sibling of the repo so the user
//! can resolve conflicts without touching the active checkout, then bring the
//! result back in one click — with automatic cleanup on merge-back or discard.
//!
//! Builds on the existing worktree plumbing in `commands::ops`
//! (`git_worktree_add` / `git_worktree_remove` / `git_worktree_prune`).
//!
//! Security: every user-supplied path MUST go through `safe_repo_path()` and
//! every git invocation MUST pass discrete `.args([...])` — never string
//! interpolation (see AGENTS.md).
//!
//! NOTE: these are scaffolding stubs for the v2.20.0 design spec
//! (`docs/superpowers/specs/2026-06-16-v2.20.0-scratch-worktree-design.md`).
//! Bodies are filled in during the implementation phase.

use crate::types::ScratchWorktree;

/// Create `gitwand-scratch-<timestamp>` as a sibling worktree based on
/// `source_branch` (defaults to the current HEAD when `None`). Does NOT touch
/// the active checkout. Returns the created scratch descriptor.
#[tauri::command]
pub(crate) async fn scratch_worktree_create(
    cwd: String,
    source_branch: Option<String>,
) -> Result<ScratchWorktree, String> {
    let _ = (cwd, source_branch);
    Err("scratch_worktree_create not implemented (v2.20.0)".into())
}

/// Bring the resolved changes from the scratch worktree back into the main
/// checkout in one operation, then remove + prune the scratch.
///
/// Guard (impl phase): refuse merge-back if the main checkout has conflicting
/// uncommitted changes.
#[tauri::command]
pub(crate) async fn scratch_worktree_merge_back(
    cwd: String,
    scratch_path: String,
) -> Result<(), String> {
    let _ = (cwd, scratch_path);
    Err("scratch_worktree_merge_back not implemented (v2.20.0)".into())
}

/// Abandon the scratch worktree: `git worktree remove --force` + `git worktree
/// prune`. Leaves no dangling worktree registration.
#[tauri::command]
pub(crate) async fn scratch_worktree_discard(
    cwd: String,
    scratch_path: String,
) -> Result<(), String> {
    let _ = (cwd, scratch_path);
    Err("scratch_worktree_discard not implemented (v2.20.0)".into())
}
