import { ref, computed } from "vue";
import { workspaceIssuesAll } from "../utils/backend";
import type { WorkspaceRepoIssues, WorkspaceRepo, Issue } from "../utils/backend";

export type { WorkspaceRepoIssues };

/** Valid filter values for the Issues tab. */
export type IssueFilter = "" | "assigned" | "mentioned" | "created";

/** An issue enriched with its repo context (for flat list rendering). */
export interface IssueWithRepo extends Issue {
  repoName: string;
  repoPath: string;
}

/**
 * Composable for the Launchpad Issues panel.
 * Aggregates open GitHub Issues from all repos in a workspace.
 * Each call returns a fresh reactive scope — no shared singleton.
 */
export function useLaunchpadIssues() {
  const repos = ref<WorkspaceRepoIssues[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Currently active filter. Defaults to "assigned". Change before calling refresh(). */
  const activeFilter = ref<IssueFilter>("assigned");

  /** Flat list of all issues with repo context, sorted newest-updated first. */
  const allIssues = computed<IssueWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.issues.map((issue) => ({ ...issue, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  );

  async function refresh(workspaceRepos: WorkspaceRepo[]): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      repos.value = await workspaceIssuesAll(workspaceRepos, activeFilter.value);
    } catch (e) {
      error.value = (e as Error).message ?? String(e);
    } finally {
      loading.value = false;
    }
  }

  return { repos, allIssues, loading, error, activeFilter, refresh };
}
