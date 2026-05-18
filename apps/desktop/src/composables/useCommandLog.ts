/**
 * useCommandLog — Transparent command log composable (v2.11)
 *
 * Wraps the `get_command_log` Tauri command and provides a reactive
 * snapshot of the last ≤200 git commands GitWand has run on behalf
 * of the user.  The panel fetches on open; callers can also call
 * `refresh()` at any time (e.g. after a user action).
 */

import { ref, readonly } from "vue";
import type { CmdLogEntry } from "../utils/backend";
import { getCommandLog } from "../utils/backend";

const entries = ref<CmdLogEntry[]>([]);
const loading = ref(false);
const lastRefresh = ref<Date | null>(null);

async function refresh() {
  loading.value = true;
  try {
    entries.value = await getCommandLog();
    lastRefresh.value = new Date();
  } finally {
    loading.value = false;
  }
}

export function useCommandLog() {
  return {
    entries:     readonly(entries),
    loading:     readonly(loading),
    lastRefresh: readonly(lastRefresh),
    refresh,
  };
}
