/**
 * Tests du pattern non_overlapping (priority 40)
 *
 * Nécessite diff3 (base obligatoire).
 * Détection : l'algorithme mergeNonOverlapping() interne réussit —
 * les zones modifiées par ours et theirs ne se chevauchent pas.
 * Cas typique : ours ajoute des lignes en haut, theirs ajoute en bas.
 * Auto-résolu en combinant les deux ensembles de changements.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher non_overlapping ─────────────────

describe("non_overlapping : ours insère en haut, theirs insère en bas (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  INSERTED_BY_OURS,`,
    `  alpha,`,
    `  beta,`,
    `||||||| base`,
    `  alpha,`,
    `  beta,`,
    `=======`,
    `  alpha,`,
    `  beta,`,
    `  INSERTED_BY_THEIRS,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en non_overlapping", () => {
    const result = resolve(input, "src/list.ts");
    expect(result.hunks[0].type).toBe("non_overlapping");
  });

  it("auto-résout (autoResolved === 1)", () => {
    const result = resolve(input, "src/list.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient les insertions des deux côtés", () => {
    const result = resolve(input, "src/list.ts");
    const merged = result.mergedContent!;
    expect(merged).toContain("INSERTED_BY_OURS");
    expect(merged).toContain("INSERTED_BY_THEIRS");
    expect(merged).toContain("alpha");
    expect(merged).toContain("beta");
  });
});

describe("non_overlapping : ours modifie première ligne, theirs modifie dernière ligne (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  host: "prod.example.com",`,
    `  port: 5432,`,
    `  name: "mydb",`,
    `||||||| base`,
    `  host: "localhost",`,
    `  port: 5432,`,
    `  name: "mydb",`,
    `=======`,
    `  host: "localhost",`,
    `  port: 5432,`,
    `  name: "production_db",`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en non_overlapping", () => {
    const result = resolve(input, "src/db-config.ts");
    expect(result.hunks[0].type).toBe("non_overlapping");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/db-config.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat combine les deux modifications", () => {
    const result = resolve(input, "src/db-config.ts");
    const merged = result.mergedContent!;
    expect(merged).toContain("prod.example.com");
    expect(merged).toContain("production_db");
  });
});

describe("non_overlapping : ours ajoute avant, theirs ajoute au milieu (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  alpha,`,
    `  INSERTED_BY_OURS,`,
    `  beta,`,
    `  gamma,`,
    `||||||| base`,
    `  alpha,`,
    `  beta,`,
    `  gamma,`,
    `=======`,
    `  alpha,`,
    `  beta,`,
    `  INSERTED_BY_THEIRS,`,
    `  gamma,`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en non_overlapping", () => {
    const result = resolve(input, "src/items.ts");
    expect(result.hunks[0].type).toBe("non_overlapping");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/items.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("non_overlapping : modifications sur lignes distinctes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  firstName: "John",`,
    `  age: 30,`,
    `  city: "Paris",`,
    `||||||| base`,
    `  firstName: "John",`,
    `  age: 25,`,
    `  city: "Paris",`,
    `=======`,
    `  firstName: "Jane",`,
    `  age: 25,`,
    `  city: "Paris",`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en non_overlapping", () => {
    const result = resolve(input, "src/user.ts");
    expect(result.hunks[0].type).toBe("non_overlapping");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/user.ts");
    expect(result.stats.autoResolved).toBe(1);
  });
});

describe("non_overlapping : ajout d'imports dans des branches (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `import { ComponentA } from "./a";`,
    `import { NewFromOurs } from "./ours";`,
    `import { ComponentB } from "./b";`,
    `||||||| base`,
    `import { ComponentA } from "./a";`,
    `import { ComponentB } from "./b";`,
    `=======`,
    `import { ComponentA } from "./a";`,
    `import { ComponentB } from "./b";`,
    `import { NewFromTheirs } from "./theirs";`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en non_overlapping", () => {
    const result = resolve(input, "src/imports.ts");
    expect(result.hunks[0].type).toBe("non_overlapping");
  });

  it("auto-résout", () => {
    const result = resolve(input, "src/imports.ts");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient les imports des deux branches", () => {
    const result = resolve(input, "src/imports.ts");
    const merged = result.mergedContent!;
    expect(merged).toContain("NewFromOurs");
    expect(merged).toContain("NewFromTheirs");
  });
});

// ─── Cas qui ne doivent PAS matcher non_overlapping ──────────

describe("non_overlapping : cas qui ne doivent pas matcher", () => {
  it("ne matche pas si les deux côtés modifient la même ligne", () => {
    const input = [
      `<<<<<<< ours`,
      `  value: "ours",`,
      `||||||| base`,
      `  value: "base",`,
      `=======`,
      `  value: "theirs",`,
      `>>>>>>> theirs`,
    ].join("\n");
    // Les deux modifient la même ligne → pas non_overlapping
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("non_overlapping");
  });

  it("ne matche pas si les deux insèrent la même ligne (same_change prioritaire)", () => {
    const input = [
      `<<<<<<< ours`,
      `  foo,`,
      `  SAME_INSERTION,`,
      `||||||| base`,
      `  foo,`,
      `=======`,
      `  foo,`,
      `  SAME_INSERTION,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // same_change (prio 10) prend la main
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });

  it("ne matche pas sans base (diff2)", () => {
    const input = [
      `<<<<<<< ours`,
      `  alpha,`,
      `  OURS,`,
      `  beta,`,
      `=======`,
      `  alpha,`,
      `  beta,`,
      `  THEIRS,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // Sans base on ne peut pas appliquer non_overlapping
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("non_overlapping");
  });

  it("ne matche pas si les deux côtés modifient des zones adjacentes qui se chevauchent", () => {
    const input = [
      `<<<<<<< ours`,
      `  a: 1,`,
      `  b: 20,`,
      `  c: 30,`,
      `||||||| base`,
      `  a: 1,`,
      `  b: 2,`,
      `  c: 3,`,
      `=======`,
      `  a: 1,`,
      `  b: 200,`,
      `  c: 300,`,
      `>>>>>>> theirs`,
    ].join("\n");
    // Les deux modifient b et c → chevauchement
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("non_overlapping");
  });

  it("ne matche pas si ours === theirs (same_change prioritaire)", () => {
    const input = [
      `<<<<<<< ours`,
      `  x: 42,`,
      `||||||| base`,
      `  x: 1,`,
      `=======`,
      `  x: 42,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("same_change");
  });
});
