/**
 * @file useGithubAuth.ts
 *
 * GitHub OAuth device-flow state machine for "Sign in with GitHub".
 *
 * Drives the two-step device flow exposed by the Rust backend
 * (`github_device_start` / `github_device_poll`):
 *
 *   1. `start()` requests a device code, shows the `userCode` and opens the
 *      GitHub verification page.
 *   2. The composable polls `github_device_poll` on the GitHub-mandated
 *      interval until the user approves (success), the code expires, or an
 *      error occurs.
 *
 * On success the token is already stored in the OS keychain by the backend
 * (the secret never reaches the frontend); the resolved `login` is returned so
 * the caller can register the account via `useAccounts`.
 *
 * The Settings token activates the tokenless REST path in Rust, so a `gh` CLI
 * install is no longer required for PR workflows.
 */

import { ref, computed } from "vue";
import { githubDeviceStart, githubDevicePoll, openExternalUrl } from "../utils/backend";

export type GithubAuthPhase = "idle" | "awaiting" | "success" | "error";

/** Keychain pointer for the Settings-managed GitHub token. */
export const GITHUB_TOKEN_KEY = "gitwand:github/oauth";

export function useGithubAuth() {
  const phase = ref<GithubAuthPhase>("idle");
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
      const res = await githubDevicePoll(deviceCode);
      if (res.status === "success") {
        clearTimer();
        login.value = res.login;
        phase.value = "success";
        return;
      }
      if (res.status === "error") {
        fail(res.error || "GitHub login failed.");
        return;
      }
      // "pending" → keep the current cadence; "slow_down" → back off 5s.
      schedulePoll(res.status === "slow_down" ? 10 : 5);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Begin the device flow and start polling. Does **not** open the browser —
   * the code is shown in-app first (auto-opening would navigate the Tauri
   * webview away and hide the code). The user opens GitHub via `openVerification`.
   * Watch `phase` for completion.
   */
  async function start(): Promise<void> {
    reset();
    phase.value = "awaiting";
    try {
      const code = await githubDeviceStart();
      deviceCode = code.device_code;
      userCode.value = code.user_code;
      verificationUri.value = code.verification_uri;
      // Prefer the pre-filled URL so the user doesn't retype the code.
      openUrl.value = code.verification_uri_complete || code.verification_uri;
      deadline = Date.now() + code.expires_in * 1000;
      schedulePoll(code.interval);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /** Open the GitHub verification page (pre-filled when available). */
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
