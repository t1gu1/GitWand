import { ref, computed } from "vue";
import { getGitShow, gitSplitCommit, type GitDiff } from "../utils/backend";
import { buildPatch, type LineSelection } from "../utils/patchBuilder";

/**
 * Orchestrates the "Split commit" workflow:
 *
 *  1. User picks a commit to split — either HEAD directly (via the commit-log
 *     context menu) or a past commit via the interactive rebase `split` action,
 *     which internally schedules `edit` and lands us at a rebase edit-stop with
 *     HEAD at the target commit.
 *  2. We fetch the commit's diffs (one `GitDiff` per file) via `git show`.
 *  3. The modal shows the diffs with per-hunk / per-line selection. The user
 *     picks which hunks land in commit A (the new parent) and writes two
 *     commit messages — A is empty by default, B is pre-filled with the
 *     original commit message + body.
 *  4. On confirm, we build a combined unified patch from the selections
 *     (one `buildPatch` call per file, concatenated) and call `gitSplitCommit`,
 *     which sequences `reset --mixed HEAD^` → `apply --cached patchA` → commit A
 *     → `add -A .` → commit B. On failure the backend rolls back to the
 *     original HEAD, so the user sees either the new split or the original.
 *
 * In the rebase-edit-stop flow the caller is responsible for running
 * `git rebase --continue` after a successful split — the composable only
 * performs the split itself; the surrounding rebase state is preserved.
 */

/** Minimal shape of a commit entry this composable needs. */
export interface SplittableCommit {
  /** Short or full hash — only used for logging / fetching diffs. */
  hash: string;
  /** Commit subject, used to pre-fill commit B's message. */
  message: string;
  /** Commit body (may be empty), appended to message for commit B. */
  body?: string;
}

/** Per-file selection state: filePath → LineSelection (hunkIdx → Set<lineIdx>). */
export type FileSelections = Map<string, LineSelection>;

/**
 * Optional post-split hook. When the split succeeds, the composable invokes
 * this callback *after* closing the modal and resetting its own state. It's
 * how the rebase edit-stop flow chains `git rebase --continue` automatically
 * — the log-context-menu flow just leaves it undefined.
 */
export type AfterSplitCallback = (hashes: {
  firstHash: string;
  secondHash: string;
}) => void | Promise<void>;

const open = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

const cwd = ref<string | null>(null);
const commit = ref<SplittableCommit | null>(null);
const diffs = ref<GitDiff[]>([]);
let afterSplitCb: AfterSplitCallback | null = null;

/** Pre-filled message for commit B (original commit message + body). */
const originalMessage = computed(() => {
  if (!commit.value) return "";
  const subject = commit.value.message ?? "";
  const body = commit.value.body?.trim() ?? "";
  return body ? `${subject}\n\n${body}` : subject;
});

/**
 * True when the composable is asked to confirm the split. Callers typically
 * disable their UI while this is true.
 */
const busy = computed(() => loading.value);

export function useSplitCommit() {
  /**
   * Open the modal for the given commit. Must be called with a commit that is
   * currently at HEAD — either because it literally is HEAD, or because we're
   * in a rebase edit-stop where HEAD has been set to the commit being edited.
   * The caller is responsible for this precondition; the backend verifies the
   * working tree is clean and refuses otherwise.
   */
  async function openFor(
    repoCwd: string,
    targetCommit: SplittableCommit,
    onAfterSplit?: AfterSplitCallback,
  ): Promise<void> {
    cwd.value = repoCwd;
    commit.value = targetCommit;
    diffs.value = [];
    error.value = null;
    loading.value = true;
    open.value = true;
    afterSplitCb = onAfterSplit ?? null;
    try {
      diffs.value = await getGitShow(repoCwd, targetCommit.hash);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Cancel without doing anything. Resets all state. */
  function cancel(): void {
    open.value = false;
    cwd.value = null;
    commit.value = null;
    diffs.value = [];
    error.value = null;
    loading.value = false;
    // Drop the after-split hook — cancel means we are *not* continuing.
    afterSplitCb = null;
  }

  /**
   * Confirm the split. Builds one partial patch per file from the caller's
   * selection map, concatenates them into a single unified patch string, and
   * calls `gitSplitCommit`. On success, the modal closes and the caller should
   * refresh its log view (and, when in a rebase context, run `rebase --continue`).
   *
   * @returns resolved hashes on success, or throws on failure (with backend error message).
   */
  async function confirm(
    selections: FileSelections,
    firstMessage: string,
    secondMessage: string,
  ): Promise<{ firstHash: string; secondHash: string }> {
    if (!cwd.value) throw new Error("No repository open");
    if (diffs.value.length === 0) throw new Error("Nothing to split");
    if (!firstMessage.trim()) throw new Error("First commit message is required");
    if (!secondMessage.trim()) throw new Error("Second commit message is required");

    // Build combined patch: one buildPatch() per file, concatenated. Each
    // partial patch carries its own `diff --git` header so direct concat works.
    const patchParts: string[] = [];
    for (const diff of diffs.value) {
      const sel = selections.get(diff.path);
      if (!sel || sel.size === 0) continue;
      const patch = buildPatch(diff, sel);
      if (patch) patchParts.push(patch);
    }

    if (patchParts.length === 0) {
      throw new Error("Select at least one hunk for the first commit");
    }

    // At least one hunk must remain for the SECOND commit too — otherwise the
    // second commit would be empty and git would refuse it. The check is
    // approximate: we compare selected change-line count to total change-line
    // count across all files.
    let totalChangeLines = 0;
    let selectedChangeLines = 0;
    for (const diff of diffs.value) {
      for (let hunkIdx = 0; hunkIdx < diff.hunks.length; hunkIdx++) {
        const hunk = diff.hunks[hunkIdx];
        for (let lineIdx = 0; lineIdx < hunk.lines.length; lineIdx++) {
          if (hunk.lines[lineIdx].type === "context") continue;
          totalChangeLines++;
          if (selections.get(diff.path)?.get(hunkIdx)?.has(lineIdx)) {
            selectedChangeLines++;
          }
        }
      }
    }
    if (selectedChangeLines >= totalChangeLines) {
      throw new Error(
        "Leave at least one hunk unselected — the second commit would be empty",
      );
    }

    const combinedPatch = patchParts.join("\n");

    loading.value = true;
    error.value = null;
    try {
      const result = await gitSplitCommit(
        cwd.value,
        combinedPatch,
        firstMessage,
        secondMessage,
      );
      open.value = false;
      cwd.value = null;
      commit.value = null;
      diffs.value = [];
      // Fire the post-split hook (e.g. auto-continue a rebase) *after* we've
      // cleared our own state, so if the hook itself triggers UI updates
      // (like re-detecting rebase progress) it sees a consistent world.
      const hook = afterSplitCb;
      afterSplitCb = null;
      if (hook) {
        try {
          await hook(result);
        } catch (hookErr) {
          // Don't leak hook errors into the split-commit error channel —
          // the split itself succeeded. Best-effort log only.
          // eslint-disable-next-line no-console
          console.error("useSplitCommit afterSplit hook failed", hookErr);
        }
      }
      return result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  return {
    open,
    loading,
    busy,
    error,
    cwd,
    commit,
    diffs,
    originalMessage,
    openFor,
    cancel,
    confirm,
  };
}
