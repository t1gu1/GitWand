/**
 * Tests du pattern same_change (priority 10)
 *
 * Détection : les deux côtés (ours et theirs) sont identiques.
 * Compatible diff2 et diff3.
 * Auto-résolu car les deux branches ont fait le même changement.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher same_change ─────────────────────

describe("same_change : les deux côtés sont identiques (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `const version = "2.0.0";`,
    `=======`,
    `const version = "2.0.0";`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en same_change", () => {
    const result = resolve(input, "src/version.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "src/version.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le contenu résolu contient la ligne commune", () => {
    const result = resolve(input, "src/version.ts");
    expect(result.mergedContent).toContain('const version = "2.0.0"');
  });
});

describe("same_change : les deux côtés sont identiques (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  timeout: 3000,`,
    `||||||| base`,
    `  timeout: 5000,`,
    `=======`,
    `  timeout: 3000,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en same_change", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/config.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("same_change : multi-lignes identiques des deux côtés (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `function greet(name: string) {`,
    `  return \`Hello, \${name}!\`;`,
    `}`,
    `=======`,
    `function greet(name: string) {`,
    `  return \`Hello, \${name}!\`;`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en same_change", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("same_change : suppression identique des deux côtés (diff2)", () => {
  // Les deux côtés ont supprimé toutes les lignes (résultat vide)
  const input = [
    `<<<<<<< ours`,
    `=======`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en same_change (suppression totale des deux côtés)", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("same_change : commentaire identique ajouté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `// TODO: refactor this`,
    `const x = 42;`,
    `||||||| base`,
    `const x = 42;`,
    `=======`,
    `// TODO: refactor this`,
    `const x = 42;`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en same_change", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/test.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

// ─── Cas qui ne doivent PAS matcher same_change ───────────────

describe("same_change : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si ours ≠ theirs (valeurs différentes)", () => {
    const input = [
      `<<<<<<< ours`,
      `const x = 1;`,
      `=======`,
      `const x = 2;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("same_change");
  });

  it("ne matche pas si ours a une ligne supplémentaire", () => {
    const input = [
      `<<<<<<< ours`,
      `const x = 1;`,
      `const y = 2;`,
      `=======`,
      `const x = 1;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("same_change");
  });

  it("ne matche pas si theirs a une ligne supplémentaire", () => {
    const input = [
      `<<<<<<< ours`,
      `foo`,
      `=======`,
      `foo`,
      `bar`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("same_change");
  });

  it("ne matche pas si un seul côté modifie (one_side_change)", () => {
    const input = [
      `<<<<<<< ours`,
      `  retries: 3,`,
      `||||||| base`,
      `  retries: 3,`,
      `=======`,
      `  retries: 5,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("same_change");
  });

  it("ne matche pas si les lignes sont dans un ordre différent", () => {
    const input = [
      `<<<<<<< ours`,
      `alpha`,
      `beta`,
      `=======`,
      `beta`,
      `alpha`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("same_change");
  });
});
