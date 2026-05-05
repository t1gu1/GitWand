import { ref, computed } from "vue";
import { workspacePrsAll } from "../utils/backend";
import type { WorkspaceRepoPrs, WorkspaceRepo, PullRequest } from "../utils/backend";

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

  /** Flat list of all PRs with repo context, sorted newest first. */
  const allPrs = computed<PrWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.prs.map((pr) => ({ ...pr, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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

  return { repos, allPrs, loading, error, refresh };
}
