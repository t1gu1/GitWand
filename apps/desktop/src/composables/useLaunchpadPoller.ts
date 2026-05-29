/**
 * useLaunchpadPoller — background poll loop for Launchpad PR activity (v2.16).
 *
 * Distinct from `useRepoPoller`, which tracks the *active repo's* git status
 * and PAUSES when the window is hidden (`document.hidden`). PR activity
 * notifications are the opposite: we specifically want to keep polling while
 * the app is in the background, so the user gets notified about review
 * requests / CI flips / new comments without GitWand in the foreground.
 *
 * Design (mirrors the polling discipline from MEMORY.md
 * `feedback_gitwand_polling_discipline`):
 *   - A single `setInterval` at POLL_INTERVAL — never more than one.
 *   - Gated on `isEnabled()` every tick: skipped when the workspace is empty,
 *     notifications are off, or the app is offline. The interval keeps
 *     ticking but does no work — cheaper than tearing down/rebuilding it on
 *     every settings/connectivity flip.
 *   - Does NOT pause on `document.hidden` (that's the whole point).
 *   - Cleaned up on `onUnmounted`.
 *
 * The consumer (App.vue) supplies `onTick` (refresh PRs → diff → maybe notify)
 * and `isEnabled` (settings + connectivity + workspace gate). This composable
 * owns only the clock.
 */

import { onUnmounted } from "vue";

/** Background poll cadence (60 s). PR activity isn't latency-sensitive. */
const POLL_INTERVAL = 60_000;

export interface LaunchpadPollerOptions {
  /** Work to run each enabled tick — refresh PRs, diff the snapshot, notify. */
  onTick: () => Promise<void>;
  /**
   * Gate evaluated before every tick. Return false to skip work this tick
   * (e.g. empty workspace, notifications disabled, offline). The interval
   * keeps running so we resume the instant the gate reopens.
   */
  isEnabled: () => boolean;
}

export function useLaunchpadPoller(options: LaunchpadPollerOptions) {
  let _interval: ReturnType<typeof setInterval> | null = null;
  let _running = false;

  async function tick() {
    if (!options.isEnabled()) return;
    // Re-entrancy guard: a slow refresh must not overlap the next tick.
    if (_running) return;
    _running = true;
    try {
      await options.onTick();
    } catch {
      // Background polling errors are non-critical — stay silent.
    } finally {
      _running = false;
    }
  }

  function start() {
    if (_interval) return;
    _interval = setInterval(() => void tick(), POLL_INTERVAL);
  }

  function stop() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
  }

  /** Force an immediate enabled tick (e.g. right after the workspace loads). */
  function pokeNow() {
    void tick();
  }

  onUnmounted(stop);

  return { start, stop, pokeNow };
}
