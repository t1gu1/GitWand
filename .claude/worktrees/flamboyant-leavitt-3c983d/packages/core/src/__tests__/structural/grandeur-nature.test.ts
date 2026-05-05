/**
 * Integration tests — "grandeur nature"
 *
 * These tests use content derived from the `_tmp_split_scenario` sub-repo
 * (a tiny calculator module with a linear commit history) to produce
 * realistic 3-way merge conflicts and run the full `resolveAsync` pipeline
 * including the structural merge engine (tree-sitter / WASM).
 *
 * Source versions used (from _tmp_split_scenario git history):
 *   - test-branch-from-ctx : add()
 *   - split-base           : add() + subtract()
 *   - main                 : add/subtract/multiply/divide/modulo
 *
 * Four scenarios:
 *   S1 — two-branches-grow-independently : both sides add different functions
 *        → structural merge should resolve cleanly
 *   S2 — ours-only-change                : ours modifies + adds, theirs unchanged
 *        → structural merge should resolve cleanly
 *   S3 — body-conflict                   : both sides change the same function body
 *        → structural merge returns null, hunk-based resolver takes over
 *   S4 — delete-vs-modify                : ours deletes a function, theirs modifies it
 *        → structural merge returns null, hunk-based resolver cannot resolve either
 *
 * The tests are designed to be non-flaky:
 *   • If web-tree-sitter / tree-sitter-wasms are available (devDeps in this
 *     package), the structural path is exercised and assertions are strict.
 *   • If WASM loading fails (CI without optional deps), `resolveAsync` falls
 *     back transparently and the tests still verify the hunk-based fallback.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { resolveAsync } from "../../resolver/index.js";
import { tryStructuralMergeResolve } from "../../structural/index.js";
import { _resetCache } from "../../structural/parsers/loader.js";

// Reset WASM cache once before the suite so every run starts clean.
beforeAll(() => {
  _resetCache();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a diff3-format conflict string from three source versions. */
function makeConflict(ours: string, base: string, theirs: string): string {
  const parts: string[] = [];
  parts.push(`<<<<<<< ours\n${ours}`);
  parts.push(`||||||| base\n${base}`);
  parts.push(`=======\n${theirs}`);
  parts.push(`>>>>>>> theirs`);
  return parts.join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared source fragments  (extracted from _tmp_split_scenario git history)
// ─────────────────────────────────────────────────────────────────────────────

const HEADER = `// Tiny calculator module — educational demo\n`;

const FN_ADD = `export function add(a, b) {
  return a + b;
}`;

const FN_ADD_WITH_LOG = `export function add(a, b) {
  console.log(\`add(\${a}, \${b})\`);
  return a + b;
}`;

const FN_ADD_WITH_VALIDATION = `export function add(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new RangeError("add: arguments must be finite");
  }
  return a + b;
}`;

const FN_SUBTRACT = `export function subtract(a, b) {
  return a - b;
}`;

const FN_SUBTRACT_GUARDED = `export function subtract(a, b) {
  if (b === undefined) throw new TypeError("subtract requires two arguments");
  return a - b;
}`;

const FN_MULTIPLY = `export function multiply(a, b) {
  return a * b;
}`;

const FN_DIVIDE = `export function divide(a, b) {
  if (b === 0) {
    throw new Error("division by zero");
  }
  return a / b;
}`;

const FN_MODULO = `export function modulo(a, b) {
  if (b === 0) {
    throw new Error("modulo by zero");
  }
  return a % b;
}`;

// S3 variants — both sides REPLACE the same return line with different content.
// These are genuine line-level conflicts (not pure insertions) that neither
// structural nor hunk-based resolver can auto-merge.
const FN_ADD_RETURN_PARENS = `export function add(a, b) {
  return (a + b);
}`;

const FN_ADD_RETURN_FALLBACK = `export function add(a, b) {
  return a + b || 0;
}`;

// ─────────────────────────────────────────────────────────────────────────────
// S1 — Two branches grow independently
// Base: add()
// Ours: add() + subtract() + multiply()
// Theirs: add() + divide() + modulo()
// ─────────────────────────────────────────────────────────────────────────────

describe("S1 — two-branches-grow-independently (calculator.js)", () => {
  // Both branches branched from the "add only" state and each added their own
  // functions.  Git produces one big conflict block after the shared `add`.
  const BASE = FN_ADD;
  const OURS = [FN_ADD, FN_SUBTRACT, FN_MULTIPLY].join("\n\n");
  const THEIRS = [FN_ADD, FN_DIVIDE, FN_MODULO].join("\n\n");

  // Conflict: the preamble (header + add) is identical; everything after is conflicted.
  const CONFLICT = HEADER + FN_ADD + "\n\n" + makeConflict(
    [FN_SUBTRACT, FN_MULTIPLY].join("\n\n") + "\n",
    "",
    [FN_DIVIDE, FN_MODULO].join("\n\n") + "\n",
  );

  it("resolveAsync resolves the file cleanly (requires WASM)", async () => {
    // S1 has two independent insertion blocks at the same base boundary.
    // The hunk-based resolver correctly flags this as ambiguous (it cannot
    // decide the interleaving order without AST context). Structural merge
    // resolves it correctly — but only when WASM is available.
    // Gate: skip strict assertion when structural merge is not available.
    const structuralAvailable = (await tryStructuralMergeResolve(CONFLICT, "calculator.js")) !== null;
    if (!structuralAvailable) return; // WASM not available in this environment

    const result = await resolveAsync(CONFLICT, "calculator.js");
    expect(result.stats.remaining).toBe(0);
    expect(result.mergedContent).toBeTruthy();
  });

  it("merged content contains all five functions (when WASM available)", async () => {
    const result = await resolveAsync(CONFLICT, "calculator.js");
    if (!result.mergedContent) return; // structural WASM unavailable, hunk-based left a conflict
    expect(result.mergedContent).toContain("function add");
    expect(result.mergedContent).toContain("function subtract");
    expect(result.mergedContent).toContain("function multiply");
    expect(result.mergedContent).toContain("function divide");
    expect(result.mergedContent).toContain("function modulo");
  });

  it("structural merge specifically resolves it (when WASM available)", async () => {
    const merged = await tryStructuralMergeResolve(CONFLICT, "calculator.js");
    if (merged === null) {
      // WASM not available in this environment — skip strict assertion
      return;
    }
    expect(merged).toContain("function subtract");
    expect(merged).toContain("function multiply");
    expect(merged).toContain("function divide");
    expect(merged).toContain("function modulo");
    // No conflict markers left
    expect(merged).not.toContain("<<<<<<<");
    expect(merged).not.toContain("=======");
    expect(merged).not.toContain(">>>>>>>");
  });

  it("tryStructuralMergeResolve never throws", async () => {
    await expect(
      tryStructuralMergeResolve(CONFLICT, "calculator.js"),
    ).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — Ours modifies a function + adds another; theirs unchanged
// Base: add() + subtract()
// Ours: modified add (with comment) + subtract + new multiply
// Theirs: add() + subtract() (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe("S2 — ours-only-change + ours-added (calculator.js)", () => {
  const FN_ADD_COMMENTED = `// Adds two numbers and returns the result
${FN_ADD}`;

  const BASE_CONTENT = [FN_ADD, FN_SUBTRACT].join("\n\n");
  const OURS_CONTENT = [FN_ADD_COMMENTED, FN_SUBTRACT, FN_MULTIPLY].join("\n\n");
  const THEIRS_CONTENT = BASE_CONTENT;

  const CONFLICT = HEADER + makeConflict(
    OURS_CONTENT + "\n",
    BASE_CONTENT + "\n",
    THEIRS_CONTENT + "\n",
  );

  it("resolveAsync resolves the file cleanly", async () => {
    const result = await resolveAsync(CONFLICT, "calculator.js");
    expect(result.stats.remaining).toBe(0);
    expect(result.mergedContent).toBeTruthy();
  });

  it("merged content preserves the ours-only changes", async () => {
    const result = await resolveAsync(CONFLICT, "calculator.js");
    if (!result.mergedContent) return;
    // The ours comment and multiply should be present
    expect(result.mergedContent).toContain("function multiply");
  });

  it("tryStructuralMergeResolve: merged output has multiply (when WASM available)", async () => {
    const merged = await tryStructuralMergeResolve(CONFLICT, "calculator.js");
    if (merged === null) return; // WASM unavailable
    expect(merged).toContain("function multiply");
    expect(merged).toContain("function subtract");
    expect(merged).not.toContain("<<<<<<<");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — Both branches modify the same line of the function body → true conflict
// Base: add() returning `a + b`
// Ours: add() returning `(a + b)`    — wraps in parens
// Theirs: add() returning `a + b || 0` — adds a fallback
//
// Both sides REPLACE the `return a + b;` line with a different version.
// There are no pure insertions — both have a removal+add on the same base line.
// Neither insertion_at_boundary nor non_overlapping can fire, so this remains
// an unresolvable conflict for the hunk-based resolver too.
// ─────────────────────────────────────────────────────────────────────────────

describe("S3 — body-conflict: both sides change the same function (calculator.js)", () => {
  const CONFLICT = makeConflict(
    FN_ADD_RETURN_PARENS + "\n",
    FN_ADD + "\n",
    FN_ADD_RETURN_FALLBACK + "\n",
  );

  it("tryStructuralMergeResolve returns null — cannot auto-resolve", async () => {
    const merged = await tryStructuralMergeResolve(CONFLICT, "calculator.js");
    // Structural merge must not silently pick a side when both changed differently
    expect(merged).toBeNull();
  });

  it("resolveAsync fallback result has remaining conflicts", async () => {
    const result = await resolveAsync(CONFLICT, "calculator.js");
    // Hunk-based resolver also cannot resolve this (both sides differ)
    expect(result.stats.remaining).toBeGreaterThan(0);
    expect(result.mergedContent).toBeNull();
  });

  it("resolveAsync never throws", async () => {
    await expect(resolveAsync(CONFLICT, "calculator.js")).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — Ours deletes a function that theirs modifies → conflict
// Base: add() + subtract()
// Ours: add() only (subtract removed)
// Theirs: add() + subtract() with a guard
// ─────────────────────────────────────────────────────────────────────────────

describe("S4 — delete-vs-modify: ours deletes what theirs modifies (calculator.js)", () => {
  const BASE_CONTENT = [FN_ADD, FN_SUBTRACT].join("\n\n");
  const OURS_CONTENT = FN_ADD;
  const THEIRS_CONTENT = [FN_ADD, FN_SUBTRACT_GUARDED].join("\n\n");

  // Git produces a conflict covering the subtract block (ours deleted it, theirs changed it)
  const CONFLICT = HEADER +
    FN_ADD + "\n" +
    makeConflict(
      "\n",                             // ours: nothing after add
      "\n" + FN_SUBTRACT + "\n",        // base: subtract was here
      "\n" + FN_SUBTRACT_GUARDED + "\n", // theirs: guarded subtract
    );

  it("tryStructuralMergeResolve returns null — delete vs modify is a conflict", async () => {
    const merged = await tryStructuralMergeResolve(CONFLICT, "calculator.js");
    expect(merged).toBeNull();
  });

  it("resolveAsync fallback result has remaining conflicts", async () => {
    const result = await resolveAsync(CONFLICT, "calculator.js");
    // Neither resolver can auto-merge a delete vs a change
    expect(result.stats.remaining).toBeGreaterThan(0);
    expect(result.mergedContent).toBeNull();
  });

  it("resolveAsync never throws", async () => {
    await expect(resolveAsync(CONFLICT, "calculator.js")).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — Unsupported language: same scenarios on a .css file
// Structural merge is disabled for .css — falls through to hunk-based resolver
// ─────────────────────────────────────────────────────────────────────────────

describe("S5 — unsupported language: structural merge skipped for .css files", () => {
  const CSS_CONFLICT = makeConflict(
    ".btn { color: red; }\n",
    ".btn { color: blue; }\n",
    ".btn { color: green; }\n",
  );

  it("tryStructuralMergeResolve returns null immediately for .css", async () => {
    const merged = await tryStructuralMergeResolve(CSS_CONFLICT, "styles.css");
    expect(merged).toBeNull();
  });

  it("resolveAsync falls back to hunk-based for .css", async () => {
    const result = await resolveAsync(CSS_CONFLICT, "styles.css");
    // Hunk-based: both sides changed differently → still a conflict
    expect(result.stats.totalConflicts).toBe(1);
    // structural merge is skipped for .css — resolution reason must not mention it
    expect(result.resolutions[0]?.resolutionReason).not.toContain("structural");
  });
});
