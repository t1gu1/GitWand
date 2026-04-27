/**
 * Tests for structural/parsers/grammars/languages.ts
 */

import { describe, it, expect } from "vitest";
import {
  languageForFile,
  isStructuralLanguage,
  grammarNameForFile,
} from "../../structural/parsers/grammars/languages.js";

describe("languageForFile", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/Component.tsx", "tsx"],
    ["src/index.js", "javascript"],
    ["src/utils.mjs", "javascript"],
    ["lib/helper.cjs", "javascript"],
    ["src/App.jsx", "jsx"],
    ["src/main.py", "python"],
    ["cmd/server.go", "go"],
    ["src/lib.rs", "rust"],
  ])("%s → %s", (path, lang) => {
    expect(languageForFile(path)).toBe(lang);
  });

  it("returns null for unsupported extensions", () => {
    expect(languageForFile("styles.css")).toBeNull();
    expect(languageForFile("config.yaml")).toBeNull();
    expect(languageForFile("README.md")).toBeNull();
  });
});

describe("isStructuralLanguage", () => {
  it("returns true for supported languages", () => {
    expect(isStructuralLanguage("src/app.ts")).toBe(true);
    expect(isStructuralLanguage("src/app.tsx")).toBe(true);
    expect(isStructuralLanguage("src/app.js")).toBe(true);
    expect(isStructuralLanguage("src/app.jsx")).toBe(true);
    expect(isStructuralLanguage("src/app.py")).toBe(true);
    expect(isStructuralLanguage("src/app.go")).toBe(true);
    expect(isStructuralLanguage("src/app.rs")).toBe(true);
  });

  it("returns false for .d.ts (declaration files)", () => {
    expect(isStructuralLanguage("src/types.d.ts")).toBe(false);
    expect(isStructuralLanguage("dist/index.d.ts")).toBe(false);
  });

  it("returns false for unsupported extensions", () => {
    expect(isStructuralLanguage("styles.css")).toBe(false);
    expect(isStructuralLanguage("config.json")).toBe(false);
  });
});

describe("grammarNameForFile", () => {
  it("returns tree-sitter-typescript for .ts", () => {
    expect(grammarNameForFile("src/app.ts")).toBe("tree-sitter-typescript");
  });

  it("returns tree-sitter-tsx for .tsx", () => {
    expect(grammarNameForFile("src/app.tsx")).toBe("tree-sitter-tsx");
  });

  it("returns tree-sitter-javascript for .js and .jsx", () => {
    expect(grammarNameForFile("src/app.js")).toBe("tree-sitter-javascript");
    expect(grammarNameForFile("src/App.jsx")).toBe("tree-sitter-javascript");
  });

  it("returns tree-sitter-python for .py", () => {
    expect(grammarNameForFile("main.py")).toBe("tree-sitter-python");
  });

  it("returns tree-sitter-go for .go", () => {
    expect(grammarNameForFile("server.go")).toBe("tree-sitter-go");
  });

  it("returns tree-sitter-rust for .rs", () => {
    expect(grammarNameForFile("lib.rs")).toBe("tree-sitter-rust");
  });

  it("returns null for unsupported extensions", () => {
    expect(grammarNameForFile("style.css")).toBeNull();
    expect(grammarNameForFile("config.yaml")).toBeNull();
  });

  it("still returns grammar name for .d.ts (exclusion is in isStructuralLanguage, not here)", () => {
    // grammarNameForFile only maps extension → grammar; the .d.ts guard is in isStructuralLanguage
    expect(grammarNameForFile("types.d.ts")).toBe("tree-sitter-typescript");
  });
});
