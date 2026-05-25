/**
 * computeSyncAction — state machine for the header's Sync split button.
 *
 * Given the three remote-tracking counters from `useGitRepo`
 * (aheadCount, behindCount, needsPublish), returns what the primary
 * button should do/label and which secondary actions should appear
 * in its dropdown.
 *
 * Pure function, no Vue reactivity — callers wrap it in `computed()`.
 *
 * State priority:
 *   1. `publish`   — branch has no upstream (needsPublish wins over everything)
 *   2. `clean`     — ahead=0, behind=0
 *   3. `ahead`     — ahead>0, behind=0
 *   4. `behind`    — ahead=0, behind>0
 *   5. `diverged`  — ahead>0, behind>0
 */

export type SyncState = "publish" | "clean" | "ahead" | "behind" | "diverged";

export type SyncAction =
  | "publish"           // first push with --set-upstream
  | "push"              // push local commits
  | "pull"              // pull (merge) remote commits
  | "sync"              // pull-then-push
  | "fetch"             // fetch only (no local changes)
  | "rebaseOntoRemote"  // rebase current branch onto its remote counterpart
  | "mergeRemote"       // merge remote counterpart into current
  | "forcePush";        // force-push local commits (overwrites remote)

export interface SyncActionItem {
  /** Machine-readable action identifier — maps to a handler in the parent. */
  id: SyncAction;
  /** i18n key for the label. */
  labelKey: string;
}

export interface SyncActionResult {
  state: SyncState;
  /** What the big left button does. */
  primary: SyncActionItem;
  /** Optional params for i18n interpolation (currently only `n` = commit count). */
  primaryLabelParams?: Record<string, string | number>;
  /** What shows up in the chevron dropdown. Empty → render as a plain button, no chevron. */
  dropdown: SyncActionItem[];
}

export interface SyncActionInput {
  aheadCount: number;
  behindCount: number;
  needsPublish: boolean;
  /**
   * Hint from the UI that the user likely wants to overwrite the remote
   * (e.g. just finished a local rebase or reset/undo).
   */
  forcePushPreferred?: boolean;
}

const FETCH_ITEM: SyncActionItem = { id: "fetch", labelKey: "syncAction.fetch" };
const SYNC_ITEM: SyncActionItem = { id: "sync", labelKey: "syncAction.sync" };
const PULL_ITEM: SyncActionItem = { id: "pull", labelKey: "syncAction.pull" };
const REBASE_ONTO_REMOTE_ITEM: SyncActionItem = {
  id: "rebaseOntoRemote",
  labelKey: "syncAction.rebaseOntoRemote",
};
const MERGE_REMOTE_ITEM: SyncActionItem = {
  id: "mergeRemote",
  labelKey: "syncAction.mergeRemote",
};
const FORCE_PUSH_ITEM: SyncActionItem = {
  id: "forcePush",
  labelKey: "syncAction.forcePush",
};

export function computeSyncAction(input: SyncActionInput): SyncActionResult {
  const ahead = Math.max(0, input.aheadCount | 0);
  const behind = Math.max(0, input.behindCount | 0);

  // 1. Publish wins over everything else: if the branch has no upstream,
  //    the only meaningful primary action is to publish it.
  if (input.needsPublish) {
    return {
      state: "publish",
      primary: { id: "publish", labelKey: "syncAction.publish" },
      dropdown: [FETCH_ITEM],
    };
  }

  // 2. Clean: nothing ahead, nothing behind → primary is a no-op-ish "Up to date"
  //    that still triggers a fetch under the hood so the user can refresh
  //    remote state on demand. No dropdown (would be redundant with primary).
  if (ahead === 0 && behind === 0) {
    return {
      state: "clean",
      primary: { id: "fetch", labelKey: "syncAction.upToDate" },
      dropdown: [],
    };
  }

  // 3. Ahead only: primary pushes N commits. Dropdown offers Sync (fetch+push
  //    guard against remote having moved) and Fetch.
  if (ahead > 0 && behind === 0) {
    return {
      state: "ahead",
      primary: {
        id: "push",
        // Pick the singular key when exactly 1 commit to push so the UI can
        // render "Push 1 commit" instead of "Push 1 commits".
        labelKey: ahead === 1 ? "syncAction.pushOne" : "syncAction.pushN",
      },
      primaryLabelParams: { n: ahead },
      dropdown: [SYNC_ITEM, FETCH_ITEM],
    };
  }

  // 4. Behind only: primary pulls N commits.
  //    If forcePushPreferred is true (e.g. after a local reset), primary is Force Push.
  if (ahead === 0 && behind > 0) {
    if (input.forcePushPreferred) {
      return {
        state: "behind",
        primary: { id: "forcePush", labelKey: "syncAction.forcePush" },
        dropdown: [PULL_ITEM, REBASE_ONTO_REMOTE_ITEM, FETCH_ITEM],
      };
    }

    return {
      state: "behind",
      primary: {
        id: "pull",
        labelKey: behind === 1 ? "syncAction.pullOne" : "syncAction.pullN",
      },
      primaryLabelParams: { n: behind },
      dropdown: [SYNC_ITEM, REBASE_ONTO_REMOTE_ITEM, FETCH_ITEM],
    };
  }

  // 5. Diverged: both sides moved.
  //    If forcePushPreferred is true (e.g. after a rebase), primary is Force Push.
  //    Otherwise primary is "Sync" (pull-then-push).
  if (input.forcePushPreferred) {
    return {
      state: "diverged",
      primary: { id: "forcePush", labelKey: "syncAction.forcePush" },
      dropdown: [SYNC_ITEM, REBASE_ONTO_REMOTE_ITEM, MERGE_REMOTE_ITEM, FETCH_ITEM],
    };
  }

  return {
    state: "diverged",
    primary: { id: "sync", labelKey: "syncAction.sync" },
    dropdown: [FORCE_PUSH_ITEM, REBASE_ONTO_REMOTE_ITEM, MERGE_REMOTE_ITEM, FETCH_ITEM],
  };
}
