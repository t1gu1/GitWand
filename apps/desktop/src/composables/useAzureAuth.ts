/**
 * @file useAzureAuth.ts
 *
 * Azure DevOps (Entra ID) OAuth device-flow state machine for
 * "Sign in with Azure".
 *
 * Mirrors `useGithubAuth.ts` — Microsoft's identity platform exposes the same
 * OAuth 2.0 device authorization grant as GitHub, so the two-step flow is
 * identical:
 *
 *   1. `start()` requests a device code, shows the `userCode` and surfaces the
 *      verification URL the user opens.
 *   2. The composable polls `azure_device_poll` on the Entra-mandated interval
 *      until the user approves (success), the code expires, or an error occurs.
 *
 * On success the access token is already stored in the OS keychain by the
 * backend (the secret never reaches the frontend); the resolved display name is
 * returned so the caller can register the account via `useAccounts`.
 */

import { ref, computed } from "vue";
import { azureDeviceStart, azureDevicePoll, openExternalUrl } from "../utils/backend";

export type AzureAuthPhase = "idle" | "awaiting" | "success" | "error";

/** Keychain pointer for the Settings-managed Azure token. */
export const AZURE_TOKEN_KEY = "gitwand:azure/oauth";

export function useAzureAuth() {
  const phase = ref<AzureAuthPhase>("idle");
  const userCode = ref("");
  const verificationUri = ref("");
  /** URL to open in the browser — the pre-filled "complete" variant when given. */
  const openUrl = ref("");
  const login = ref("");
  const error = ref<string | null>(null);

  let deviceCode = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;

  const isBusy = computed(() => phase.value === "awaiting");

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
    verificationUri.value = "";
    openUrl.value = "";
    login.value = "";
    error.value = null;
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
      const res = await azureDevicePoll(deviceCode);
      if (res.status === "success") {
        clearTimer();
        login.value = res.login;
        phase.value = "success";
        return;
      }
      if (res.status === "error") {
        fail(res.error || "Azure login failed.");
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
   * webview away and hide the code). The user opens Azure via `openVerification`.
   */
  async function start(): Promise<void> {
    reset();
    phase.value = "awaiting";
    try {
      const code = await azureDeviceStart();
      deviceCode = code.device_code;
      userCode.value = code.user_code;
      verificationUri.value = code.verification_uri;
      openUrl.value = code.verification_uri_complete || code.verification_uri;
      deadline = Date.now() + code.expires_in * 1000;
      schedulePoll(code.interval);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Open the Azure verification page (pre-filled when available). */
  function openVerification() {
    if (openUrl.value) void openExternalUrl(openUrl.value);
  }

  /** Abort an in-flight flow (user closed the dialog). */
  function cancel() {
    reset();
  }

  return {
    phase,
    userCode,
    verificationUri,
    openUrl,
    login,
    error,
    isBusy,
    start,
    openVerification,
    cancel,
    reset,
  };
}
