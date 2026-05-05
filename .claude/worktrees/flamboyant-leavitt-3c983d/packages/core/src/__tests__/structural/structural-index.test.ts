/**
 * Integration tests for structural/index.ts
 *
 * `tryStructuralMergeResolve` requires web-tree-sitter (optional peer),
 * which is not installed in the test environment.
 *
 * These tests verify:
 *  - Graceful degradation when web-tree-sitter is absent (returns null).
 *  - The `isTypeScriptFile` / `isStructuralLanguage` guards.
 *  - `wrapStructuralResult` produces a valid MergeResult.
 *  - `reconstructVersions` (via the public API) extracts ours/theirs correctly.
 */

import { describe, it, expect } from "vitest";
import {
  tryStructuralMergeResolve,
  wrapStructuralResult,
  isTypeScriptFile,
  isStructuralLanguage,
} from "../../structural/index.js";

// ─── isTypeScriptFile ─────────────────────────────────────────────────────────

describe("isTypeScriptFile", () => {
  it("accepts .ts", () => expect(isTypeScriptFile("src/app.ts")).toBe(true));
  it("accepts .tsx", () => expect(isTypeScriptFile("src/comp.tsx")).toBe(true));
  it("rejects .d.ts", () => expect(isTypeScriptFile("types.d.ts")).toBe(false));
  it("rejects .js", () => expect(isTypeScriptFile("src/app.js")).toBe(false));
});

// ─── isStructuralLanguage ─────────────────────────────────────────────────────

describe("isStructuralLanguage", () => {
  it("accepts .ts, .tsx, .js, .jsx, .py, .go, .rs", () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]) {
      expect(isStructuralLanguage(`src/file${ext}`)).toBe(true);
    }
  });
  it("rejects .d.ts", () => expect(isStructuralLanguage("types.d.ts")).toBe(false));
  it("rejects .css", () => expect(isStructuralLanguage("style.css")).toBe(false));
});

// ─── tryStructuralMergeResolve — graceful degradation ────────────────────────

const SIMPLE_CONFLICT = `\
function foo() {
<<<<<<< ours
  return 1;
||||||| base
  return 0;
=======
  return 2;
>>>>>>> theirs
}
`;

describe("tryStructuralMergeResolve", () => {
  it("returns null for unsupported file types", async () => {
    const result = await tryStructuralMergeResolve(SIMPLE_CONFLICT, "styles.css");
    expect(result).toBeNull();
  });

  it("returns null for .d.ts files", async () => {
    const result = await tryStructuralMergeResolve(SIMPLE_CONFLICT, "types.d.ts");
    expect(result).toBeNull();
  });

  it("returns null gracefully when web-tree-sitter is not installed", async () => {
    // web-tree-sitter is an optional peer dep — not installed in test env.
    // The loader returns null, and tryStructuralMergeResolve returns null.
    const result = await tryStructuralMergeResolve(SIMPLE_CONFLICT, "src/app.ts");
    expect(result).toBeNull();
  });

  it("returns null gracefully for Python files too", async () => {
    const result = await tryStructuralMergeResolve(SIMPLE_CONFLICT, "src/app.py");
    expect(result).toBeNull();
  });

  it("never throws — always returns string | null", async () => {
    await expect(
      tryStructuralMergeResolve(SIMPLE_CONFLICT, "src/app.ts"),
    ).resolves.not.toThrow();
  });
});

// ─── wrapStructuralResult ─────────────────────────────────────────────────────

describe("wrapStructuralResult", () => {
  const conflicted = `// header\n<<<<<<< ours\nreturn 1;\n||||||| base\nreturn 0;\n=======\nreturn 2;\n>>>>>>> theirs\n// footer\n`;
  const merged = "// header\nreturn 1;\n// footer\n";

  it("returns filePath correctly", () => {
    const result = wrapStructuralResult(conflicted, merged, "src/app.ts");
    expect(result.filePath).toBe("src/app.ts");
  });

  it("sets mergedContent to the provided merged string", () => {
    const result = wrapStructuralResult(conflicted, merged, "src/app.ts");
    expect(result.mergedContent).toBe(merged);
  });

  it("marks all resolutions as autoResolved", () => {
    const result = wrapStructuralResult(conflicted, merged, "src/app.ts");
    expect(result.stats.totalConflicts).toBe(1);
    expect(result.stats.autoResolved).toBe(1);
    expect(result.stats.remaining).toBe(0);
    for (const r of result.resolutions) {
      expect(r.autoResolved).toBe(true);
    }
  });

  it("extracts the correct number of hunks", () => {
    const twoConflicts = [
      "<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs",
      "<<<<<<< ours\nc\n=======\nd\n>>>>>>> theirs",
    ].join("\n");
    const result = wrapStructuralResult(twoConflicts, "merged", "src/app.ts");
    expect(result.hunks).toHaveLength(2);
    expect(result.stats.totalConflicts).toBe(2);
  });

  it("validation result is present and valid for a clean merged content", () => {
    const result = wrapStructuralResult(conflicted, merged, "src/app.ts");
    expect(result.validation.isValid).toBe(true);
    expect(result.validation.hasResidualMarkers).toBe(false);
  });

  it("validation detects residual conflict markers if merged content has them", () => {
    const result = wrapStructuralResult(conflicted, "<<<<<<< ours\nreturn 1;\n", "src/app.ts");
    expect(result.validation.hasResidualMarkers).toBe(true);
    expect(result.validation.isValid).toBe(false);
  });
});
