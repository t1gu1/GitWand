/**
 * Tests pour la validation post-merge (P2.5 — extension YAML + TOML).
 *
 * Vérifie que `validateMergedContent` applique la bonne stratégie selon
 * l'extension du fichier :
 *   - JSON/JSONC → `JSON.parse`
 *   - YAML/YML   → `yaml.parse`
 *   - TOML       → `smol-toml.parse`
 *   - autres     → pas de validation syntaxique
 */

import { describe, it, expect } from "vitest";
import { validateMergedContent } from "../resolver/validation.js";

// ─── JSON (régression — comportement préexistant) ────────────

describe("validateMergedContent — JSON", () => {
  it("accepte un JSON valide", () => {
    const result = validateMergedContent('{"a": 1, "b": [1, 2, 3]}', "config.json");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("détecte un JSON invalide (trailing comma)", () => {
    const result = validateMergedContent('{"a": 1,}', "config.json");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).not.toBeNull();
    expect(result.syntaxError).toMatch(/^JSON: /);
  });

  it("applique aussi la validation sur .jsonc", () => {
    // JSON.parse est strict — pas de commentaires autorisés, même pour .jsonc.
    // C'est le comportement préexistant ; P2.5 ne change pas ça.
    const result = validateMergedContent('{\n  // comment\n  "a": 1\n}', "tsconfig.jsonc");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).toMatch(/^JSON: /);
  });
});

// ─── YAML (P2.5) ───────────────────────────────────────────

describe("validateMergedContent — YAML", () => {
  it("accepte un YAML valide (.yaml)", () => {
    const yaml = `name: gitwand
version: 1.4.0
features:
  - resolver
  - validation
`;
    const result = validateMergedContent(yaml, "config.yaml");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("accepte un YAML valide (.yml)", () => {
    const yaml = `key: value\nlist:\n  - a\n  - b\n`;
    const result = validateMergedContent(yaml, "ci.yml");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("détecte une erreur de syntaxe YAML (indentation incohérente dans un flow)", () => {
    // Un mapping flow mal fermé — le parser échoue dur.
    const broken = `key: { a: 1, b: 2`;
    const result = validateMergedContent(broken, "bad.yaml");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).not.toBeNull();
    expect(result.syntaxError).toMatch(/^YAML: /);
  });

  it("détecte une tab illégale dans l'indentation (interdit en YAML)", () => {
    const broken = "root:\n\tchild: 1\n";
    const result = validateMergedContent(broken, "tabs.yml");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).toMatch(/^YAML: /);
  });

  it("un YAML vide reste valide (c'est un document vide)", () => {
    const result = validateMergedContent("", "empty.yaml");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });
});

// ─── TOML (P2.5) ───────────────────────────────────────────

describe("validateMergedContent — TOML", () => {
  it("accepte un TOML valide", () => {
    const toml = `
title = "GitWand"
version = "1.4.0"

[package]
name = "core"
authors = ["Laurent"]
`;
    const result = validateMergedContent(toml, "Cargo.toml");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("détecte une erreur de syntaxe TOML (table non fermée)", () => {
    const broken = `[package\nname = "x"\n`;
    const result = validateMergedContent(broken, "Cargo.toml");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).not.toBeNull();
    expect(result.syntaxError).toMatch(/^TOML: /);
  });

  it("détecte une clé dupliquée (interdit par la spec TOML)", () => {
    const broken = `a = 1\na = 2\n`;
    const result = validateMergedContent(broken, "conf.toml");
    expect(result.isValid).toBe(false);
    expect(result.syntaxError).toMatch(/^TOML: /);
  });

  it("accepte un TOML vide", () => {
    const result = validateMergedContent("", "empty.toml");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });
});

// ─── Fichiers non structurés ───────────────────────────────

describe("validateMergedContent — autres formats", () => {
  it("ne valide rien pour .ts (contenu JS-like mais pas structuré)", () => {
    const ts = `const x = { a: 1, };\nfunction foo() { return x; }\n`;
    const result = validateMergedContent(ts, "utils.ts");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("ne valide rien pour .md", () => {
    const md = `# Title\n\n{ this is not json }\n`;
    const result = validateMergedContent(md, "README.md");
    expect(result.isValid).toBe(true);
    expect(result.syntaxError).toBeNull();
  });

  it("détecte un marqueur résiduel quel que soit le format", () => {
    const withMarker = `line 1\n<<<<<<< ours\nline 2\n`;
    const result = validateMergedContent(withMarker, "any.ts");
    expect(result.isValid).toBe(false);
    expect(result.hasResidualMarkers).toBe(true);
    expect(result.residualMarkerLines).toEqual([2]);
  });

  it("combine marqueur résiduel et erreur de syntaxe (les deux drapeaux levés)", () => {
    const withMarkerAndBadJson = `{\n<<<<<<< ours\n"a": 1,\n}`;
    const result = validateMergedContent(withMarkerAndBadJson, "data.json");
    expect(result.isValid).toBe(false);
    expect(result.hasResidualMarkers).toBe(true);
    expect(result.syntaxError).toMatch(/^JSON: /);
  });
});
