import type { GitBranch } from "./backend";

/** Branch names treated as "main" for sort priority. */
const MAIN_NAMES = ["main", "master"];

/**
 * Canonical branch ordering, shared by every branch list in the app (header
 * branch selector, merge picker, rebase base picker) so they stay consistent:
 *   1. current branch first
 *   2. then main/master
 *   3. then most-recently-committed (lastCommitDate desc)
 *   4. then name (localeCompare)
 */
export function branchSort(a: GitBranch, b: GitBranch): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  const aName = a.name.replace(/^origin\//, "").toLowerCase();
  const bName = b.name.replace(/^origin\//, "").toLowerCase();
  const aMain = MAIN_NAMES.includes(aName) ? 0 : 1;
  const bMain = MAIN_NAMES.includes(bName) ? 0 : 1;
  if (aMain !== bMain) return aMain - bMain;
  if (a.lastCommitDate && b.lastCommitDate) {
    const da = new Date(a.lastCommitDate).getTime();
    const db = new Date(b.lastCommitDate).getTime();
    if (da !== db) return db - da;
  }
  return a.name.localeCompare(b.name);
}
