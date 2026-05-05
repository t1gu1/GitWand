/**
 * Tests du pattern delete_no_change (priority 20)
 *
 * Détection (diff3) : un côté supprime (vide), l'autre n'a pas changé par
 * rapport à la base. Cas : (ours vide ET theirs === base) OU (theirs vide
 * ET ours === base).
 * Détection (diff2) : ours vide OU theirs vide.
 * Auto-résolu (la suppression gagne).
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher delete_no_change ─────────────────

describe("delete_no_change : ours supprime, theirs inchangé (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `||||||| base`,
    `  legacyFlag: true,`,
    `=======`,
    `  legacyFlag: true,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en delete_no_change", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("delete_no_change : theirs supprime, ours inchangé (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  deprecatedOption: false,`,
    `||||||| base`,
    `  deprecatedOption: false,`,
    `=======`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en delete_no_change", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("delete_no_change : ours supprime multi-lignes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `||||||| base`,
    `  // Old comment block`,
    `  // that spans multiple lines`,
    `  oldVar = 42;`,
    `=======`,
    `  // Old comment block`,
    `  // that spans multiple lines`,
    `  oldVar = 42;`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en delete_no_change", () => {
    const result = resolve(input, "src/legacy.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/legacy.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("delete_no_change : ours vide (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `=======`,
    `  someRemovedLine: true,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en delete_no_change", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  // En diff2, le score de confiance est "low" (60 − pénalité 30 = 30) — sous le seuil
  // auto-résolution par défaut (high = 68). Le pattern est détecté mais pas appliqué.
  it("ne plante pas — confiance low en diff2", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
    // makeScore(60, 30, 0) → 60 − 30×0.40 = 48 → "medium" (sous le seuil "high" pour auto-résolution)
    expect(result.hunks[0].confidence.label).toBe("medium");
  });
});

describe("delete_no_change : theirs vide (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  anotherOldLine = "legacy";`,
    `=======`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en delete_no_change", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  // En diff2, confiance "low" — pas auto-résolu par défaut
  it("ne plante pas — confiance low en diff2", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("delete_no_change");
    // makeScore(60, 30, 0) → 60 − 30×0.40 = 48 → "medium" (sous le seuil "high" pour auto-résolution)
    expect(result.hunks[0].confidence.label).toBe("medium");
  });
});

// ─── Cas qui ne doivent PAS matcher delete_no_change ─────────

describe("delete_no_change : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si les deux côtés ont du contenu différent (les deux ont modifié)", () => {
    const input = [
      `<<<<<<< ours`,
      `  flag: true,`,
      `||||||| base`,
      `  flag: false,`,
      `=======`,
      `  flag: "maybe",`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("delete_no_change");
  });

  it("ne matche pas si ours modifie (sans supprimer) et theirs === base", () => {
    const input = [
      `<<<<<<< ours`,
      `  value: 99,`,
      `||||||| base`,
      `  value: 1,`,
      `=======`,
      `  value: 1,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // ours modifie, theirs inchangé → one_side_change (prio 30)
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("delete_no_change");
  });

  it("ne matche pas si les deux côtés suppriment (same_change)", () => {
    const input = [
      `<<<<<<< ours`,
      `||||||| base`,
      `  removed: true,`,
      `=======`,
      `>>>>>>> theirs`,
    ].join("\n");
    // Les deux suppriment → same_change (prio 10)
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("ne matche pas si ours et theirs ont des contenus distincts non vides", () => {
    const input = [
      `<<<<<<< ours`,
      `  optionA: 1,`,
      `=======`,
      `  optionB: 2,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("delete_no_change");
  });

  it("ne matche pas si ours ajoute par rapport à la base (theirs garde la base)", () => {
    const input = [
      `<<<<<<< ours`,
      `  existing: true,`,
      `  newField: "added",`,
      `||||||| base`,
      `  existing: true,`,
      `=======`,
      `  existing: true,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // ours ajoute une ligne → insertion, pas suppression
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("delete_no_change");
  });
});
