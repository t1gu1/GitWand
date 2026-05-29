/**
 * useLaunchpadNotifications — diff-snapshot layer for PR activity (v2.16).
 *
 * Module-level singleton. Between two Launchpad poller ticks it compares the
 * previous PR snapshot with the new one and emits typed activity events —
 * with ZERO additional network requests (it consumes the data the poller
 * already fetched via the enriched `workspace_prs_all`).
 *
 * Comparison keys per PR (by `url`):
 *   - `state`         → merged/closed (PR drops out of the open list)
 *   - `checksRollup`  → CI flip (→ SUCCESS / FAILURE)
 *   - `reviewRequested` (set) → new review request
 *   - `reviewDecision` → APPROVED / CHANGES_REQUESTED
 *   - `commentCount`  → new comment
 *   - first-time URL  → new PR
 *
 * Boot behaviour: the very first `diff()` only seeds the snapshot and returns
 * `[]`, so reopening the app doesn't fire a burst of stale notifications.
 *
 * Filtering by level / "by people" (bots) is the consumer's job — `diff()`
 * stays pure and emits every event. `isBotAuthor()` is exported as the helper
 * the consumer uses for the "by people" gate.
 */

import type { PrWithRepo } from "./useLaunchpadPrs";

export type LaunchpadEventKind =
  | "new-pr"
  | "closed" // PR left the open list (merged or closed)
  | "ci-flip"
  | "review-requested"
  | "review-decided"
  | "new-comment";

export interface LaunchpadEvent {
  kind: LaunchpadEventKind;
  prUrl: string;
  prNumber: number;
  prTitle: string;
  repoName: string;
  /** PR author login — used by the consumer's "by people" (bot) filter. */
  author: string;
  /** Extra context for the body, e.g. "FAILURE", a reviewer login. */
  detail?: string;
}

interface PrSnapshot {
  state: string;
  checksRollup: string;
  reviewDecision: string;
  reviewRequested: string[];
  commentCount: number;
  number: number;
  title: string;
  repoName: string;
  author: string;
}

// ── Module-level singleton state ───────────────────────────────────
let _snapshot: Map<string, PrSnapshot> | null = null;

const BOT_LOGINS = new Set([
  "github-actions",
  "github-actions[bot]",
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "codecov",
  "codecov[bot]",
]);

/** True when the author looks like an automation account (for "by people"). */
export function isBotAuthor(author: string): boolean {
  if (!author) return false;
  const a = author.toLowerCase();
  return a.endsWith("[bot]") || BOT_LOGINS.has(a);
}

/** CI rollup values we treat as terminal (worth flipping on). */
function isTerminalCi(rollup: string): boolean {
  return rollup === "SUCCESS" || rollup === "FAILURE";
}

function toSnapshot(pr: PrWithRepo): PrSnapshot {
  return {
    state: pr.state,
    checksRollup: pr.checksRollup ?? "",
    reviewDecision: pr.reviewDecision ?? "",
    reviewRequested: pr.reviewRequested ?? [],
    commentCount: pr.commentCount ?? 0,
    number: pr.number,
    title: pr.title,
    repoName: pr.repoName,
    author: pr.author,
  };
}

/**
 * Compare the incoming PR list against the stored snapshot, return the new
 * activity events, and update the snapshot in place.
 *
 * @param prs  the latest enriched PR list (from the poller refresh)
 * @returns    events since the previous diff (empty on the first call)
 */
export function diffLaunchpad(prs: PrWithRepo[]): LaunchpadEvent[] {
  const next = new Map<string, PrSnapshot>();
  for (const pr of prs) next.set(pr.url, toSnapshot(pr));

  // First run: seed the snapshot, emit nothing (avoid a boot burst).
  if (_snapshot === null) {
    _snapshot = next;
    return [];
  }

  const prev = _snapshot;
  const events: LaunchpadEvent[] = [];

  const base = (s: PrSnapshot, kind: LaunchpadEventKind, url: string, detail?: string): LaunchpadEvent => ({
    kind,
    prUrl: url,
    prNumber: s.number,
    prTitle: s.title,
    repoName: s.repoName,
    author: s.author,
    detail,
  });

  // New / changed PRs.
  for (const [url, cur] of next) {
    const old = prev.get(url);

    if (!old) {
      events.push(base(cur, "new-pr", url));
      continue;
    }

    // CI flip — only when the new rollup is terminal and actually changed.
    if (cur.checksRollup !== old.checksRollup && isTerminalCi(cur.checksRollup)) {
      events.push(base(cur, "ci-flip", url, cur.checksRollup));
    }

    // New review request — a reviewer login that wasn't requested before.
    const oldReviewers = new Set(old.reviewRequested);
    const added = cur.reviewRequested.filter((r) => !oldReviewers.has(r));
    if (added.length > 0) {
      events.push(base(cur, "review-requested", url, added.join(", ")));
    }

    // Review decision landed (or changed) to a meaningful verdict.
    if (
      cur.reviewDecision !== old.reviewDecision &&
      (cur.reviewDecision === "APPROVED" || cur.reviewDecision === "CHANGES_REQUESTED")
    ) {
      events.push(base(cur, "review-decided", url, cur.reviewDecision));
    }

    // New comment(s).
    if (cur.commentCount > old.commentCount) {
      events.push(base(cur, "new-comment", url, String(cur.commentCount - old.commentCount)));
    }
  }

  // PRs that left the open list → merged or closed.
  for (const [url, old] of prev) {
    if (!next.has(url)) {
      events.push(base(old, "closed", url));
    }
  }

  _snapshot = next;
  return events;
}

/** Test/reset hook — clears the snapshot so the next diff seeds fresh. */
export function _resetLaunchpadSnapshot(): void {
  _snapshot = null;
}
