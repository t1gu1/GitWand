/**
 * @file useAzureAuth.ts
 *
 * Azure DevOps (Entra ID) OAuth device-flow state machine for
 * "Sign in with Azure".
 *
 * Thin wrapper over `useDeviceFlowAuth` — Microsoft's identity platform exposes
 * the same OAuth 2.0 device authorization grant as GitHub, so only the two
 * backend commands (`azure_device_start` / `azure_device_poll`) differ.
 *
 * On success the access token is already stored in the OS keychain by the
 * backend (the secret never reaches the frontend); the resolved display name is
 * returned so the caller can register the account via `useAccounts`.
 */

import { azureDeviceStart, azureDevicePoll } from "../utils/backend";
import { useDeviceFlowAuth, type DeviceAuthPhase } from "./useDeviceFlowAuth";

export type AzureAuthPhase = DeviceAuthPhase;

/** Keychain pointer for the Settings-managed Azure token. */
export const AZURE_TOKEN_KEY = "gitwand:azure/oauth";

export function useAzureAuth() {
  return useDeviceFlowAuth({
    start: azureDeviceStart,
    poll: azureDevicePoll,
    failLabel: "Azure login failed.",
  });
}
