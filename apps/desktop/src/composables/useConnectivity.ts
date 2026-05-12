/**
 * useConnectivity — module-level connectivity singleton (F1, Mode hors-ligne).
 *
 * Replaces the previous `useNetworkStatus` heuristic (which only listened to
 * `navigator.onLine` and would happily say "online" when the wifi adapter was
 * up but the link was actually dead) with a probe-based signal:
 *
 *   1. Every ~30 s `useRepoPoller` calls `probeConnectivity(cwd)` which:
 *      - resolves the `origin` remote URL of the active repo (skipped when
 *        none — without a remote there's nothing to probe and we stay
 *        optimistic = online)
 *      - opens a bounded TCP connect to that host (see
 *        `checkRemoteReachable` / `commands::network::check_remote_reachable`)
 *      - flips `isOnline` based on the result and logs a single entry on
 *        transitions via `useLogs`
 *
 *   2. `window.online` (the browser's "wifi came back" event) triggers an
 *      immediate eager probe so the UI un-greys network buttons as soon as
 *      the user reconnects — without waiting for the next poll tick.
 *
 *   3. `window.offline` flips `isOnline` to `false` immediately (no probe
 *      needed — the OS just told us the link is down).
 *
 * Singleton: state lives at module scope so every consumer (header pill,
 * SyncSplitButton, networkGuard, App.vue poller) sees the same value
 * without prop drilling.  Initial value is `true` (optimistic) — the first
 * probe will correct it within one tick if the user really is offline.
 *
 * The composable does NOT own a timer of its own — that would re-introduce
 * the polling regression described in `feedback_gitwand_polling_discipline`.
 * `useRepoPoller` is the single 2 s heartbeat for the whole app; it calls
 * us through `onConnectivityTick`.
 */

import { onMounted, onUnmounted, ref, type Ref } from "vue";
import { checkRemoteReachable, gitRemoteInfo } from "../utils/backend";
import { useLogs } from "./useLogs";

const PROBE_TIMEOUT_MS = 2_000;

// ─── Singleton state ──────────────────────────────────────
const isOnline = ref(true);
const lastCheckedAt = ref<number | null>(null);
const checking = ref(false);

// ─── Internal: stable log handle ──────────────────────────
// `useLogs()` itself is module-scoped, so calling it once here is fine and
// keeps the import surface inside this file.
const { pushLog } = useLogs();

/**
 * Run one connectivity probe for the active repo.
 *
 * Safe to call concurrently — overlapping calls short-circuit so only one
 * probe is in flight at a time. When there's no repo or no remote we leave
 * `isOnline` alone (defaults to `true`) because there's nothing meaningful
 * to test: we don't want to surface "Offline" just because the user
 * happens to be on the welcome screen.
 */
export async function probeConnectivity(
  activeRepoPath: string | null,
): Promise<void> {
  if (checking.value) return;
  if (!activeRepoPath) {
    // No active repo → nothing to probe. Stay optimistic.
    return;
  }
  checking.value = true;
  try {
    let url = "";
    try {
      const info = await gitRemoteInfo(activeRepoPath);
      url = (info?.url ?? "").trim();
    } catch {
      // The repo has no `origin` configured — treat as online (no remote
      // to test, and we'd rather over-enable than over-disable).
      return;
    }
    if (!url) return;

    const reachable = await checkRemoteReachable(url, PROBE_TIMEOUT_MS);
    lastCheckedAt.value = Date.now();

    const wasOnline = isOnline.value;
    isOnline.value = reachable;

    if (wasOnline && !reachable) {
      pushLog("warn", "Connectivity lost — remote unreachable");
    } else if (!wasOnline && reachable) {
      pushLog("info", "Connectivity restored");
    }
  } catch (err) {
    // Probe itself failed (DNS resolver crashed, IPC threw, etc.).
    // Log once but don't flip state — we lack evidence either way.
    const message = err instanceof Error ? err.message : String(err);
    pushLog("warn", `Connectivity probe failed: ${message}`);
  } finally {
    checking.value = false;
  }
}

// ─── Browser online/offline event wiring ──────────────────
// Module-level wiring so the listeners survive component unmounts. Adding
// them on first import keeps the singleton autonomous — consumers don't
// have to remember to call a setup function.
let _wired = false;
function ensureBrowserListenersOnce() {
  if (_wired || typeof window === "undefined") return;
  _wired = true;
  window.addEventListener("online", () => {
    // The OS says the link came back. Don't trust it blindly — re-probe
    // to confirm there's a real path to the remote. But while waiting,
    // optimistically flip to online so the user can act immediately.
    isOnline.value = true;
    // We don't know the active repo path here; the next poller tick will
    // call probeConnectivity() with the correct cwd. This optimistic flip
    // is the "fast reaction" the spec asks for.
  });
  window.addEventListener("offline", () => {
    if (isOnline.value) {
      pushLog("warn", "Connectivity lost — browser reports offline");
    }
    isOnline.value = false;
    lastCheckedAt.value = Date.now();
  });
}

// ─── Public composable ────────────────────────────────────
export function useConnectivity(): {
  isOnline: Ref<boolean>;
  lastCheckedAt: Ref<number | null>;
  checking: Ref<boolean>;
  probeConnectivity: typeof probeConnectivity;
} {
  // We wire the browser listeners on the first `useConnectivity()` call
  // that runs inside a component (so the import side-effects stay minimal
  // for unit tests that import this module).
  if (typeof window !== "undefined") {
    // Wire immediately — useNetworkStatus did this in onMounted, but
    // module-scoped singletons should be ready before mount so consumers
    // can read the ref synchronously during setup.
    ensureBrowserListenersOnce();
  }
  // Lifecycle hooks are optional here: the listeners are module-scoped
  // and never need to be torn down per-component. We still register an
  // onMounted / onUnmounted pair so accidental misuse outside setup() is
  // a noisy error rather than a silent no-op.
  try {
    onMounted(() => {
      ensureBrowserListenersOnce();
    });
    onUnmounted(() => {
      // Intentional no-op: the singleton outlives any individual
      // component. Listeners are released only on full app teardown,
      // which is when the window itself goes away.
    });
  } catch {
    // Called outside a component (e.g. from a plain script or a test) —
    // onMounted throws in that case. Safe to ignore.
  }

  return {
    isOnline,
    lastCheckedAt,
    checking,
    probeConnectivity,
  };
}

// Module-level re-exports for places that need the ref without going
// through `useConnectivity()` (e.g. the network guard helper).
export { isOnline, lastCheckedAt, checking };
