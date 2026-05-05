import { ref } from "vue";
import { workspaceWipAll } from "../utils/backend";
import type { WorkspaceWipItem, WorkspaceRepo } from "../utils/backend";

export type { WorkspaceWipItem };

/**
 * Composable for the Launchpad WIP panel.
 * Fetches per-repo WIP detail (staged/unstaged/untracked, last commit, upstream).
 * Each call returns a fresh reactive scope — no shared singleton.
 */
export function useLaunchpadWip() {
  const wip = ref<WorkspaceWipItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Fetch WIP data for the given workspace repos.
   * On error, preserves the previous wip data and sets error.
   */
  async function refresh(repos: WorkspaceRepo[]): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      wip.value = await workspaceWipAll(repos);
    } catch (e) {
      error.value = (e as Error).message ?? String(e);
    } finally {
      loading.value = false;
    }
  }

  return { wip, loading, error, refresh };
}
