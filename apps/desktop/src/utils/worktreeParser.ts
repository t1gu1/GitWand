/**
 * Pure TypeScript implementations of the worktree parsing logic.
 *
 * These functions mirror the Rust implementations in
 * `src-tauri/src/commands/ops.rs` (git_worktree_list, git_worktree_status_all)
 * and the Node.js mock in `dev-server.mjs`.
 *
 * Keeping the logic here as pure functions enables:
 *   1. Unit tests that run without Tauri or a real git repo (vitest).
 *   2. A single source of truth for the parser contract shared between
 *      the dev-server mock and the test suite.
 *
 * If you modify the parsing logic in ops.rs, update this file in lockstep.
 */

import type { WorktreeEntry, WorkspaceRepoStatus } from "./backend";

/** Conflict codes as defined in `git status --porcelain` (XY format). */
export const CONFLICT_CODES = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

/**
 * Parse the output of `git worktree list --porcelain` into a list of
 * WorktreeEntry objects.
 *
 * Handles:
 *  - `main` attribute (git ≥ 2.36)
 *  - `locked [reason]` inline reason on the same line
 *  - `prunable [reason]` inline reason on the same line
 *  - `bare` worktrees
 *  - `detached` HEAD
 *  - git < 2.36 fallback: first entry is marked as main when no `main` attr
 *
 * @param raw  Raw stdout from `git worktree list --porcelain`
 */
export function parseWorktreePorcelain(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = {
        path: line.slice("worktree ".length),
        branch: "",
        head: "",
        is_main: false,
        is_locked: false,
        lock_reason: null,
        is_bare: false,
        is_prunable: false,
        prunable_reason: null,
      };
    } else if (current) {
      if (line === "main") {
        current.is_main = true;
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        const full = line.slice("branch ".length);
        current.branch = full.startsWith("refs/heads/") ? full.slice("refs/heads/".length) : full;
      } else if (line === "bare") {
        current.is_bare = true;
      } else if (line.startsWith("locked")) {
        current.is_locked = true;
        const reason = line.slice("locked".length).trim();
        if (reason) current.lock_reason = reason;
      } else if (line.startsWith("prunable")) {
        current.is_prunable = true;
        const reason = line.slice("prunable".length).trim();
        if (reason) current.prunable_reason = reason;
      } else if (line === "detached") {
        current.branch = "(detached HEAD)";
      }
    }
  }
  if (current) entries.push(current);

  // git < 2.36 fallback: if no entry has the `main` attribute, mark the first.
  if (entries.length > 0 && entries.every((e) => !e.is_main)) {
    entries[0].is_main = true;
  }

  return entries;
}

/**
 * Parse `git status --porcelain --untracked-files=no` output lines into
 * separate `conflicted` and `modified` counts.
 *
 * Rules:
 *  - Lines with XY in CONFLICT_CODES → conflicted (UU, AA, DD, AU, UA, DU, UD)
 *  - All other non-empty lines → modified
 *  - Empty lines are ignored
 *
 * @param raw  Raw stdout from `git status --porcelain --untracked-files=no`
 */
export function parseWorktreeStatus(raw: string): { conflicted: number; modified: number } {
  const lines = raw.split("\n").filter(Boolean);
  let conflicted = 0;
  let modified = 0;
  for (const line of lines) {
    if (line.length >= 2 && CONFLICT_CODES.has(line.slice(0, 2))) {
      conflicted++;
    } else {
      modified++;
    }
  }
  return { conflicted, modified };
}

/**
 * Derive a quick-create worktree path from the main worktree path + task name.
 * Mirrors the `deriveQuickPath` function in WorktreeManager.vue.
 *
 * @param mainPath  Absolute path of the main worktree
 * @param name      Task name (e.g. "fix/login-bug")
 */
export function deriveQuickWorktreePath(mainPath: string, name: string): string {
  const base = mainPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  return `${base}-${slug}`;
}

/**
 * Given a list of WorktreeEntry, determine if any are prunable.
 * Mirrors the `hasPrunableWorktrees` computed in WorktreeManager.vue.
 */
export function hasPrunableWorktrees(entries: WorktreeEntry[]): boolean {
  return entries.some((e) => e.is_prunable);
}

/**
 * Build a WorkspaceRepoStatus object from parsed status data.
 * Used by the dev-server mock and tests to keep field shapes consistent.
 */
export function buildWorktreeStatus(
  path: string,
  branch: string,
  ahead: number,
  behind: number,
  hasUpstream: boolean,
  conflicted: number,
  modified: number,
  error: string | null = null,
): WorkspaceRepoStatus {
  return {
    path,
    name: branch,
    branch,
    ahead,
    behind,
    has_upstream: hasUpstream,
    modified,
    conflicted,
    error,
  };
}
