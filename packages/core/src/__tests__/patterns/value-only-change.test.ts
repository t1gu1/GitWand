/**
 * Tests du pattern value_only_change (priority 60)
 *
 * Nécessite diff2 (sans base).
 * Détection : même nombre de lignes ET detectValueOnlyChange() réussit —
 * les lignes diffèrent uniquement sur des valeurs scalaires volatiles
 * (version, hash, checksum, timestamp, UUID, integrity hash, etc.).
 * Auto-résolu (prend theirs ou ours selon la politique).
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher value_only_change ───────────────

describe("value_only_change : numéros de version (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  "version": "1.0.0"`,
    `=======`,
    `  "version": "2.0.0"`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en value_only_change", () => {
    const result = resolve(input, "package.json");
    expect(result.hunks[0].type).toBe("value_only_change");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "package.json");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("value_only_change : checksums différents (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `checksum = "abc123def456"`,
    `=======`,
    `checksum = "def456abc123"`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en value_only_change", () => {
    const result = resolve(input, "Cargo.lock");
    expect(result.hunks[0].type).toBe("value_only_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "Cargo.lock");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("value_only_change : integrity hash npm (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `      "integrity": "sha512-aaaaaaaaaaaaaaaa=="`,
    `=======`,
    `      "integrity": "sha512-bbbbbbbbbbbbbbbb=="`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en value_only_change", () => {
    const result = resolve(input, "package-lock.json");
    expect(result.hunks[0].type).toBe("value_only_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "package-lock.json");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("value_only_change : multiple lignes avec valeurs scalaires (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  "version": "1.2.3",`,
    `  "resolved": "https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz"`,
    `=======`,
    `  "version": "1.2.4",`,
    `  "resolved": "https://registry.npmjs.org/pkg/-/pkg-1.2.4.tgz"`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en value_only_change", () => {
    const result = resolve(input, "package-lock.json");
    expect(result.hunks[0].type).toBe("value_only_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "package-lock.json");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("value_only_change : hash de commit (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  source = "git+https://github.com/org/repo?rev=aabbccdd11223344"`,
    `=======`,
    `  source = "git+https://github.com/org/repo?rev=99887766aabbccdd"`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en value_only_change", () => {
    const result = resolve(input, "Cargo.lock");
    expect(result.hunks[0].type).toBe("value_only_change");
  });

  it("auto-résout", () => {
    const result = resolve(input, "Cargo.lock");
    expect(result.stats.autoResolved).toBe(1);
  });
});

// ─── Cas qui ne doivent PAS matcher value_only_change ────────

describe("value_only_change : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si les noms de clés changent (pas seulement des valeurs)", () => {
    const input = [
      `<<<<<<< ours`,
      `  "oldKey": "value",`,
      `=======`,
      `  "newKey": "value",`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "package.json");
    expect(result.hunks[0].type).not.toBe("value_only_change");
  });

  it("ne matche pas si le nombre de lignes diffère", () => {
    const input = [
      `<<<<<<< ours`,
      `  "version": "1.0.0",`,
      `  "extra": "line",`,
      `=======`,
      `  "version": "2.0.0",`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "package.json");
    expect(result.hunks[0].type).not.toBe("value_only_change");
  });

  it("ne matche pas si la structure du code change (pas juste des valeurs)", () => {
    const input = [
      `<<<<<<< ours`,
      `const x = computeValue();`,
      `=======`,
      `const x = 42;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("value_only_change");
  });

  it("ne matche pas si les deux côtés sont identiques (same_change prioritaire)", () => {
    const input = [
      `<<<<<<< ours`,
      `  "version": "1.0.0"`,
      `=======`,
      `  "version": "1.0.0"`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "package.json");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("ne matche pas si les noms de fonctions changent", () => {
    const input = [
      `<<<<<<< ours`,
      `function handleLogin() {`,
      `=======`,
      `function handleSignIn() {`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/auth.ts");
    expect(result.hunks[0].type).not.toBe("value_only_change");
  });
});
