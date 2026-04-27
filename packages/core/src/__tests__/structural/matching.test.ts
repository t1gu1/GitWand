/**
 * Tests for structural/matching.ts — 3-way entity matching.
 * Pure logic, no tree-sitter / WASM dependency.
 */

import { describe, it, expect } from "vitest";
import { matchEntities } from "../../structural/matching.js";
import type { TopLevelEntity } from "../../structural/entities.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function entity(sig: string, text: string): TopLevelEntity {
  return {
    signature: sig,
    kind: "function",
    text,
    startByte: 0,
    endByte: text.length,
    startLine: 0,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("matchEntities", () => {
  it("marks entities identical in all three versions as unchanged", () => {
    const e = entity("function:foo", "function foo() {}");
    const matches = matchEntities([e], [e], [e]);
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe("unchanged");
  });

  it("detects ours-only-change", () => {
    const base = entity("function:foo", "function foo() {}");
    const ours = entity("function:foo", "function foo() { return 1; }");
    const theirs = entity("function:foo", "function foo() {}");
    const [m] = matchEntities([base], [ours], [theirs]);
    expect(m.status).toBe("ours-only-change");
    expect(m.ours?.text).toBe(ours.text);
  });

  it("detects theirs-only-change", () => {
    const base = entity("function:foo", "function foo() {}");
    const ours = entity("function:foo", "function foo() {}");
    const theirs = entity("function:foo", "function foo() { return 2; }");
    const [m] = matchEntities([base], [ours], [theirs]);
    expect(m.status).toBe("theirs-only-change");
  });

  it("detects both-changed-same when text is identical", () => {
    const base = entity("function:foo", "function foo() {}");
    const changed = entity("function:foo", "function foo() { /* same */ }");
    const [m] = matchEntities([base], [changed], [changed]);
    expect(m.status).toBe("both-changed-same");
  });

  it("detects both-changed-diff", () => {
    const base = entity("function:foo", "function foo() {}");
    const ours = entity("function:foo", "function foo() { return 1; }");
    const theirs = entity("function:foo", "function foo() { return 2; }");
    const [m] = matchEntities([base], [ours], [theirs]);
    expect(m.status).toBe("both-changed-diff");
  });

  it("detects ours-added (entity not in base or theirs)", () => {
    const e = entity("function:bar", "function bar() {}");
    const matches = matchEntities([], [e], []);
    expect(matches[0].status).toBe("ours-added");
  });

  it("detects theirs-added (entity not in base or ours)", () => {
    const e = entity("function:bar", "function bar() {}");
    const matches = matchEntities([], [], [e]);
    expect(matches[0].status).toBe("theirs-added");
  });

  it("detects ours-deleted", () => {
    const base = entity("function:foo", "function foo() {}");
    const theirs = entity("function:foo", "function foo() {}");
    const [m] = matchEntities([base], [], [theirs]);
    expect(m.status).toBe("ours-deleted");
  });

  it("detects theirs-deleted", () => {
    const base = entity("function:foo", "function foo() {}");
    const ours = entity("function:foo", "function foo() {}");
    const [m] = matchEntities([base], [ours], []);
    expect(m.status).toBe("theirs-deleted");
  });

  it("handles multiple entities with different statuses", () => {
    const unchanged = entity("function:unchanged", "function unchanged() {}");
    const oursAdded = entity("function:oursAdded", "function oursAdded() {}");
    const theirsAdded = entity("function:theirsAdded", "function theirsAdded() {}");
    const base = entity("function:deleted", "function deleted() {}");

    const matches = matchEntities(
      [unchanged, base],
      [unchanged, oursAdded],
      [unchanged, theirsAdded],
    );

    const byName = Object.fromEntries(matches.map((m) => [m.signature, m.status]));
    expect(byName["function:unchanged"]).toBe("unchanged");
    expect(byName["function:oursAdded"]).toBe("ours-added");
    expect(byName["function:theirsAdded"]).toBe("theirs-added");
    // "deleted" is in base but absent from both ours and theirs → both agreed to delete it
    expect(byName["function:deleted"]).toBe("both-changed-same");
  });

  it("preserves base+ours order with new signatures appended", () => {
    const a = entity("function:a", "function a() {}");
    const b = entity("function:b", "function b() {}");
    const c = entity("function:c", "function c() {}"); // only in theirs

    const matches = matchEntities([a, b], [a, b], [a, b, c]);
    expect(matches.map((m) => m.signature)).toEqual(["function:a", "function:b", "function:c"]);
  });

  it("both-deleted → both-changed-same", () => {
    const base = entity("function:foo", "function foo() {}");
    const [m] = matchEntities([base], [], []);
    expect(m.status).toBe("both-changed-same");
  });

  it("both added with same text → both-changed-same", () => {
    const e = entity("function:new", "function new() {}");
    const [m] = matchEntities([], [e], [e]);
    expect(m.status).toBe("both-changed-same");
  });

  it("both added with different text → both-changed-diff", () => {
    const ours = entity("function:new", "function new() { return 1; }");
    const theirs = entity("function:new", "function new() { return 2; }");
    const [m] = matchEntities([], [ours], [theirs]);
    expect(m.status).toBe("both-changed-diff");
  });
});
