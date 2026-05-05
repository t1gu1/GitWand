import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceRepoPrs, WorkspaceRepo, PullRequest } from "../../utils/backend";

vi.mock("../../utils/backend", () => ({
  workspacePrsAll: vi.fn(),
}));

import { workspacePrsAll } from "../../utils/backend";
import { useLaunchpadPrs } from "../useLaunchpadPrs";

const mockFetch = vi.mocked(workspacePrsAll);

const REPOS: WorkspaceRepo[] = [
  { path: "/repo/a", name: "alpha" },
  { path: "/repo/b", name: "beta" },
];

const MOCK_PR: PullRequest = {
  number: 42, title: "Add feature", state: "OPEN", author: "alice",
  branch: "feat/x", base: "main", draft: false,
  createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-02T10:00:00Z",
  url: "https://github.com/org/alpha/pull/42",
  additions: 10, deletions: 3,
  labels: ["enhancement"], assignees: [], reviewRequested: ["bob"],
  reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "CLEAN", checksRollup: "SUCCESS",
};

const MOCK_DATA: WorkspaceRepoPrs[] = [
  { repoPath: "/repo/a", repoName: "alpha", prs: [MOCK_PR], error: null },
  { repoPath: "/repo/b", repoName: "beta", prs: [], error: null },
];

describe("useLaunchpadPrs", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("starts with empty repos, loading false, error null", () => {
    const { repos, loading, error } = useLaunchpadPrs();
    expect(repos.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("populates repos after successful refresh", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { repos, loading, error, refresh } = useLaunchpadPrs();

    await refresh(REPOS);

    expect(mockFetch).toHaveBeenCalledWith(REPOS);
    expect(repos.value).toEqual(MOCK_DATA);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("allPrs computed flattens prs with repo context", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { allPrs, refresh } = useLaunchpadPrs();
    await refresh(REPOS);

    expect(allPrs.value).toHaveLength(1); // only alpha has a PR
    expect(allPrs.value[0].repoName).toBe("alpha");
    expect(allPrs.value[0].number).toBe(42);
  });

  it("sets error and keeps previous repos when workspacePrsAll throws", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { repos, error, refresh } = useLaunchpadPrs();
    await refresh(REPOS);

    mockFetch.mockRejectedValue(new Error("network error"));
    await refresh(REPOS);

    expect(error.value).toBe("network error");
    expect(repos.value).toEqual(MOCK_DATA); // preserved
  });

  it("sets loading true during fetch", async () => {
    let resolve!: (v: WorkspaceRepoPrs[]) => void;
    mockFetch.mockReturnValue(new Promise(r => { resolve = r; }));

    const { loading, refresh } = useLaunchpadPrs();
    const p = refresh(REPOS);
    expect(loading.value).toBe(true);
    resolve(MOCK_DATA);
    await p;
    expect(loading.value).toBe(false);
  });
});
