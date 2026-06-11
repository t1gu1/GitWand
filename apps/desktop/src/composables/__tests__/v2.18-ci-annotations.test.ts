/**
 * v2.18 unit tests — Inline CI Check Annotations.
 *
 * Covers the pure mapping layer (`mapAnnotation` snake_case → camelCase,
 * level normalization) — the part shared by the three forge wrappers
 * (gh_check_annotations, gl_mr_annotations, bb_pr_annotations).
 */

import { describe, it, expect } from "vitest";
import { mapAnnotation, type CIAnnotationRaw } from "../../utils/backend-pr";

function raw(overrides: Partial<CIAnnotationRaw> = {}): CIAnnotationRaw {
  return {
    check_name: "lint",
    path: "src/app.ts",
    start_line: 10,
    end_line: 12,
    level: "failure",
    title: "no-unused-vars",
    message: "'x' is defined but never used.",
    ...overrides,
  };
}

describe("mapAnnotation (v2.18)", () => {
  it("maps snake_case backend fields to camelCase", () => {
    const a = mapAnnotation(raw());
    expect(a).toEqual({
      checkName: "lint",
      path: "src/app.ts",
      startLine: 10,
      endLine: 12,
      level: "failure",
      title: "no-unused-vars",
      message: "'x' is defined but never used.",
    });
  });

  it("keeps the canonical levels untouched", () => {
    expect(mapAnnotation(raw({ level: "failure" })).level).toBe("failure");
    expect(mapAnnotation(raw({ level: "warning" })).level).toBe("warning");
    expect(mapAnnotation(raw({ level: "notice" })).level).toBe("notice");
  });

  it("normalizes unknown levels to notice", () => {
    // A forge introducing a new level must degrade gracefully, never crash the gutter.
    expect(mapAnnotation(raw({ level: "info" })).level).toBe("notice");
    expect(mapAnnotation(raw({ level: "" })).level).toBe("notice");
    expect(mapAnnotation(raw({ level: "FAILURE" })).level).toBe("notice");
  });

  it("preserves single-line annotations (start == end)", () => {
    const a = mapAnnotation(raw({ start_line: 42, end_line: 42 }));
    expect(a.startLine).toBe(42);
    expect(a.endLine).toBe(42);
  });
});
