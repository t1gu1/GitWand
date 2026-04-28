/**
 * Tests du pattern one_side_change (priority 30)
 *
 * Nécessite diff3 (base obligatoire).
 * Détection : (ours === base ET theirs ≠ base) OU (ours ≠ base ET theirs === base).
 * Un seul côté a modifié par rapport à la base — l'autre est resté identique.
 * Auto-résolu en prenant le côté qui a changé.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher one_side_change ─────────────────

describe("one_side_change : theirs modifie, ours inchangé (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  retries: 3,`,
    `||||||| base`,
    `  retries: 3,`,
    `=======`,
    `  retries: 5,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en one_side_change", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.hunks[0].type).toBe("one_side_change");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat prend la valeur de theirs", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.mergedContent).toContain("retries: 5");
  });
});

describe("one_side_change : ours modifie, theirs inchangé (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  maxConnections: 100,`,
    `||||||| base`,
    `  maxConnections: 10,`,
    `=======`,
    `  maxConnections: 10,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en one_side_change", () => {
    const result = resolve(input, "src/db.ts");
    expect(result.hunks[0].type).toBe("one_side_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/db.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat prend la valeur de ours", () => {
    const result = resolve(input, "src/db.ts");
    expect(result.mergedContent).toContain("maxConnections: 100");
  });
});

describe("one_side_change : theirs modifie un bloc multi-lignes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  function oldImpl() {`,
    `    return 42;`,
    `  }`,
    `||||||| base`,
    `  function oldImpl() {`,
    `    return 42;`,
    `  }`,
    `=======`,
    `  function newImpl() {`,
    `    return 100;`,
    `  }`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en one_side_change", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.hunks[0].type).toBe("one_side_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("one_side_change : ours modifie une chaîne (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `const API_URL = "https://api.v2.example.com";`,
    `||||||| base`,
    `const API_URL = "https://api.example.com";`,
    `=======`,
    `const API_URL = "https://api.example.com";`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en one_side_change", () => {
    const result = resolve(input, "src/constants.ts");
    expect(result.hunks[0].type).toBe("one_side_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/constants.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("one_side_change : theirs supprime, ours inchangé — delete_no_change prioritaire (prio 20)", () => {
  // delete_no_change est prioritaire sur one_side_change pour les suppressions
  it("delete_no_change (prio 20) prend la main quand theirs supprime et ours === base", () => {
    const input = [
      `<<<<<<< ours`,
      `  debug: true,`,
      `||||||| base`,
      `  debug: true,`,
      `=======`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    // delete_no_change est prioritaire (prio 20 < 30)
    expect(result.hunks[0].type).toBe("delete_no_change");
  });
});

// ─── Cas qui ne doivent PAS matcher one_side_change ──────────

describe("one_side_change : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si les deux côtés diffèrent de la base", () => {
    const input = [
      `<<<<<<< ours`,
      `  level: "warn",`,
      `||||||| base`,
      `  level: "info",`,
      `=======`,
      `  level: "error",`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("one_side_change");
  });

  it("ne matche pas si ours === theirs (same_change prioritaire)", () => {
    const input = [
      `<<<<<<< ours`,
      `  timeout: 3000,`,
      `||||||| base`,
      `  timeout: 5000,`,
      `=======`,
      `  timeout: 3000,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // Les deux ont fait le même changement → same_change (prio 10)
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("ne matche pas sans base (diff2 uniquement)", () => {
    // diff2 ne fournit pas de base → one_side_change ne peut pas s'appliquer
    const input = [
      `<<<<<<< ours`,
      `  value: 1,`,
      `=======`,
      `  value: 1,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // same_change (prio 10) prend la main car ours === theirs
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("ne matche pas si les deux côtés ajoutent des lignes différentes (diff3)", () => {
    const input = [
      `<<<<<<< ours`,
      `  foo,`,
      `  bar,`,
      `  addedByOurs,`,
      `||||||| base`,
      `  foo,`,
      `  bar,`,
      `=======`,
      `  foo,`,
      `  bar,`,
      `  addedByTheirs,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("one_side_change");
  });

  it("ne matche pas si ours supprime et theirs modifie (les deux diffèrent de la base)", () => {
    const input = [
      `<<<<<<< ours`,
      `||||||| base`,
      `  oldValue: 42,`,
      `=======`,
      `  newValue: 99,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("one_side_change");
  });
});
