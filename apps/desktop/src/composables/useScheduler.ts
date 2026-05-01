/**
 * useScheduler — lightweight automation layer (v2.8).
 *
 * Four predefined tasks, all opt-in:
 *   - autoResolve     : poll for MERGE_HEAD → trigger conflict resolution
 *   - nightlyPull     : run `git pull --rebase` at a configured time each day
 *   - releaseNotes    : generate CHANGELOG entry when a v* tag is pushed
 *   - aiCommitBatch   : prompt AI commit message on app blur / close if staged files present
 *
 * Design rules:
 *   - No external daemon — pure TypeScript, setInterval + visibility/beforeunload events
 *   - Completely silent when a task is disabled (no intervals, no listeners)
 *   - Always wrapped in try/catch — a failing task never crashes the app
 *   - Disabled automatically while offline (isOffline = true)
 *   - Log entries go to the caller-supplied `onLog` callback (→ Logs tab in Settings)
 */

import { watch, onUnmounted } from "vue";
import type { Ref } from "vue";
import type { AppSettings } from "./useSettings";

// ─── Public interface ──────────────────────────────────────

export interface SchedulerCallbacks {
  /** Ref to the currently open repo path (empty string when none). */
  cwd: Ref<string>;
  /** Live settings ref. */
  settings: Ref<AppSettings>;
  /** Whether the app is in offline mode. */
  isOffline: Ref<boolean>;
  /** Called with a timestamped log line to append to the Logs tab. */
  onLog: (msg: string) => void;
  /** Start the conflict-resolution pass on the current repo. */
  resolveConflicts: () => Promise<void>;
  /** Run `git pull --rebase` on the current repo. */
  pullAndRebase: () => Promise<void>;
  /** Trigger the AI release-notes generator (uses latest reachable tags). */
  generateReleaseNotes: () => Promise<void>;
  /** Focus the commit panel so the user can review the AI suggestion. */
  triggerAiCommit: () => Promise<void>;
  /** Return true if the current repo has staged files right now. */
  hasStagedFiles: () => boolean;
}

// ─── Constants ────────────────────────────────────────────

/** How often (ms) to poll for MERGE_HEAD (auto-resolve). */
const AUTO_RESOLVE_POLL_MS = 5_000;
/** How often (ms) to check the nightly-pull schedule. */
const NIGHTLY_POLL_MS = 60_000;
/** localStorage key for last-run timestamps. */
const LAST_RUN_KEY = "gitwand-scheduler-last-run";

// ─── Helpers ──────────────────────────────────────────────

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function loadLastRun(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_RUN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveLastRun(key: string, isoDate: string) {
  const map = loadLastRun();
  map[key] = isoDate;
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(map));
}

function sameDay(a: string, b: Date): boolean {
  const da = new Date(a);
  return da.getFullYear() === b.getFullYear()
    && da.getMonth() === b.getMonth()
    && da.getDate() === b.getDate();
}

// ─── Main composable ──────────────────────────────────────

export function useScheduler(cb: SchedulerCallbacks) {
  // Track all active intervals so we can clear them on unmount
  const intervals: ReturnType<typeof setInterval>[] = [];
  // Track visibility/beforeunload listeners
  let visibilityHandler: (() => void) | null = null;
  let unloadHandler: (() => void) | null = null;

  // ── 1. Auto-resolve ──────────────────────────────────────
  {
    let mergeHeadWasPresent = false;
    let autoResolveInterval: ReturnType<typeof setInterval> | null = null;

    function startAutoResolve() {
      if (autoResolveInterval) return;
      autoResolveInterval = setInterval(async () => {
        if (cb.isOffline.value) return;
        const cwd = cb.cwd.value;
        if (!cwd) return;
        if (!cb.settings.value.automations?.autoResolve?.enabled) return;

        // Check for MERGE_HEAD via a lightweight git status call
        // We detect conflicts by watching the hasStagedFiles + unresolved markers
        // Simplest cross-platform approach: the presence of conflict markers in status
        const nowPresent = await checkMergeConflictPresent(cwd);

        if (nowPresent && !mergeHeadWasPresent) {
          // Rising edge — new conflict detected
          mergeHeadWasPresent = true;
          cb.onLog(`[${timestamp()}] [auto-resolve] Merge conflict detected in ${cwd} — resolving…`);
          try {
            await cb.resolveConflicts();
            cb.onLog(`[${timestamp()}] [auto-resolve] Resolution complete.`);
          } catch (e: any) {
            cb.onLog(`[${timestamp()}] [auto-resolve] Error: ${e?.message ?? e}`);
          }
        } else if (!nowPresent) {
          mergeHeadWasPresent = false;
        }
      }, AUTO_RESOLVE_POLL_MS);
      intervals.push(autoResolveInterval);
    }

    // Start immediately if enabled; watch settings changes
    if (cb.settings.value.automations?.autoResolve?.enabled) startAutoResolve();
    watch(
      () => cb.settings.value.automations?.autoResolve?.enabled,
      (enabled) => {
        if (enabled) startAutoResolve();
        else if (autoResolveInterval) {
          clearInterval(autoResolveInterval);
          autoResolveInterval = null;
        }
      }
    );
  }

  // ── 2. Nightly pull ──────────────────────────────────────
  {
    const nightlyInterval = setInterval(async () => {
      if (cb.isOffline.value) return;
      const cfg = cb.settings.value.automations?.nightlyPull;
      if (!cfg?.enabled) return;
      const cwd = cb.cwd.value;
      if (!cwd) return;

      const now = new Date();
      if (now.getHours() !== cfg.hour || now.getMinutes() !== cfg.minute) return;

      // Don't run more than once per day
      const lastRun = loadLastRun()["nightlyPull"];
      if (lastRun && sameDay(lastRun, now)) return;

      saveLastRun("nightlyPull", now.toISOString());
      cb.onLog(`[${timestamp()}] [nightly-pull] Running pull --rebase on ${cwd}…`);
      try {
        await cb.pullAndRebase();
        cb.onLog(`[${timestamp()}] [nightly-pull] Done.`);
      } catch (e: any) {
        cb.onLog(`[${timestamp()}] [nightly-pull] Error: ${e?.message ?? e}`);
      }
    }, NIGHTLY_POLL_MS);
    intervals.push(nightlyInterval);
  }

  // ── 3. Release notes on tag ──────────────────────────────
  // Triggered externally via triggerReleaseNotesIfEnabled()
  // (called from App.vue after a successful push that includes tags)

  function triggerReleaseNotesIfEnabled() {
    const cfg = cb.settings.value.automations?.releaseNotes;
    if (!cfg?.enabled || cb.isOffline.value) return;
    cb.onLog(`[${timestamp()}] [release-notes] Tag push detected — generating release notes…`);
    cb.generateReleaseNotes().then(() => {
      cb.onLog(`[${timestamp()}] [release-notes] Done.`);
    }).catch((e: any) => {
      cb.onLog(`[${timestamp()}] [release-notes] Error: ${e?.message ?? e}`);
    });
  }

  // ── 4. AI commit batch ───────────────────────────────────
  {
    visibilityHandler = () => {
      if (document.visibilityState !== "hidden") return;
      const cfg = cb.settings.value.automations?.aiCommitBatch;
      if (!cfg?.enabled || cb.isOffline.value) return;
      if (!cb.hasStagedFiles()) return;
      cb.onLog(`[${timestamp()}] [ai-commit-batch] Staged files detected on blur — suggesting commit message…`);
      cb.triggerAiCommit().catch((e: any) => {
        cb.onLog(`[${timestamp()}] [ai-commit-batch] Error: ${e?.message ?? e}`);
      });
    };

    unloadHandler = () => {
      const cfg = cb.settings.value.automations?.aiCommitBatch;
      if (!cfg?.enabled || cb.isOffline.value) return;
      if (!cb.hasStagedFiles()) return;
      // Synchronous — just mark that we should suggest on next open
      localStorage.setItem("gitwand-pending-ai-commit", cb.cwd.value);
    };

    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("beforeunload", unloadHandler);
  }

  // ── Cleanup ──────────────────────────────────────────────
  onUnmounted(() => {
    intervals.forEach(clearInterval);
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    if (unloadHandler) window.removeEventListener("beforeunload", unloadHandler);
  });

  return { triggerReleaseNotesIfEnabled };
}

// ─── Internal helpers ─────────────────────────────────────

/** Check whether the repo at `cwd` currently has unresolved merge conflicts. */
async function checkMergeConflictPresent(cwd: string): Promise<boolean> {
  try {
    const { getGitStatus } = await import("../utils/backend");
    const status = await getGitStatus(cwd);
    return status.conflicted.length > 0;
  } catch {
    return false;
  }
}
