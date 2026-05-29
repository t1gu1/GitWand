/**
 * useOsNotification — thin wrapper over tauri-plugin-notification (v2.16).
 *
 * We call the plugin's IPC commands directly through `tauriInvoke`
 * (`plugin:notification|…`) rather than importing `@tauri-apps/plugin-notification`,
 * so the type-check and dev-server (`dev:web`) builds don't depend on the
 * native JS package being present. At runtime the Rust plugin (registered in
 * lib.rs) services these commands.
 *
 * Permission is requested lazily on the first send and cached for the session.
 * In `dev:web` (no Tauri) we fall back to the browser Notification API when
 * available, otherwise no-op — the in-app Launchpad still updates visually.
 */

import { isTauri, tauriInvoke } from "../utils/backend-core";

let _permissionGranted: boolean | null = null;

/** Ask the OS for notification permission once; cache the answer. */
async function ensurePermission(): Promise<boolean> {
  if (_permissionGranted !== null) return _permissionGranted;

  if (isTauri()) {
    try {
      let granted = await tauriInvoke<boolean | null>("plugin:notification|is_permission_granted");
      if (granted === null || granted === undefined) {
        const res = await tauriInvoke<string>("plugin:notification|request_permission");
        granted = res === "granted";
      }
      _permissionGranted = !!granted;
    } catch {
      _permissionGranted = false;
    }
    return _permissionGranted;
  }

  // Browser fallback (dev:web).
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "granted") {
      _permissionGranted = true;
    } else if (Notification.permission !== "denied") {
      try {
        _permissionGranted = (await Notification.requestPermission()) === "granted";
      } catch {
        _permissionGranted = false;
      }
    } else {
      _permissionGranted = false;
    }
    return _permissionGranted;
  }

  _permissionGranted = false;
  return false;
}

/**
 * Emit a single OS notification. Best-effort: never throws — a failed
 * notification must not break the poll loop.
 */
export async function osNotify(title: string, body: string): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;

  if (isTauri()) {
    try {
      await tauriInvoke("plugin:notification|notify", { options: { title, body } });
    } catch {
      // swallow — non-critical
    }
    return;
  }

  if (typeof Notification !== "undefined") {
    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body });
    } catch {
      // swallow
    }
  }
}

/** Test/reset hook — clears the cached permission decision. */
export function _resetNotificationPermission(): void {
  _permissionGranted = null;
}
