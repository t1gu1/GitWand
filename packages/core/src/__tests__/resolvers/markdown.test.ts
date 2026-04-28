/**
 * Tests du resolver Markdown (GitWand)
 *
 * Fixtures :
 *   F1 — section ajoutée d'un seul côté
 *   F2 — même section modifiée des deux côtés → conflit ou fallback
 *   F3 — Markdown minimal (texte sans heading)
 *   F4 — README avec section ## Features ajoutée d'un côté
 *   F5 — CHANGELOG avec entrée de version ajoutée
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── F1 — section ajoutée d'un seul côté ─────────────────────────────────────

describe("F1 — Markdown : section ajoutée d'un seul côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my project.`,
    ``,
    `## Installation`,
    ``,
    `Run \`npm install\`.`,
    `||||||| base`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my project.`,
    `=======`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my project.`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver markdown", () => {
    const result = resolve(input, "README.md");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la section ajoutée", () => {
    const result = resolve(input, "README.md");
    expect(result.mergedContent).toContain("## Installation");
  });

  it("la raison mentionne [markdown]", () => {
    const result = resolve(input, "README.md");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[markdown\]/i);
  });
});

// ─── F2 — même section modifiée des deux côtés ────────────────────────────────

describe("F2 — Markdown : même section modifiée des deux côtés (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my awesome project with many features.`,
    `||||||| base`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my project.`,
    `=======`,
    `# My Project`,
    ``,
    `## Introduction`,
    ``,
    `This is my project, now with TypeScript support.`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "README.md")).not.toThrow();
  });

  it("la raison mentionne [markdown]", () => {
    const result = resolve(input, "README.md");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[markdown\]/i);
  });
});

// ─── F3 — Markdown minimal ────────────────────────────────────────────────────

describe("F3 — Markdown minimal : ne plante pas", () => {
  const input = [
    `<<<<<<< ours`,
    `Some text on ours side.`,
    `=======`,
    `Some text on theirs side.`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("ne lève pas d'exception", () => {
    expect(() => resolve(input, "NOTES.md")).not.toThrow();
  });

  it("produit un résultat avec au moins un hunk", () => {
    const result = resolve(input, "NOTES.md");
    expect(result.hunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── F4 — README avec section ## Features ajoutée d'un côté ──────────────────

describe("F4 — README : ajout de section ## Features (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `# GitWand`,
    ``,
    `## Overview`,
    ``,
    `GitWand is a Git client.`,
    ``,
    `## Features`,
    ``,
    `- Auto-resolve conflicts`,
    `- AI-powered merge`,
    `||||||| base`,
    `# GitWand`,
    ``,
    `## Overview`,
    ``,
    `GitWand is a Git client.`,
    `=======`,
    `# GitWand`,
    ``,
    `## Overview`,
    ``,
    `GitWand is a Git client.`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver markdown", () => {
    const result = resolve(input, "README.md");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient la section Features", () => {
    const result = resolve(input, "README.md");
    expect(result.mergedContent).toContain("## Features");
    expect(result.mergedContent).toContain("Auto-resolve conflicts");
  });

  it("la raison mentionne [markdown]", () => {
    const result = resolve(input, "README.md");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[markdown\]/i);
  });
});

// ─── F5 — CHANGELOG avec entrée de version ajoutée ───────────────────────────

describe("F5 — CHANGELOG : entrée de version ajoutée d'un côté (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `# Changelog`,
    ``,
    `## [2.1.0] - 2025-04-01`,
    ``,
    `### Added`,
    `- New conflict resolver for YAML files`,
    ``,
    `## [2.0.0] - 2025-01-15`,
    ``,
    `### Breaking Changes`,
    `- Revamped API`,
    `||||||| base`,
    `# Changelog`,
    ``,
    `## [2.0.0] - 2025-01-15`,
    ``,
    `### Breaking Changes`,
    `- Revamped API`,
    `=======`,
    `# Changelog`,
    ``,
    `## [2.0.0] - 2025-01-15`,
    ``,
    `### Breaking Changes`,
    `- Revamped API`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("auto-résout via le resolver markdown", () => {
    const result = resolve(input, "CHANGELOG.md");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("le résultat contient l'entrée de version ajoutée", () => {
    const result = resolve(input, "CHANGELOG.md");
    expect(result.mergedContent).toContain("## [2.1.0]");
    expect(result.mergedContent).toContain("## [2.0.0]");
  });

  it("la raison mentionne [markdown]", () => {
    const result = resolve(input, "CHANGELOG.md");
    expect(result.resolutions[0].resolutionReason).toMatch(/\[markdown\]/i);
  });
});
