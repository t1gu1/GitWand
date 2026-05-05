import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceWipItem, WorkspaceRepo } from "../../utils/backend";

// Mock the backend module before importing the composable
vi.mock("../../utils/backend", () => ({
  workspaceWipAll: vi.fn(),
}));

import { workspaceWipAll } from "../../utils/backend";
import { useLaunchpadWip } from "../useLaunchpadWip";

const mockWip = vi.mocked(workspaceWipAll);

const REPOS: WorkspaceRepo[] = [
  { path: "/repo/a", name: "alpha" },
  { path: "/repo/b", name: "beta" },
];

const MOCK_ITEMS: WorkspaceWipItem[] = [
  {
    path: "/repo/a", name: "alpha", branch: "main",
    ahead: 2, behind: 0,
    stagedCount: 1, unstagedCount: 3, untrackedCount: 0,
    lastCommitAt: "2026-05-01T10:00:00+02:00",
    hasNoUpstream: false, error: null, changedFiles: [],
  },
  {
    path: "/repo/b", name: "beta", branch: "feat/x",
    ahead: 0, behind: 0,
    stagedCount: 0, unstagedCount: 0, untrackedCount: 2,
    lastCommitAt: "2026-04-30T08:00:00+02:00",
    hasNoUpstream: true, error: null, changedFiles: [],
  },
];

describe("useLaunchpadWip", () => {
  beforeEach(() => {
    mockWip.mockReset();
  });

  it("starts with empty wip, loading false, error null", () => {
    const { wip, loading, error } = useLaunchpadWip();
    expect(wip.value).toEqual([]);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("populates wip and clears error after successful refresh", async () => {
    mockWip.mockResolvedValue(MOCK_ITEMS);
    const { wip, loading, error, refresh } = useLaunchpadWip();

    await refresh(REPOS);

    expect(mockWip).toHaveBeenCalledWith(REPOS);
    expect(wip.value).toEqual(MOCK_ITEMS);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
  });

  it("sets error and keeps previous wip when workspaceWipAll throws", async () => {
    mockWip.mockResolvedValue(MOCK_ITEMS);
    const { wip, error, refresh } = useLaunchpadWip();
    await refresh(REPOS); // populate first

    mockWip.mockRejectedValue(new Error("network failure"));
    await refresh(REPOS);

    expect(error.value).toBe("network failure");
    expect(wip.value).toEqual(MOCK_ITEMS); // previous data preserved
  });

  it("sets loading true while fetch is in progress", async () => {
    let resolve!: (v: WorkspaceWipItem[]) => void;
    mockWip.mockReturnValue(new Promise(r => { resolve = r; }));

    const { loading, refresh } = useLaunchpadWip();
    const p = refresh(REPOS);
    expect(loading.value).toBe(true);
    resolve(MOCK_ITEMS);
    await p;
    expect(loading.value).toBe(false);
  });
});
