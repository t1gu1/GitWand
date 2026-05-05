/// <reference types="vitest" />
/**
 * Vitest config dédiée aux tests de parité Rust↔Node.
 *
 * Séparée de `vite.config.ts` (qui sert aussi la config Vitest par défaut
 * pour les tests unit frontend) pour deux raisons :
 *
 *  1. Environnement : `node` ici (fetch, net, child_process natifs), vs
 *     `jsdom` pour les tests Vue.
 *  2. Scope : ces tests dépendent d'un binaire Rust pré-build et lancent
 *     un sous-process dev-server. Les laisser dans `pnpm test` forcerait
 *     tous les CI à installer cargo — on préfère les isoler derrière
 *     `test:parity`.
 *
 * Si un jour on veut tout fusionner (via `vitest --project`), c'est
 * possible, mais pas utile tant que les deux suites vivent bien séparées.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/parity/**/*.test.mjs"],
    // Un timeout plus large par défaut : lancer dev-server + spawn probe
    // + opérations git sur des fixtures prend > 1 s facilement.
    testTimeout: 20_000,
    hookTimeout: 15_000,
    globals: false,
  },
});
