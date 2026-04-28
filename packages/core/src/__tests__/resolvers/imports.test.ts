/**
 * Tests du resolver imports ES/TS (GitWand)
 *
 * Fixtures :
 *   F1 — import ajouté d'un seul côté
 *   F2 — même module importé différemment des deux côtés → conflit non résolvable
 *   F3 — imports vides (bloc vide)
 *   F4 — TypeScript avec `import type`
 *   F5 — re-exports `export { X } from 'y'`
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── F1 — import ajouté d'un seul côté ───────────────────────────────────────

describe("F1 — imports : import ajouté d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `import { ref } from 'vue';`,
    `import { computed } from 'vue';`,
    `import { useRouter } from 'vue-router';`,
    `||||||| base`,
    `import { ref } from 'vue';`,
    `import { computed } from 'vue';`,
    `=======`,
    `import { ref } from 'vue';`,
    `import { computed } from 'vue';`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver imports", () => {
    const result = resolve(input, "composable.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("les deux imports sont présents dans le merge", () => {
    const result = resolve(input, "composable.ts");
    expect(result.mergedContent).toContain("useRouter");
    expect(result.mergedContent).toContain("computed");
    expect(result.mergedContent).toContain("ref");
  });

  it("la raison mentionne [imports]", () => {
    const result = resolve(input, "composable.ts");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[imports\]/i);
  });
});

// ─── F2 — même module importé différemment des deux côtés ────────────────────

describe("F2 — imports : même module importé différemment des deux côtés (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `import { ref, computed, watch } from 'vue';`,
    `||||||| base`,
    `import { ref } from 'vue';`,
    `=======`,
    `import { ref, reactive, toRefs } from 'vue';`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "store.ts")).not.toThrow();
  });

  it("la raison mentionne [imports]", () => {
    const result = resolve(input, "store.ts");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[imports\]/i);
  });
});

// ─── F3 — imports vides ───────────────────────────────────────────────────────

describe("F3 — imports vides : ne plante pas", () => {
  const input = [
    `<<<<<<< ours`,
    `import {} from 'vue';`,
    `=======`,
    `import {} from 'vue';`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "empty.ts")).not.toThrow();
  });

  it("produit un résultat avec au moins un hunk", () => {
    const result = resolve(input, "empty.ts");
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F4 — TypeScript avec import type ────────────────────────────────────────

describe("F4 — imports : TypeScript avec `import type` (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `import type { Ref } from 'vue';`,
    `import type { Router } from 'vue-router';`,
    `import type { GitWandOptions } from '@gitwand/core';`,
    `||||||| base`,
    `import type { Ref } from 'vue';`,
    `import type { Router } from 'vue-router';`,
    `=======`,
    `import type { Ref } from 'vue';`,
    `import type { Router } from 'vue-router';`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver imports", () => {
    const result = resolve(input, "types.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient l'import type ajouté", () => {
    const result = resolve(input, "types.ts");
    expect(result.mergedContent).toContain("GitWandOptions");
    expect(result.mergedContent).toContain("import type");
  });

  it("la raison mentionne [imports]", () => {
    const result = resolve(input, "types.ts");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[imports\]/i);
  });
});

// ─── F5 — re-exports ──────────────────────────────────────────────────────────

// F5 — imports de deux modules différents ajoutés des deux côtés (diff2)
// En diff2, insertion_at_boundary n'a pas accès à la base → le resolver imports
// est sollicité pour la fusion sémantique.
describe("F5 — imports : deux modules différents ajoutés (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `import { useRouter } from 'vue-router';`,
    `import { ref } from 'vue';`,
    `import { useI18n } from './composables/useI18n';`,
    `=======`,
    `import { useRouter } from 'vue-router';`,
    `import { ref } from 'vue';`,
    `import { useTheme } from './composables/useTheme';`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout", () => {
    const result = resolve(input, "src/App.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient les imports des deux côtés", () => {
    const result = resolve(input, "src/App.ts");
    expect(result.mergedContent).toContain("useI18n");
    expect(result.mergedContent).toContain("useTheme");
    expect(result.mergedContent).toContain("useRouter");
  });
});
