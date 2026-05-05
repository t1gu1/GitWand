/**
 * Tests for structural/merge.ts — entity-level merge decisions.
 * Pure logic, no tree-sitter / WASM dependency.
 */

import { describe, it, expect } from "vitest";
import { mergeEntity, hasEntityConflict } from "../../structural/merge.js";
import type { EntityMatch } from "../../structural/matching.js";
import type { TopLevelEntity } from "../../structural/entities.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function entity(text: string): TopLevelEntity {
  return {
    signature: "function:foo",
    kind: "function",
    text,
    startByte: 0,
    endByte: text.length,
    startLine: 0,
  };
}

function match(
  status: EntityMatch["status"],
  base?: string,
  ours?: string,
  theirs?: string,
): EntityMatch {
  return {
    signature: "function:foo",
    status,
    base: base !== undefined ? entity(base) : null,
    ours: ours !== undefined ? entity(ours) : null,
    theirs: theirs !== undefined ? entity(theirs) : null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mergeEntity", () => {
  it("unchanged → emit ours text (same as theirs)", () => {
    const result = mergeEntity(match("unchanged", "fn()", "fn()", "fn()"));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn()");
    expect(result.reason).toBe("unchanged");
  });

  it("both-changed-same with text → emit theirs", () => {
    const result = mergeEntity(match("both-changed-same", "fn()", "fn2()", "fn2()"));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn2()");
  });

  it("both-changed-same with both deleted → exclude", () => {
    const result = mergeEntity(
      match("both-changed-same", "fn()", undefined, undefined),
    );
    expect(result.include).toBe(false);
    expect(result.mergedText).toBeNull();
    expect(result.reason).toBe("both deleted");
  });

  it("ours-only-change → emit ours", () => {
    const result = mergeEntity(match("ours-only-change", "fn()", "fn2()", "fn()"));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn2()");
  });

  it("theirs-only-change → emit theirs", () => {
    const result = mergeEntity(match("theirs-only-change", "fn()", "fn()", "fn3()"));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn3()");
  });

  it("ours-added → include ours text", () => {
    const result = mergeEntity(match("ours-added", undefined, "fn_new()", undefined));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn_new()");
  });

  it("theirs-added → include theirs text", () => {
    const result = mergeEntity(match("theirs-added", undefined, undefined, "fn_new()"));
    expect(result.include).toBe(true);
    expect(result.mergedText).toBe("fn_new()");
  });

  it("ours-deleted (theirs unchanged) → exclude", () => {
    const result = mergeEntity(match("ours-deleted", "fn()", undefined, "fn()"));
    expect(result.include).toBe(false);
    expect(result.reason).toBe("ours deleted");
  });

  it("ours-deleted (theirs modified) → conflict", () => {
    const result = mergeEntity(match("ours-deleted", "fn()", undefined, "fn3()"));
    expect(result.include).toBe(false);
    expect(result.reason).toContain("conflict:");
  });

  it("theirs-deleted (ours unchanged) → exclude", () => {
    const result = mergeEntity(match("theirs-deleted", "fn()", "fn()", undefined));
    expect(result.include).toBe(false);
    expect(result.reason).toBe("theirs deleted");
  });

  it("theirs-deleted (ours modified) → conflict", () => {
    const result = mergeEntity(match("theirs-deleted", "fn()", "fn2()", undefined));
    expect(result.include).toBe(false);
    expect(result.reason).toContain("conflict:");
  });

  it("both-changed-diff → conflict with null mergedText", () => {
    const result = mergeEntity(match("both-changed-diff", "fn()", "fn1()", "fn2()"));
    expect(result.include).toBe(false);
    expect(result.mergedText).toBeNull();
    expect(result.reason).toContain("conflict:");
  });
});

describe("hasEntityConflict", () => {
  it("returns false when all merges are clean", () => {
    const merges = [
      mergeEntity(match("unchanged", "a", "a", "a")),
      mergeEntity(match("ours-added", undefined, "b", undefined)),
    ];
    expect(hasEntityConflict(merges)).toBe(false);
  });

  it("returns true when any merge has a conflict", () => {
    const merges = [
      mergeEntity(match("unchanged", "a", "a", "a")),
      mergeEntity(match("both-changed-diff", "a", "b", "c")),
    ];
    expect(hasEntityConflict(merges)).toBe(true);
  });

  it("ours-deleted (unchanged theirs) is NOT a conflict", () => {
    const merges = [mergeEntity(match("ours-deleted", "fn()", undefined, "fn()"))];
    expect(hasEntityConflict(merges)).toBe(false);
  });

  it("ours-deleted (modified theirs) IS a conflict", () => {
    const merges = [mergeEntity(match("ours-deleted", "fn()", undefined, "fn_modified()"))];
    expect(hasEntityConflict(merges)).toBe(true);
  });
});
