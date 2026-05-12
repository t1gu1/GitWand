/**
 * networkGuard — short-circuit network operations when the app is offline.
 *
 * Why a helper instead of inlining `if (!isOnline.value)` at every call site:
 *
 *  - The check has to happen at the TS layer, BEFORE we hit `tauriInvoke()`
 *    or `devFetch()`. Once the IPC call is in flight, network commands can
 *    hang on `git push` for the full 5-min IPC timeout — exactly the
 *    "spinner infini" failure mode F1 was filed to remove.
 *  - We want a single place that logs the skip and returns a uniform
 *    `false` so the caller can `if (!requireOnline(...)) return;` and
 *    short-circuit symmetrically across every wrapped op.
 *  - The user-visible signal is the Logs tab badge (P6) — the suppressed
 *    action shows up as a `WARN` entry that lights the badge in the status
 *    bar. We deliberately do not pop a modal/toast: per spec, offline mode
 *    must NOT spam dialogs, just gate the affected buttons.
 *
 * Usage:
 *
 *   if (!requireOnline("push")) return;
 *   const result = await gitPush(folderPath.value, publish);
 *
 * The `operationLabel` is the human-readable verb (push / pull / fetch /
 * clone / PR list …) — it's interpolated into the log entry so the user
 * can tell which action was suppressed.
 */

import { isOnline } from "../composables/useConnectivity";
import { useLogs } from "../composables/useLogs";

const { pushLog } = useLogs();

/**
 * Guard a network operation against the offline state.
 *
 * Returns `true` when the operation may proceed (`isOnline === true`).
 * Returns `false` when offline — and in that case appends a `WARN` entry
 * to the in-app log so the suppressed action becomes visible in the
 * Settings → Logs panel (the status-bar badge lights up).
 *
 * The caller is expected to short-circuit immediately on `false`:
 *
 *     if (!requireOnline("push")) return;
 *     // proceed with the network call
 */
export function requireOnline(operationLabel: string): boolean {
  if (isOnline.value) return true;
  pushLog("warn", `Operation '${operationLabel}' skipped — offline`);
  return false;
}
