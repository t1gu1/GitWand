/**
 * Tests du resolver YAML (GitWand)
 *
 * Fixtures :
 *   F1 — clé ajoutée d'un seul côté
 *   F2 — même clé modifiée des deux côtés → conflit non résolvable
 *   F3 — YAML minimal (1 ligne)
 *   F4 — conflit dans values.yaml Helm (clés indépendantes)
 *   F5 — conflit dans un workflow GitHub Actions
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── F1 — clé ajoutée d'un seul côté ─────────────────────────────────────────

describe("F1 — YAML : clé ajoutée d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `app:`,
    `  name: my-app`,
    `  version: 1.0.0`,
    `  debug: true`,
    `||||||| base`,
    `app:`,
    `  name: my-app`,
    `  version: 1.0.0`,
    `=======`,
    `app:`,
    `  name: my-app`,
    `  version: 1.0.0`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver yaml", () => {
    const result = resolve(input, "config.yaml");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la clé ajoutée", () => {
    const result = resolve(input, "config.yaml");
    expect(result.mergedContent).toContain("debug");
  });

  it("la raison mentionne [yaml]", () => {
    const result = resolve(input, "config.yaml");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[yaml\]/i);
  });
});

// ─── F2 — même clé modifiée des deux côtés ────────────────────────────────────

describe("F2 — YAML : même clé modifiée des deux côtés → conflit non résolvable", () => {
  const input = [
    `<<<<<<< ours`,
    `app:`,
    `  name: my-app`,
    `  port: 8080`,
    `||||||| base`,
    `app:`,
    `  name: my-app`,
    `  port: 3000`,
    `=======`,
    `app:`,
    `  name: my-app`,
    `  port: 9090`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "config.yaml")).not.toThrow();
  });

  it("la raison mentionne [yaml]", () => {
    const result = resolve(input, "config.yaml");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[yaml\]/i);
  });
});

// ─── F3 — YAML minimal ───────────────────────────────────────────────────────

describe("F3 — YAML minimal : ne plante pas", () => {
  const input = [
    `<<<<<<< ours`,
    `key: value-ours`,
    `||||||| base`,
    `key: value-base`,
    `=======`,
    `key: value-theirs`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "minimal.yaml")).not.toThrow();
  });

  it("produit un résultat avec au moins un hunk", () => {
    const result = resolve(input, "minimal.yaml");
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F4 — conflit dans values.yaml Helm (clés indépendantes) ─────────────────

describe("F4 — values.yaml Helm : merge de clés indépendantes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `replicaCount: 2`,
    ``,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.2.0`,
    ``,
    `resources:`,
    `  limits:`,
    `    cpu: 500m`,
    `    memory: 512Mi`,
    `||||||| base`,
    `replicaCount: 1`,
    ``,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.1.0`,
    `||||||| base`,
    `replicaCount: 1`,
    ``,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.1.0`,
    `=======`,
    `replicaCount: 1`,
    ``,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.2.0`,
    ``,
    `service:`,
    `  type: ClusterIP`,
    `  port: 80`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "values.yaml")).not.toThrow();
  });

  it("la raison mentionne [yaml]", () => {
    const result = resolve(input, "values.yaml");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[yaml\]/i);
  });
});

describe("F4b — values.yml Helm simple : merge de clés indépendantes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `replicaCount: 2`,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.2.0`,
    `resources:`,
    `  limits:`,
    `    cpu: 500m`,
    `||||||| base`,
    `replicaCount: 1`,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.1.0`,
    `=======`,
    `replicaCount: 1`,
    `image:`,
    `  repository: my-registry/my-app`,
    `  tag: v1.2.0`,
    `service:`,
    `  type: ClusterIP`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout ou ne plante pas", () => {
    expect(() => resolve(input, "values.yml")).not.toThrow();
  });

  it("la raison mentionne [yaml]", () => {
    const result = resolve(input, "values.yml");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[yaml\]/i);
  });
});

// ─── F5 — clé ajoutée d'un seul côté (conflit YAML réel nécessitant le resolver) ─

describe("F5 — YAML : clé de config ajoutée d'un seul côté (diff3)", () => {
  // Ours ajoute `cache:`, theirs n'a pas changé la base → one_side_change trop simple,
  // on utilise deux clés imbriquées différentes pour forcer le resolver YAML.
  const input = [
    `<<<<<<< ours`,
    `database:`,
    `  host: localhost`,
    `  port: 5432`,
    `  name: mydb`,
    `  pool: 10`,
    `||||||| base`,
    `database:`,
    `  host: localhost`,
    `  port: 5432`,
    `  name: mydb`,
    `=======`,
    `database:`,
    `  host: localhost`,
    `  port: 5432`,
    `  name: mydb`,
    `  timeout: 30`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "config.yml")).not.toThrow();
  });

  it("auto-résout (deux ajouts indépendants)", () => {
    const result = resolve(input, "config.yml");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient les deux nouvelles clés", () => {
    const result = resolve(input, "config.yml");
    expect(result.mergedContent).toContain("pool: 10");
    expect(result.mergedContent).toContain("timeout: 30");
  });
});
