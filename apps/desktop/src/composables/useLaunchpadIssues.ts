import { ref, computed } from "vue";
import { workspaceIssuesAll } from "../utils/backend";
import type { WorkspaceRepoIssues, WorkspaceRepo, Issue } from "../utils/backend";
import { useLaunchpadPins } from "./useLaunchpadPins";

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

  const { isPinned, isSnoozed } = useLaunchpadPins();

  /** Flat list of all non-snoozed issues: pinned first, then by updatedAt descending. */
  const allIssues = computed<IssueWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.issues.map((issue) => ({ ...issue, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .filter((issue) => !isSnoozed(issue.url))
      .sort((a, b) => {
        const aPinned = isPinned(a.url) ? 0 : 1;
        const bPinned = isPinned(b.url) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
  );

  /** Flat list of currently-snoozed issues (hidden from allIssues). */
  const snoozedIssues = computed<IssueWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.issues.map((issue) => ({ ...issue, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .filter((issue) => isSnoozed(issue.url))
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

  return { repos, allIssues, snoozedIssues, loading, error, activeFilter, refresh };
}
