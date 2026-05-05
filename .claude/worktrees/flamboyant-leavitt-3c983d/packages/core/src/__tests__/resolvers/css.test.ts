/**
 * Tests du resolver CSS/SCSS/Less (GitWand)
 *
 * Fixtures :
 *   F1 — règle ajoutée d'un seul côté
 *   F2 — même règle, propriétés différentes → conflit partiel
 *   F3 — CSS minimal (1 règle)
 *   F4 — conflit dans .btn avec couleurs différentes
 *   F5 — SCSS avec variable modifiée
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── F1 — règle ajoutée d'un seul côté ───────────────────────────────────────

describe("F1 — CSS : règle ajoutée d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `.container {`,
    `  display: flex;`,
    `  padding: 16px;`,
    `}`,
    ``,
    `.header {`,
    `  background-color: #fff;`,
    `  height: 60px;`,
    `}`,
    `||||||| base`,
    `.container {`,
    `  display: flex;`,
    `  padding: 16px;`,
    `}`,
    `=======`,
    `.container {`,
    `  display: flex;`,
    `  padding: 16px;`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver css", () => {
    const result = resolve(input, "styles.css");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la règle ajoutée", () => {
    const result = resolve(input, "styles.css");
    expect(result.mergedContent).toContain(".header");
  });

  it("la raison mentionne [css]", () => {
    const result = resolve(input, "styles.css");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[css\]/i);
  });
});

// ─── F2 — même règle, propriétés différentes ─────────────────────────────────

describe("F2 — CSS : même règle, valeurs différentes des deux côtés (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `.container {`,
    `  max-width: 1200px;`,
    `  padding: 24px;`,
    `}`,
    `||||||| base`,
    `.container {`,
    `  max-width: 960px;`,
    `  padding: 16px;`,
    `}`,
    `=======`,
    `.container {`,
    `  max-width: 1440px;`,
    `  padding: 32px;`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "styles.css")).not.toThrow();
  });

  it("la raison mentionne [css]", () => {
    const result = resolve(input, "styles.css");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[css\]/i);
  });
});

// ─── F3 — CSS minimal ────────────────────────────────────────────────────────

describe("F3 — CSS minimal : ne plante pas", () => {
  const input = [
    `<<<<<<< ours`,
    `body { margin: 0; }`,
    `||||||| base`,
    `body { margin: 8px; }`,
    `=======`,
    `body { margin: 0; padding: 0; }`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "minimal.css")).not.toThrow();
  });

  it("produit un résultat avec au moins un hunk", () => {
    const result = resolve(input, "minimal.css");
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F4 — conflit dans .btn avec couleurs différentes ────────────────────────

describe("F4 — CSS : .btn avec ajout de règles indépendantes (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `.btn {`,
    `  display: inline-flex;`,
    `  padding: 8px 16px;`,
    `  border-radius: 4px;`,
    `  font-weight: 600;`,
    `}`,
    ``,
    `.btn-primary {`,
    `  background-color: #3b82f6;`,
    `  color: #fff;`,
    `}`,
    `||||||| base`,
    `.btn {`,
    `  display: inline-flex;`,
    `  padding: 8px 16px;`,
    `  border-radius: 4px;`,
    `}`,
    `=======`,
    `.btn {`,
    `  display: inline-flex;`,
    `  padding: 8px 16px;`,
    `  border-radius: 4px;`,
    `}`,
    ``,
    `.btn-danger {`,
    `  background-color: #ef4444;`,
    `  color: #fff;`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "buttons.css")).not.toThrow();
  });

  it("la raison mentionne [css]", () => {
    const result = resolve(input, "buttons.css");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[css\]/i);
  });
});

// ─── F5 — SCSS avec variable modifiée ────────────────────────────────────────

describe("F5 — SCSS : variable ajoutée d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `$primary-color: #3b82f6;`,
    `$secondary-color: #6b7280;`,
    `$font-size-base: 16px;`,
    `$border-radius: 4px;`,
    `||||||| base`,
    `$primary-color: #3b82f6;`,
    `$secondary-color: #6b7280;`,
    `$font-size-base: 16px;`,
    `=======`,
    `$primary-color: #3b82f6;`,
    `$secondary-color: #6b7280;`,
    `$font-size-base: 16px;`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver css", () => {
    const result = resolve(input, "app.scss");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la variable ajoutée", () => {
    const result = resolve(input, "app.scss");
    expect(result.mergedContent).toContain("border-radius");
  });

  it("la raison mentionne [css]", () => {
    const result = resolve(input, "app.scss");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[css\]/i);
  });
});
