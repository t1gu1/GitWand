import { ref, computed } from "vue";
import { workspacePrsAll } from "../utils/backend";
import type { WorkspaceRepoPrs, WorkspaceRepo, PullRequest } from "../utils/backend";
import { useLaunchpadPins } from "./useLaunchpadPins";

export type { WorkspaceRepoPrs };

/** A PR enriched with its repo context (for flat list rendering). */
export interface PrWithRepo extends PullRequest {
  repoName: string;
  repoPath: string;
}

/**
 * Composable for the Launchpad PRs panel.
 * Aggregates open PRs from all repos in a workspace.
 * Each call returns a fresh reactive scope — no shared singleton.
 */
export function useLaunchpadPrs() {
  const repos = ref<WorkspaceRepoPrs[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const { isPinned, isSnoozed } = useLaunchpadPins();

  /** Flat list of all non-snoozed PRs: pinned items first, then by createdAt descending. */
  const allPrs = computed<PrWithRepo[]>(() =>
    repos.value
      .flatMap((r) => r.prs.map((pr) => ({ ...pr, repoName: r.repoName, repoPath: r.repoPath })))
      .filter((pr) => !isSnoozed(pr.url))
      .sort((a, b) => {
        const aPinned = isPinned(a.url) ? 0 : 1;
        const bPinned = isPinned(b.url) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return b.createdAt.localeCompare(a.createdAt);
      })
  );

  /** Flat list of currently-snoozed PRs (hidden from allPrs). */
  const snoozedPrs = computed<PrWithRepo[]>(() =>
    repos.value
      .flatMap((r) => r.prs.map((pr) => ({ ...pr, repoName: r.repoName, repoPath: r.repoPath })))
      .filter((pr) => isSnoozed(pr.url))
  );

  async function refresh(workspaceRepos: WorkspaceRepo[]): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      repos.value = await workspacePrsAll(workspaceRepos);
    } catch (e) {
      error.value = (e as Error).message ?? String(e);
    } finally {
      loading.value = false;
    }
  }

  return { repos, allPrs, snoozedPrs, loading, error, refresh };
}
