/**
 * Tests for structural/reconstruct.ts — file reconstruction from entity merges.
 * Pure logic, no tree-sitter / WASM dependency.
 */

import { describe, it, expect } from "vitest";
import { reconstructFile } from "../../structural/reconstruct.js";
import type { TopLevelEntity } from "../../structural/entities.js";
import type { EntityMergeResult } from "../../structural/merge.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntity(sig: string, text: string, start: number): TopLevelEntity {
  return {
    signature: sig,
    kind: "function",
    text,
    startByte: start,
    endByte: start + text.length,
    startLine: 0,
  };
}

function included(sig: string, mergedText: string): EntityMergeResult {
  return { signature: sig, include: true, mergedText, reason: "test" };
}

function excluded(sig: string): EntityMergeResult {
  return { signature: sig, include: false, mergedText: null, reason: "deleted" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reconstructFile", () => {
  it("emits a single entity verbatim", () => {
    const source = "function foo() {}";
    const e = makeEntity("function:foo", "function foo() {}", 0);
    const result = reconstructFile([included("function:foo", "function foo() {}")], [e], [], source);
    expect(result).toBe("function foo() {}");
  });

  it("preserves gap between two entities", () => {
    const source = "function foo() {}\n\nfunction bar() {}";
    const foo = makeEntity("function:foo", "function foo() {}", 0);
    const bar = makeEntity("function:bar", "function bar() {}", 19);
    const result = reconstructFile(
      [
        included("function:foo", "function foo() {}"),
        included("function:bar", "function bar() {}"),
      ],
      [foo, bar],
      [],
      source,
    );
    expect(result).toBe(source);
  });

  it("uses merged text instead of theirs text when changed", () => {
    const source = "function foo() {}";
    const e = makeEntity("function:foo", "function foo() {}", 0);
    const result = reconstructFile(
      [included("function:foo", "function foo() { return 42; }")],
      [e],
      [],
      source,
    );
    expect(result).toBe("function foo() { return 42; }");
  });

  it("omits deleted entities while preserving surrounding gaps", () => {
    // theirs: foo\n\nbar — bar is deleted
    const source = "function foo() {}\n\nfunction bar() {}";
    const foo = makeEntity("function:foo", "function foo() {}", 0);
    const bar = makeEntity("function:bar", "function bar() {}", 19);
    const result = reconstructFile(
      [included("function:foo", "function foo() {}"), excluded("function:bar")],
      [foo, bar],
      [],
      source,
    );
    // The gap "\n\n" before bar is emitted, but bar's text is omitted
    expect(result).toBe("function foo() {}\n\n");
  });

  it("appends ours-added entities after theirs content", () => {
    const theirsSource = "function foo() {}";
    const theirsFoo = makeEntity("function:foo", "function foo() {}", 0);
    const oursBar = makeEntity("function:bar", "function bar() {}", 99);

    const result = reconstructFile(
      [
        included("function:foo", "function foo() {}"),
        included("function:bar", "function bar() {}"),
      ],
      [theirsFoo],
      [oursBar],
      theirsSource,
    );
    expect(result).toContain("function foo() {}");
    expect(result).toContain("function bar() {}");
  });

  it("preserves trailing content from theirs source", () => {
    const source = "function foo() {}\n// EOF\n";
    const e = makeEntity("function:foo", "function foo() {}", 0);
    const result = reconstructFile(
      [included("function:foo", "function foo() {}")],
      [e],
      [],
      source,
    );
    expect(result).toBe("function foo() {}\n// EOF\n");
  });

  it("handles empty entity list", () => {
    const result = reconstructFile([], [], [], "");
    expect(result).toBe("");
  });

  it("does not double-emit entities that appear in both theirs and ours", () => {
    const source = "function foo() {}";
    const e = makeEntity("function:foo", "function foo() {}", 0);
    const result = reconstructFile(
      [included("function:foo", "function foo() {}")],
      [e],
      [e], // same entity in ours
      source,
    );
    // Should appear exactly once
    const count = (result.match(/function foo/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("handles reordered entities by following theirs order", () => {
    // theirs order: bar then foo
    const source = "function bar() {}\nfunction foo() {}";
    const bar = makeEntity("function:bar", "function bar() {}", 0);
    const foo = makeEntity("function:foo", "function foo() {}", 18);

    const result = reconstructFile(
      [
        included("function:bar", "function bar() {}"),
        included("function:foo", "function foo() {}"),
      ],
      [bar, foo], // theirs order
      [foo, bar], // ours order (reversed)
      source,
    );
    // Result should follow theirs order (bar before foo)
    const barIdx = result.indexOf("function bar");
    const fooIdx = result.indexOf("function foo");
    expect(barIdx).toBeLessThan(fooIdx);
  });
});
