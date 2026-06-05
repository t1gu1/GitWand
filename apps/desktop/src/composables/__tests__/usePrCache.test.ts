import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PullRequest } from "../../utils/backend";
import type { DetailBundle } from "../usePrCache";

// Re-imported in beforeEach so each test starts from a clean module + storage.
let usePrCache: typeof import("../usePrCache").usePrCache;
let listKey: typeof import("../usePrCache").listKey;
let detailKey: typeof import("../usePrCache").detailKey;
let _resetPrCacheForTesting: typeof import("../usePrCache")._resetPrCacheForTesting;
let PR_CACHE_STORAGE_KEY: string;

beforeEach(async () => {
  localStorage.clear();
  const mod = await import("../usePrCache");
  usePrCache = mod.usePrCache;
  listKey = mod.listKey;
  detailKey = mod.detailKey;
  _resetPrCacheForTesting = mod._resetPrCacheForTesting;
  PR_CACHE_STORAGE_KEY = mod.PR_CACHE_STORAGE_KEY;
  _resetPrCacheForTesting();
});

const CWD = "/repo/a";

function makePr(n: number): PullRequest {
  return {
    number: n,
    title: `PR ${n}`,
    state: "OPEN",
    author: "alice",
    branch: `feat-${n}`,
    base: "main",
    draft: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    url: `https://github.com/o/r/pull/${n}`,
    additions: 1,
    deletions: 0,
    labels: [],
    assignees: [],
    reviewRequested: [],
    reviewDecision: "",
    mergeStateStatus: "",
    checksRollup: "",
  } as unknown as PullRequest;
}

function makeBundle(n: number): DetailBundle {
  return {
    detail: { number: n, title: `PR ${n}` } as any,
    checks: [],
    comments: [],
    issueComments: [],
    reviews: [],
  };
}

describe("usePrCache — list", () => {
  it("setList → getList round-trips prs + hasMore", () => {
    const c = usePrCache();
    const key = listKey(CWD, "open");
    c.setList(key, [makePr(1), makePr(2)], true);
    const got = c.getList(key);
    expect(got?.prs.map((p) => p.number)).toEqual([1, 2]);
    expect(got?.hasMore).toBe(true);
  });

  it("persists to localStorage and survives a module reset (cold start)", () => {
    usePrCache().setList(listKey(CWD, "open"), [makePr(7)], false);
    expect(localStorage.getItem(PR_CACHE_STORAGE_KEY)).toBeTruthy();
    _resetPrCacheForTesting(); // simulate app restart re-reading disk
    expect(usePrCache().getList(listKey(CWD, "open"))?.prs[0].number).toBe(7);
  });

  it("keys are isolated by filter state", () => {
    const c = usePrCache();
    c.setList(listKey(CWD, "open"), [makePr(1)], false);
    c.setList(listKey(CWD, "closed"), [makePr(2)], false);
    expect(c.getList(listKey(CWD, "open"))?.prs[0].number).toBe(1);
    expect(c.getList(listKey(CWD, "closed"))?.prs[0].number).toBe(2);
  });

  it("invalidateLists drops every filter cache for the repo only", () => {
    const c = usePrCache();
    c.setList(listKey(CWD, "open"), [makePr(1)], false);
    c.setList(listKey(CWD, "all"), [makePr(2)], false);
    c.setList(listKey("/repo/b", "open"), [makePr(3)], false);
    c.invalidateLists(CWD);
    expect(c.getList(listKey(CWD, "open"))).toBeNull();
    expect(c.getList(listKey(CWD, "all"))).toBeNull();
    expect(c.getList(listKey("/repo/b", "open"))?.prs[0].number).toBe(3);
  });
});

describe("usePrCache — detail", () => {
  it("setDetail → getDetail round-trips the bundle", () => {
    const c = usePrCache();
    const key = detailKey(CWD, 42);
    c.setDetail(key, makeBundle(42));
    expect(c.getDetail(key)?.detail.number).toBe(42);
  });

  it("list and detail namespaces don't collide", () => {
    const c = usePrCache();
    c.setList(listKey(CWD, "open"), [makePr(1)], false);
    c.setDetail(detailKey(CWD, 1), makeBundle(1));
    expect(c.getList(listKey(CWD, "open"))).not.toBeNull();
    expect(c.getDetail(detailKey(CWD, 1))).not.toBeNull();
  });

  it("invalidateDetail removes only the targeted PR", () => {
    const c = usePrCache();
    c.setDetail(detailKey(CWD, 1), makeBundle(1));
    c.setDetail(detailKey(CWD, 2), makeBundle(2));
    c.invalidateDetail(CWD, 1);
    expect(c.getDetail(detailKey(CWD, 1))).toBeNull();
    expect(c.getDetail(detailKey(CWD, 2))).not.toBeNull();
  });
});

describe("usePrCache — TTL & eviction", () => {
  it("drops entries older than the max age on load", () => {
    // Seed storage directly with a stale list (ts well beyond 24h).
    const stale = {
      lists: { [listKey(CWD, "open")]: { prs: [makePr(1)], hasMore: false, ts: Date.now() - 48 * 3600 * 1000 } },
      details: {},
      remotes: {},
    };
    localStorage.setItem(PR_CACHE_STORAGE_KEY, JSON.stringify(stale));
    _resetPrCacheForTesting();
    expect(usePrCache().getList(listKey(CWD, "open"))).toBeNull();
  });

  it("LRU-caps detail entries (oldest evicted past the cap)", () => {
    const c = usePrCache();
    // MAX_DETAILS is 40 — write 45 and confirm the oldest are gone, newest kept.
    for (let i = 1; i <= 45; i++) c.setDetail(detailKey(CWD, i), makeBundle(i));
    expect(c.getDetail(detailKey(CWD, 1))).toBeNull();
    expect(c.getDetail(detailKey(CWD, 45))).not.toBeNull();
  });
});

describe("usePrCache — quota safety", () => {
  afterEach(() => vi.restoreAllMocks());

  it("swallows write failures (QuotaExceededError) without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const c = usePrCache();
    expect(() => c.setList(listKey(CWD, "open"), [makePr(1)], false)).not.toThrow();
  });
});
