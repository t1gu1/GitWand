/**
 * @file useGithubAuth.ts
 *
 * GitHub OAuth device-flow state machine for "Sign in with GitHub".
 *
 * Thin wrapper over `useDeviceFlowAuth` — supplies the two backend commands
 * (`github_device_start` / `github_device_poll`); all flow logic lives in the
 * shared factory.
 *
 * On success the token is already stored in the OS keychain by the backend (the
 * secret never reaches the frontend); the resolved `login` is returned so the
 * caller can register the account via `useAccounts`.
 *
 * The Settings token activates the tokenless REST path in Rust, so a `gh` CLI
 * install is no longer required for PR workflows.
 */

import { githubDeviceStart, githubDevicePoll } from "../utils/backend";
import { useDeviceFlowAuth, type DeviceAuthPhase } from "./useDeviceFlowAuth";

export type GithubAuthPhase = DeviceAuthPhase;

/** Keychain pointer for the Settings-managed GitHub token. */
export const GITHUB_TOKEN_KEY = "gitwand:github/oauth";

export function useGithubAuth() {
  return useDeviceFlowAuth({
    start: githubDeviceStart,
    poll: githubDevicePoll,
    failLabel: "GitHub login failed.",
  });
}
