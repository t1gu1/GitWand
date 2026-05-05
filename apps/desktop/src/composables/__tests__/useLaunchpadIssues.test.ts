import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceRepoIssues, WorkspaceRepo, Issue } from "../../utils/backend";

vi.mock("../../utils/backend", () => ({
  workspaceIssuesAll: vi.fn(),
}));

import { workspaceIssuesAll } from "../../utils/backend";
import { useLaunchpadIssues } from "../useLaunchpadIssues";

const mockFetch = vi.mocked(workspaceIssuesAll);

const REPOS: WorkspaceRepo[] = [
  { path: "/repo/a", name: "alpha" },
  { path: "/repo/b", name: "beta" },
];

const MOCK_ISSUE: Issue = {
  number: 7,
  title: "Fix crash on startup",
  state: "OPEN",
  author: "alice",
  assignees: ["bob"],
  labels: ["bug"],
  url: "https://github.com/org/alpha/issues/7",
  createdAt: "2026-03-01T10:00:00Z",
  updatedAt: "2026-03-02T12:00:00Z",
  milestone: "v2.9.0",
};

const MOCK_DATA: WorkspaceRepoIssues[] = [
  { repoPath: "/repo/a", repoName: "alpha", issues: [MOCK_ISSUE], filter: "assigned", error: null },
  { repoPath: "/repo/b", repoName: "beta", issues: [], filter: "assigned", error: null },
];

describe("useLaunchpadIssues", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("starts with empty repos, loading false, error null", () => {
    const { repos, loading, error } = useLaunchpadIssues();
    expect(repos.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("activeFilter defaults to 'assigned'", () => {
    const { activeFilter } = useLaunchpadIssues();
    expect(activeFilter.value).toBe("assigned");
  });

  it("populates repos after successful refresh", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { repos, loading, error, refresh, activeFilter } = useLaunchpadIssues();

    await refresh(REPOS);

    expect(mockFetch).toHaveBeenCalledWith(REPOS, activeFilter.value);
    expect(repos.value).toEqual(MOCK_DATA);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("allIssues computed flattens issues with repo context", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { allIssues, refresh } = useLaunchpadIssues();
    await refresh(REPOS);

    expect(allIssues.value).toHaveLength(1); // only alpha has an issue
    expect(allIssues.value[0].repoName).toBe("alpha");
    expect(allIssues.value[0].number).toBe(7);
  });

  it("sets error and keeps previous repos when workspaceIssuesAll throws", async () => {
    mockFetch.mockResolvedValue(MOCK_DATA);
    const { repos, error, refresh } = useLaunchpadIssues();
    await refresh(REPOS);

    mockFetch.mockRejectedValue(new Error("network error"));
    await refresh(REPOS);

    expect(error.value).toBe("network error");
    expect(repos.value).toEqual(MOCK_DATA); // preserved
  });

  it("sets loading true during fetch", async () => {
    let resolve!: (v: WorkspaceRepoIssues[]) => void;
    mockFetch.mockReturnValue(new Promise(r => { resolve = r; }));

    const { loading, refresh } = useLaunchpadIssues();
    const p = refresh(REPOS);
    expect(loading.value).toBe(true);
    resolve(MOCK_DATA);
    await p;
    expect(loading.value).toBe(false);
  });
});
