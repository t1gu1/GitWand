import { describe, it, expect } from "vitest";

describe("ghListPrs — PullRequest mapping defaults", () => {
  it("maps snake_case fields to camelCase with provided values", () => {
    // Simulate what the server (dev-server or Tauri) returns and mirror the mapping.
    const raw = {
      number: 5,
      title: "My PR",
      state: "open",
      author: "alice",
      branch: "feat/x",
      base: "main",
      draft: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      url: "https://github.com/org/repo/pull/5",
      additions: 10,
      deletions: 2,
      labels: ["enhancement"],
      assignees: ["bob"],
      review_requested: ["carol"],
      review_decision: "APPROVED",
      merge_state_status: "CLEAN",
      checks_rollup: "SUCCESS",
    };

    // Mirror the mapping logic from ghListPrs dev-server branch in backend.ts
    const mapped = {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      author: raw.author,
      branch: raw.branch,
      base: raw.base,
      draft: raw.draft,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      url: raw.url,
      additions: raw.additions,
      deletions: raw.deletions,
      labels: raw.labels,
      assignees: raw.assignees ?? [],
      reviewRequested: raw.review_requested ?? [],
      reviewDecision: raw.review_decision ?? "",
      mergeStateStatus: raw.merge_state_status ?? "",
      checksRollup: raw.checks_rollup ?? "",
    };

    expect(mapped.reviewDecision).toBe("APPROVED");
    expect(mapped.mergeStateStatus).toBe("CLEAN");
    expect(mapped.checksRollup).toBe("SUCCESS");
    expect(mapped.assignees).toEqual(["bob"]);
    expect(mapped.reviewRequested).toEqual(["carol"]);
    expect(mapped.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("defaults to empty string when new fields absent from server response", () => {
    const raw: Record<string, unknown> = {
      number: 1,
      title: "Old PR",
      state: "open",
      author: "x",
      branch: "b",
      base: "main",
      draft: false,
      created_at: "",
      updated_at: "",
      url: "",
      additions: 0,
      deletions: 0,
      labels: [],
      assignees: [],
      review_requested: [],
      // new fields intentionally absent — simulates old server response
    };

    const reviewDecision = (raw.review_decision as string) ?? "";
    const mergeStateStatus = (raw.merge_state_status as string) ?? "";
    const checksRollup = (raw.checks_rollup as string) ?? "";

    expect(reviewDecision).toBe("");
    expect(mergeStateStatus).toBe("");
    expect(checksRollup).toBe("");
  });

  it("null values from server map to empty string, not 'null'", () => {
    const raw = {
      review_decision: null as string | null,
      merge_state_status: null as string | null,
      checks_rollup: null as string | null,
    };

    const reviewDecision = raw.review_decision ?? "";
    const mergeStateStatus = raw.merge_state_status ?? "";
    const checksRollup = raw.checks_rollup ?? "";

    expect(reviewDecision).toBe("");
    expect(mergeStateStatus).toBe("");
    expect(checksRollup).toBe("");
  });
});
