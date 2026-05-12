/**
 * @file forge/useForge.ts
 *
 * ForgeRegistry — détecte le forge depuis `gitRemoteInfo().provider` et
 * retourne le ForgeProvider correspondant.
 *
 * Usage:
 *   const forge = await useForge(cwd);
 *   const prs = await forge.listPRs(cwd, { state: "open" });
 *
 * Design:
 * - `gitRemoteInfo()` est déjà appelé par usePrPanel au montage. La détection
 *   est donc sans surcoût si on réutilise le résultat.
 * - `useForge(cwd)` peut être appelé sans attendre (mode synchro) si le provider
 *   est déjà connu, ou en mode async si la détection réseau est nécessaire.
 * - Le fallback est toujours `githubProvider` pour assurer la rétro-compatibilité
 *   avec les repos GitHub existants avant que le provider soit détecté.
 */

import { gitRemoteInfo } from "../../utils/backend";
import type { ForgeProvider, ForgeName } from "./types";
import { githubProvider } from "./GitHubProvider";
import { gitlabProvider } from "./GitLabProvider";
import { bitbucketProvider } from "./BitbucketProvider";

// ─── Registry ───────────────────────────────────────────────────────────────

const PROVIDERS: ForgeProvider[] = [
  githubProvider,
  gitlabProvider,
  bitbucketProvider,
];

/**
 * Retourne le ForgeProvider correspondant à un nom de forge déjà connu.
 * Pratique quand `RemoteInfo.provider` est déjà chargé.
 */
export function getProviderByName(name: ForgeName): ForgeProvider {
  return PROVIDERS.find((p) => p.name === name) ?? githubProvider;
}

/**
 * Retourne le ForgeProvider correspondant à une URL remote.
 * Effectue la détection sans appel réseau.
 */
export function getProviderByUrl(remoteUrl: string): ForgeProvider {
  return PROVIDERS.find((p) => p.detectFromRemote(remoteUrl)) ?? githubProvider;
}

/**
 * Charge le ForgeProvider pour un repo local en appellant `gitRemoteInfo(cwd)`.
 *
 * À utiliser lors du premier montage d'un composant forge (usePrPanel, etc.)
 * quand RemoteInfo n'est pas encore disponible dans le contexte.
 *
 * Si `gitRemoteInfo` échoue (repo sans remote), retourne githubProvider en fallback.
 */
export async function useForge(cwd: string): Promise<ForgeProvider> {
  try {
    const info = await gitRemoteInfo(cwd);
    return getProviderByName(info.provider as ForgeName);
  } catch {
    return githubProvider;
  }
}

/**
 * Variante synchrone — retourne le provider depuis un RemoteInfo déjà chargé.
 * Evite un double appel réseau dans les composants qui ont déjà chargé RemoteInfo.
 *
 * @example
 *   const remoteInfo = await gitRemoteInfo(cwd);
 *   const forge = forgeFromRemoteInfo(remoteInfo);
 */
export function forgeFromRemoteInfo(info: { provider: string; url: string }): ForgeProvider {
  // Priorité au champ provider (calculé par Rust) — fallback sur URL matching.
  const byName = PROVIDERS.find((p) => p.name === info.provider);
  if (byName) return byName;
  return getProviderByUrl(info.url);
}

// ─── Re-exports pratiques ───────────────────────────────────────────────────
export { githubProvider, gitlabProvider, bitbucketProvider };
export type { ForgeProvider, ForgeName };
