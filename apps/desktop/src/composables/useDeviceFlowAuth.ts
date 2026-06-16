/**
 * @file useDeviceFlowAuth.ts
 *
 * Shared OAuth 2.0 device-authorization-grant state machine.
 *
 * GitHub and Azure DevOps (Entra ID) expose the identical two-step device flow,
 * so both `useGithubAuth` and `useAzureAuth` are thin wrappers over this factory
 * — they supply their own `start`/`poll` backend commands and a forge-specific
 * failure label; everything else (polling cadence, expiry, error handling) is
 * shared here.
 *
 *   1. `start()` requests a device code, shows the `userCode` and opens the
 *      provider's verification page (via `openVerification`).
 *   2. The composable polls `poll(deviceCode)` on the provider-mandated interval
 *      until the user approves (success), the code expires, or an error occurs.
 *
 * On success the token is already stored in the OS keychain by the backend (the
 * secret never reaches the frontend); the resolved `login` is returned so the
 * caller can register the account via `useAccounts`.
 */

import { ref } from "vue";
import type { GithubDeviceCode, GithubDevicePoll } from "../utils/backend-pr";
import { openExternalUrl } from "../utils/backend";

export type DeviceAuthPhase = "idle" | "awaiting" | "success" | "error";

interface DeviceFlowOptions {
  /** Backend command that begins the flow and returns the device code. */
  start: () => Promise<GithubDeviceCode>;
  /** Backend command that polls for completion. */
  poll: (deviceCode: string) => Promise<GithubDevicePoll>;
  /** Fallback message when the backend reports an error without one. */
  failLabel: string;
}

export function useDeviceFlowAuth({ start: startCmd, poll: pollCmd, failLabel }: DeviceFlowOptions) {
  const phase = ref<DeviceAuthPhase>("idle");
  const userCode = ref("");
  const login = ref("");
  const error = ref<string | null>(null);

  /** URL to open in the browser — the pre-filled "complete" variant when given. */
  let openUrl = "";
  let deviceCode = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reset() {
    clearTimer();
    phase.value = "idle";
    userCode.value = "";
    login.value = "";
    error.value = null;
    openUrl = "";
    deviceCode = "";
    deadline = 0;
  }

  function fail(message: string) {
    clearTimer();
    error.value = message;
    phase.value = "error";
  }

  /** Schedule the next poll `seconds` from now. */
  function schedulePoll(seconds: number) {
    clearTimer();
    timer = setTimeout(poll, Math.max(1, seconds) * 1000);
  }

  async function poll() {
    if (phase.value !== "awaiting") return;
    if (Date.now() > deadline) {
      fail("The login code expired. Please try again.");
      return;
    }
    try {
      const res = await pollCmd(deviceCode);
      if (res.status === "success") {
        clearTimer();
        login.value = res.login;
        phase.value = "success";
        return;
      }
      if (res.status === "error") {
        fail(res.error || failLabel);
        return;
      }
      // "pending" → keep the current cadence; "slow_down" → back off.
      schedulePoll(res.status === "slow_down" ? 10 : 5);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Begin the device flow and start polling. Does **not** open the browser —
   * the code is shown in-app first (auto-opening would navigate the Tauri
   * webview away and hide the code). The user opens the page via `openVerification`.
   * Watch `phase` for completion.
   */
  async function start(): Promise<void> {
    reset();
    phase.value = "awaiting";
    try {
      const code = await startCmd();
      deviceCode = code.device_code;
      userCode.value = code.user_code;
      // Prefer the pre-filled URL so the user doesn't retype the code.
      openUrl = code.verification_uri_complete || code.verification_uri;
      deadline = Date.now() + code.expires_in * 1000;
      schedulePoll(code.interval);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Open the provider's verification page (pre-filled when available). */
  function openVerification() {
    if (openUrl) void openExternalUrl(openUrl);
  }

  return {
    phase,
    userCode,
    login,
    error,
    start,
    openVerification,
    reset,
  };
}
