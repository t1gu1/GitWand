/**
 * useRepoPoller — Consolidated git poll manager (§2.1).
 *
 * Replaces 5 independent setInterval calls (pollStatus 2s, fetchRemote 30s,
 * refreshRepoState 3s, autoResolve 5s, nightlyPull 60s) with a single 2s
 * interval that orchestrates all of them.
 *
 * Design:
 *   - One setInterval at POLL_INTERVAL
 *   - Lightweight git status --porcelain --branch every tick
 *   - Expensive ops (fetch, full status parse) only when porcelain output changes
 *   - Visibility-aware: pauses on document.hidden, resumes + eager check on return
 *   - Tick counters for 30s (fetch) and 60s (nightly pull) intervals
 *   - Derived conflict detection from porcelain output (replaces autoResolve's
 *     separate getGitStatus call)
 *
 * Usage in App.vue:
 *   const poller = useRepoPoller({
 *     onStatusChange: async (cwd) => {
 *       await repo.loadStatus(cwd);
 *       if (repo.selectedFilePath.value) await repo.loadDiff(...);
 *     },
 *     onConflictDetected: async (cwd) => { ... },
 *     onFetchTick: async (cwd) => { ... },
 *     onNightlyTick: async () => { ... },
 *   });
 *   watch(repoFolderPath, (p) => poller.setFolderPath(p));
 */

import { onUnmounted } from "vue";
import { gitExec } from "../utils/backend";

// ─── Constants ───────────────────────────────────────────────

/** Base polling interval (2 s). */
const POLL_INTERVAL = 2_000;
/** How many ticks between background fetches (~30 s). */
const FETCH_EVERY_TICKS = 15;
/** How many ticks between nightly-pull checks (~60 s). */
const NP_EVERY_TICKS = 30;
/** How many ticks between connectivity probes (~30 s — F1 Mode hors-ligne). */
const CONNECTIVITY_EVERY_TICKS = 15;

// ─── Public interface ───────────────────────────────────────

export interface RepoPollerActions {
  /** Called when porcelain output changed → consumer should reload full status. */
  onStatusChange: (cwd: string) => Promise<void>;
  /**
   * Called on the rising edge of conflict detection (porcelain went from
   * no `UU` entries to at least one). Replaces autoResolve's standalone
   * poll — the consumer should check settings before acting.
   */
  onConflictDetected: (cwd: string) => Promise<void>;
  /** Called every ~30 s for background fetch + subsequent status refresh. */
  onFetchTick: (cwd: string) => Promise<void>;
  /** Called every ~60 s to check nightly-pull schedule. */
  onNightlyTick: () => Promise<void>;
  /**
   * Called every ~30 s with the active repo path so the connectivity probe
   * can decide whether to flip the app into offline mode (F1).
   * Optional — callers that don't care about connectivity can omit it.
   */
  onConnectivityTick?: (cwd: string) => Promise<void>;
}

// ─── Composable ─────────────────────────────────────────────

export function useRepoPoller(actions: RepoPollerActions) {
  let _folderPath: string | null = null;
  let _interval: ReturnType<typeof setInterval> | null = null;
  let _tick = 0;
  let _porcelainSnapshot = "";
  let _conflictWasPresent = false;
  let _visibilityHandler: (() => void) | null = null;

  // ── Visibility ────────────────────────────────────────────
  function isHidden(): boolean {
    return typeof document !== "undefined" && document.hidden;
  }

  function handleVisibilityChange() {
    if (!_folderPath) return;
    if (document.hidden) {
      stopPolling();
    } else {
      startPolling();
      void tick(true);
    }
  }

  // ── Single tick ───────────────────────────────────────────
  async function tick(eager = false) {
    const cwd = _folderPath;
    if (!cwd) return;
    if (!eager && isHidden()) return;

    _tick++;

    // 1. Lightweight porcelain check every tick
    try {
      const result = await gitExec(cwd, ["status", "--porcelain", "--branch"]);
      if (result.exitCode !== 0) return;
      const snapshot = result.stdout ?? "";

      if (snapshot !== _porcelainSnapshot) {
        _porcelainSnapshot = snapshot;
        await actions.onStatusChange(cwd);

        // Conflict detection on rising edge (UU → unresolved)
        const hasConflicts = snapshot
          .split("\n")
          .some((l) => l.startsWith("UU "));
        if (hasConflicts && !_conflictWasPresent) {
          _conflictWasPresent = true;
          await actions.onConflictDetected(cwd);
        } else if (!hasConflicts) {
          _conflictWasPresent = false;
        }
      }
    } catch {
      // polling errors are non-critical — silent
    }

    // 2. Background fetch every ~30 s
    if (_tick % FETCH_EVERY_TICKS === 0) {
      await actions.onFetchTick(cwd).catch(() => {});
    }

    // 3. Nightly-pull schedule check every ~60 s
    if (_tick % NP_EVERY_TICKS === 0) {
      await actions.onNightlyTick().catch(() => {});
    }

    // 4. Connectivity probe every ~30 s (F1 — Mode hors-ligne).
    //    Reuses this poller's clock so we don't add a 3rd setInterval —
    //    see `feedback_gitwand_polling_discipline` in MEMORY.md.
    if (
      actions.onConnectivityTick &&
      _tick % CONNECTIVITY_EVERY_TICKS === 0
    ) {
      await actions.onConnectivityTick(cwd).catch(() => {});
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────

  function startPolling() {
    if (_interval) return;
    _interval = setInterval(() => void tick(), POLL_INTERVAL);
  }

  function stopPolling() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  /**
   * Set (or clear) the tracked repo folder. When switching to a new repo,
   * internal state is reset and an eager tick fires immediately.
   * Pass `null` to stop all polling.
   */
  function setFolderPath(path: string | null) {
    if (path === _folderPath) return;
    _folderPath = path;
    if (path) {
      _porcelainSnapshot = "";
      _conflictWasPresent = false;
      _tick = 0;
      startPolling();
      void tick(true);
    } else {
      stopPolling();
    }
  }

  // Visibility listener (single, shared)
  if (typeof document !== "undefined") {
    _visibilityHandler = handleVisibilityChange;
    document.addEventListener("visibilitychange", _visibilityHandler);
  }

  onUnmounted(() => {
    stopPolling();
    if (typeof document !== "undefined" && _visibilityHandler) {
      document.removeEventListener("visibilitychange", _visibilityHandler);
    }
  });

  return { setFolderPath, startPolling, stopPolling };
}

// ─── Internal ─────────────────────────────────────────────

/**
 * Parse porcelain output to determine if unresolved conflicts exist.
 * In --porcelain mode, unmerged paths show as `UU ` (both sides modified),
 * or `AA ` / `DD `, but `UU ` covers the common case.
 */
function hasConflictMarkers(porcelain: string): boolean {
  return porcelain.split("\n").some((l) => l.startsWith("UU "));
}
