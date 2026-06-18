import { describe, it, expect } from "vitest";
import { branchSort } from "../utils/branchSort";
import type { GitBranch } from "../utils/backend";

function branch(partial: Partial<GitBranch> & { name: string }): GitBranch {
  return {
    isCurrent: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    mainCommitCount: 0,
    lastCommit: "",
    lastCommitDate: "",
    ...partial,
  };
}

/** Sort a copy and return the resulting name order. */
function order(branches: GitBranch[]): string[] {
  return [...branches].sort(branchSort).map((b) => b.name);
}

describe("branchSort", () => {
  it("puts the current branch first, whatever its date or name", () => {
    const result = order([
      branch({ name: "aaa", lastCommitDate: "2026-06-18T00:00:00Z" }),
      branch({ name: "zzz-current", isCurrent: true, lastCommitDate: "2020-01-01T00:00:00Z" }),
      branch({ name: "main" }),
    ]);
    expect(result[0]).toBe("zzz-current");
  });

  it("ranks main/master ahead of feature branches (after current)", () => {
    const result = order([
      branch({ name: "feature/x", lastCommitDate: "2026-06-18T00:00:00Z" }),
      branch({ name: "master", lastCommitDate: "2020-01-01T00:00:00Z" }),
    ]);
    expect(result).toEqual(["master", "feature/x"]);
  });

  it("orders by most-recent commit date (desc) among peers", () => {
    const result = order([
      branch({ name: "old", lastCommitDate: "2026-01-01T00:00:00Z" }),
      branch({ name: "newest", lastCommitDate: "2026-06-18T12:00:00Z" }),
      branch({ name: "mid", lastCommitDate: "2026-03-15T00:00:00Z" }),
    ]);
    expect(result).toEqual(["newest", "mid", "old"]);
  });

  it("treats origin/main as main for the priority bucket", () => {
    const result = order([
      branch({ name: "feature/x", lastCommitDate: "2026-06-18T00:00:00Z" }),
      branch({ name: "origin/main", isRemote: true, lastCommitDate: "2020-01-01T00:00:00Z" }),
    ]);
    expect(result[0]).toBe("origin/main");
  });

  it("falls back to name order when dates are equal or missing", () => {
    const result = order([
      branch({ name: "charlie" }),
      branch({ name: "alpha" }),
      branch({ name: "bravo" }),
    ]);
    expect(result).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("is a stable total order (sort does not throw on mixed inputs)", () => {
    const result = order([
      branch({ name: "main" }),
      branch({ name: "feature/dated", lastCommitDate: "2026-06-18T00:00:00Z" }),
      branch({ name: "feature/undated" }),
      branch({ name: "current", isCurrent: true }),
    ]);
    // current → main → dated peer → undated peer (name fallback for undated).
    expect(result).toEqual(["current", "main", "feature/dated", "feature/undated"]);
  });
});
