/**
 * Tests du pattern whitespace_only (priority 50)
 *
 * Compatible diff2 et diff3.
 * Détection : après normalisation (trim de chaque ligne), ours et theirs
 * sont identiques — même code mais indentation ou espacement différent.
 * Auto-résolu (prend ours ou theirs selon la politique).
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher whitespace_only ─────────────────

describe("whitespace_only : indentation différente (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `    const x = 42;`,
    `    return x;`,
    `=======`,
    `  const x = 42;`,
    `  return x;`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en whitespace_only", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.hunks[0].type).toBe("whitespace_only");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "src/utils.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("whitespace_only : tabs vs spaces (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `\tfunction hello() {`,
    `\t\treturn "world";`,
    `\t}`,
    `=======`,
    `function hello() {`,
    `  return "world";`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en whitespace_only", () => {
    const result = resolve(input, "src/hello.ts");
    expect(result.hunks[0].type).toBe("whitespace_only");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/hello.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("whitespace_only : espaces de fin de ligne (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `const a = 1;   `,
    `const b = 2;`,
    `=======`,
    `const a = 1;`,
    `const b = 2;   `,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en whitespace_only", () => {
    const result = resolve(input, "src/vars.ts");
    expect(result.hunks[0].type).toBe("whitespace_only");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/vars.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("whitespace_only : indentation modifiée avec base (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `    if (condition) {`,
    `        doSomething();`,
    `    }`,
    `||||||| base`,
    `  if (condition) {`,
    `    doSomething();`,
    `  }`,
    `=======`,
    `   if (condition) {`,
    `     doSomething();`,
    `   }`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en whitespace_only", () => {
    const result = resolve(input, "src/logic.ts");
    expect(result.hunks[0].type).toBe("whitespace_only");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/logic.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("whitespace_only : reformatage JSON (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  "name": "gitwand",`,
    `  "version": "1.0.0"`,
    `=======`,
    `    "name": "gitwand",`,
    `    "version": "1.0.0"`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en whitespace_only", () => {
    const result = resolve(input, "package.json");
    expect(result.hunks[0].type).toBe("whitespace_only");
  });

  it("auto-résout", () => {
    const result = resolve(input, "package.json");
    expect(result.stats.autoResolved).toBe(1);
  });
});

// ─── Cas qui ne doivent PAS matcher whitespace_only ──────────

describe("whitespace_only : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si les contenus diffèrent après trim", () => {
    const input = [
      `<<<<<<< ours`,
      `    const x = 42;`,
      `=======`,
      `    const x = 99;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("whitespace_only");
  });

  it("ne matche pas si une ligne est ajoutée (nombre de lignes différent)", () => {
    const input = [
      `<<<<<<< ours`,
      `  const a = 1;`,
      `  const b = 2;`,
      `=======`,
      `    const a = 1;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("whitespace_only");
  });

  it("ne matche pas si les variables ont des noms différents", () => {
    const input = [
      `<<<<<<< ours`,
      `  const foo = bar;`,
      `=======`,
      `  const baz = bar;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("whitespace_only");
  });

  it("ne matche pas si seul l'ordre des lignes change (reorder_only le capte)", () => {
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
    expect(result.hunks[0].type).not.toBe("whitespace_only");
  });

  it("ne matche pas si les deux côtés sont identiques (same_change prioritaire)", () => {
    const input = [
      `<<<<<<< ours`,
      `  const x = 1;`,
      `=======`,
      `  const x = 1;`,
      `>>>>>>> theirs`,
    ].join("\n");
    // same_change (prio 10) prend la main
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });
});
