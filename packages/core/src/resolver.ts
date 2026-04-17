/**
 * GitWand Conflict Resolver — re-export shim.
 *
 * L'implémentation a été éclatée (P1.1) dans le dossier `resolver/` :
 *
 * - `resolver/validation.ts`         — Phase 7.2 : marqueurs résiduels + JSON
 * - `resolver/generated-detection.ts` — lockfiles/bundles + stripVolatileValues
 * - `resolver/policy.ts`              — DEFAULT_OPTIONS, politique effective,
 *                                       seuil de confiance, pénalité v1.4
 * - `resolver/format-dispatch.ts`     — Phase 7.3 : résolveurs spécialisés
 * - `resolver/assemble.ts`            — moteur textuel (switch par ConflictType)
 * - `resolver/index.ts`               — orchestration + `resolve()` public
 *
 * Ce shim existe pour ne rien casser côté consommateurs : de nombreux
 * tests et modules importent `resolve` depuis `../resolver.js`.
 */

export { resolve } from "./resolver/index.js";
