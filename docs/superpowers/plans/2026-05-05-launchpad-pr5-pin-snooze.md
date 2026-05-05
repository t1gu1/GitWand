# Launchpad PR5: Pin / Snooze — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pin (surface important items at top) and snooze (temporarily hide items) to the Launchpad PRs and Issues panels.

**Architecture:** New `useLaunchpadPins` module-singleton composable owns localStorage persistence; `useLaunchpadPrs` and `useLaunchpadIssues` are modified to sort/filter via the pins API; `LaunchpadView.vue` gains a ⋮ dropdown menu per row, a pin badge, and a snoozed items bandeau.

**Tech Stack:** Vue 3 `<script setup>`, Vitest/jsdom, localStorage, TypeScript

---

## File Map

| Action | Path |
|--------|------|
| Create | `apps/desktop/src/composables/useLaunchpadPins.ts` |
| Create | `apps/desktop/src/composables/__tests__/useLaunchpadPins.test.ts` |
| Modify | `apps/desktop/src/composables/useLaunchpadPrs.ts` |
| Modify | `apps/desktop/src/composables/__tests__/useLaunchpadPrs.test.ts` |
| Modify | `apps/desktop/src/composables/useLaunchpadIssues.ts` |
| Modify | `apps/desktop/src/composables/__tests__/useLaunchpadIssues.test.ts` |
| Modify | `apps/desktop/src/locales/en.ts` |
| Modify | `apps/desktop/src/locales/fr.ts` |
| Modify | `apps/desktop/src/locales/es.ts` |
| Modify | `apps/desktop/src/locales/pt-BR.ts` |
| Modify | `apps/desktop/src/locales/zh-CN.ts` |
| Modify | `apps/desktop/src/components/LaunchpadView.vue` |

---

## Task 1: `useLaunchpadPins` composable — TDD

**Files:**
- Create: `apps/desktop/src/composables/__tests__/useLaunchpadPins.test.ts`
- Create: `apps/desktop/src/composables/useLaunchpadPins.ts`

- [ ] **Step 1: Write all 7 tests (they will fail — file doesn't exist yet)**

Create `apps/desktop/src/composables/__tests__/useLaunchpadPins.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";

// We import after clearing localStorage so the module reads fresh state
// We also import _resetPinsForTesting to re-read localStorage into the refs
let useLaunchpadPins: typeof import("../useLaunchpadPins").useLaunchpadPins;
let _resetPinsForTesting: typeof import("../useLaunchpadPins")._resetPinsForTesting;

beforeEach(async () => {
  localStorage.clear();
  // Dynamic import ensures we always get the module-level reset fn
  const mod = await import("../useLaunchpadPins");
  useLaunchpadPins = mod.useLaunchpadPins;
  _resetPinsForTesting = mod._resetPinsForTesting;
  _resetPinsForTesting();
});

const PR_URL = "https://github.com/org/repo/pull/1";
const ISSUE_URL = "https://github.com/org/repo/issues/5";

describe("useLaunchpadPins", () => {
  it("pin() adds item; isPinned() returns true", () => {
    const p = useLaunchpadPins();
    expect(p.isPinned(PR_URL)).toBe(false);
    p.pin(PR_URL, "pr");
    expect(p.isPinned(PR_URL)).toBe(true);
  });

  it("unpin() removes item; isPinned() returns false", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.unpin(PR_URL);
    expect(p.isPinned(PR_URL)).toBe(false);
  });

  it("snooze(url, type, 7) → isSnoozed() true; snoozedUntil() ≈ now + 7 days", () => {
    const p = useLaunchpadPins();
    const before = Date.now();
    p.snooze(PR_URL, "pr", 7);
    const after = Date.now();

    expect(p.isSnoozed(PR_URL)).toBe(true);

    const until = p.snoozedUntil(PR_URL);
    expect(until).not.toBeNull();
    const untilMs = new Date(until!).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(untilMs).toBeGreaterThanOrEqual(before + sevenDaysMs);
    expect(untilMs).toBeLessThanOrEqual(after + sevenDaysMs + 100);
  });

  it("snooze with past snoozedUntil → isSnoozed() returns false (auto-expiry)", () => {
    const p = useLaunchpadPins();
    // Manually insert an expired snooze via snooze() then patch localStorage
    p.snooze(PR_URL, "pr", 1);
    // Patch the stored data to put snoozedUntil in the past
    const raw = localStorage.getItem("gitwand-launchpad-pins")!;
    const data = JSON.parse(raw);
    data.snoozes[0].snoozedUntil = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem("gitwand-launchpad-pins", JSON.stringify(data));
    _resetPinsForTesting(); // re-load from localStorage

    const p2 = useLaunchpadPins();
    expect(p2.isSnoozed(PR_URL)).toBe(false);
  });

  it("unsnooze() removes snooze; isSnoozed() returns false", () => {
    const p = useLaunchpadPins();
    p.snooze(PR_URL, "pr", 3);
    expect(p.isSnoozed(PR_URL)).toBe(true);
    p.unsnooze(PR_URL);
    expect(p.isSnoozed(PR_URL)).toBe(false);
  });

  it("item can be both pinned and snoozed simultaneously", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.snooze(PR_URL, "pr", 1);
    expect(p.isPinned(PR_URL)).toBe(true);
    expect(p.isSnoozed(PR_URL)).toBe(true);
  });

  it("persistence: state survives a fresh call to useLaunchpadPins()", () => {
    const p = useLaunchpadPins();
    p.pin(PR_URL, "pr");
    p.snooze(ISSUE_URL, "issue", 14);

    // Simulate fresh module load by re-reading from localStorage
    _resetPinsForTesting();

    const p2 = useLaunchpadPins();
    expect(p2.isPinned(PR_URL)).toBe(true);
    expect(p2.isSnoozed(ISSUE_URL)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect 7 failures (module not found)**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadPins 2>&1 | tail -20
```

Expected: 7 failures with "Cannot find module '../useLaunchpadPins'"

- [ ] **Step 3: Implement `useLaunchpadPins.ts`**

Create `apps/desktop/src/composables/useLaunchpadPins.ts`:

```typescript
import { ref, computed } from "vue";

export interface PinnedItem {
  url: string;
  type: "pr" | "issue";
  pinnedAt: string; // ISO 8601
}

export interface SnoozedItem {
  url: string;
  type: "pr" | "issue";
  snoozedUntil: string; // ISO 8601 — item reappears after this date
}

const STORAGE_KEY = "gitwand-launchpad-pins";

interface StoredData {
  pins: PinnedItem[];
  snoozes: SnoozedItem[];
}

function loadFromStorage(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pins: [], snoozes: [] };
    return JSON.parse(raw) as StoredData;
  } catch {
    return { pins: [], snoozes: [] };
  }
}

function saveToStorage(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Module-level singleton state ──────────────────────────────────────────────
const _pins = ref<PinnedItem[]>([]);
const _snoozes = ref<SnoozedItem[]>([]);

function _init(): void {
  const stored = loadFromStorage();
  _pins.value = stored.pins;
  _snoozes.value = stored.snoozes;
}

_init();

/** Reset state from localStorage. Only exported for use in Vitest tests. */
export function _resetPinsForTesting(): void {
  _init();
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useLaunchpadPins() {
  /** All non-expired snooze entries. Recomputed reactively. */
  const activeSnoozed = computed<readonly SnoozedItem[]>(() =>
    _snoozes.value.filter((s) => new Date(s.snoozedUntil).getTime() > Date.now())
  );

  function persist(): void {
    // Lazily prune expired snoozes on every write
    const now = Date.now();
    _snoozes.value = _snoozes.value.filter(
      (s) => new Date(s.snoozedUntil).getTime() > now
    );
    saveToStorage({ pins: _pins.value, snoozes: _snoozes.value });
  }

  function pin(url: string, type: "pr" | "issue"): void {
    if (_pins.value.some((p) => p.url === url)) return;
    _pins.value = [..._pins.value, { url, type, pinnedAt: new Date().toISOString() }];
    persist();
  }

  function unpin(url: string): void {
    _pins.value = _pins.value.filter((p) => p.url !== url);
    persist();
  }

  function snooze(url: string, type: "pr" | "issue", days: 1 | 3 | 7 | 14): void {
    const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    // Replace any existing snooze for this URL
    _snoozes.value = _snoozes.value.filter((s) => s.url !== url);
    _snoozes.value = [..._snoozes.value, { url, type, snoozedUntil }];
    persist();
  }

  function unsnooze(url: string): void {
    _snoozes.value = _snoozes.value.filter((s) => s.url !== url);
    persist();
  }

  function isPinned(url: string): boolean {
    return _pins.value.some((p) => p.url === url);
  }

  /** Returns true only if a non-expired snooze exists for this URL. */
  function isSnoozed(url: string): boolean {
    const s = _snoozes.value.find((s) => s.url === url);
    if (!s) return false;
    return new Date(s.snoozedUntil).getTime() > Date.now();
  }

  /** Returns the ISO 8601 snoozedUntil string, or null if not snoozed. */
  function snoozedUntil(url: string): string | null {
    const s = _snoozes.value.find((s) => s.url === url);
    return s ? s.snoozedUntil : null;
  }

  return {
    pins: computed(() => _pins.value as readonly PinnedItem[]),
    activeSnoozed,
    pin,
    unpin,
    snooze,
    unsnooze,
    isPinned,
    isSnoozed,
    snoozedUntil,
  };
}
```

- [ ] **Step 4: Run tests — expect 7 passing**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadPins 2>&1 | tail -20
```

Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git add apps/desktop/src/composables/useLaunchpadPins.ts \
        apps/desktop/src/composables/__tests__/useLaunchpadPins.test.ts
git commit -m "$(cat <<'EOF'
feat(launchpad): add useLaunchpadPins module-singleton composable

Implements pin/snooze state with localStorage persistence.
7 Vitest tests: pin, unpin, snooze, expiry, unsnooze, coexistence, persistence.
EOF
)"
```

---

## Task 2: Modify `useLaunchpadPrs` — pin-sort + snooze-filter

**Files:**
- Modify: `apps/desktop/src/composables/__tests__/useLaunchpadPrs.test.ts`
- Modify: `apps/desktop/src/composables/useLaunchpadPrs.ts`

- [ ] **Step 1: Add 3 failing tests to the existing test file**

Open `apps/desktop/src/composables/__tests__/useLaunchpadPrs.test.ts` and add a new `describe` block at the end of the file, before the closing of the outer describe (or after — either works). The complete addition is:

```typescript
// Add these imports at the top of the file (after existing imports):
import { useLaunchpadPins, _resetPinsForTesting } from "../useLaunchpadPins";
```

And add this new describe block after the existing `describe("useLaunchpadPrs", () => { ... })`:

```typescript
describe("useLaunchpadPrs — pin/snooze integration", () => {
  const PR1_URL = "https://github.com/org/alpha/pull/10";
  const PR2_URL = "https://github.com/org/alpha/pull/20";

  const PR1: PullRequest = {
    ...MOCK_PR,
    number: 10,
    url: PR1_URL,
    createdAt: "2026-04-01T10:00:00Z", // older
    updatedAt: "2026-04-02T10:00:00Z",
  };
  const PR2: PullRequest = {
    ...MOCK_PR,
    number: 20,
    url: PR2_URL,
    createdAt: "2026-05-01T10:00:00Z", // newer
    updatedAt: "2026-05-02T10:00:00Z",
  };
  const DATA_TWO: WorkspaceRepoPrs[] = [
    { repoPath: "/repo/a", repoName: "alpha", prs: [PR1, PR2], error: null },
  ];

  beforeEach(() => {
    localStorage.clear();
    _resetPinsForTesting();
    mockFetch.mockReset();
  });

  it("pinned PR appears before non-pinned PR in allPrs", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    // Pin PR1 (the older one) — it should jump to the front
    pins.pin(PR1_URL, "pr");

    const { allPrs, refresh } = useLaunchpadPrs();
    await refresh(REPOS);

    expect(allPrs.value[0].url).toBe(PR1_URL);
    expect(allPrs.value[1].url).toBe(PR2_URL);
  });

  it("snoozed PR is absent from allPrs and present in snoozedPrs", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    pins.snooze(PR1_URL, "pr", 1);

    const { allPrs, snoozedPrs, refresh } = useLaunchpadPrs();
    await refresh(REPOS);

    expect(allPrs.value.find((p) => p.url === PR1_URL)).toBeUndefined();
    expect(allPrs.value.find((p) => p.url === PR2_URL)).toBeDefined();
    expect(snoozedPrs.value.find((p) => p.url === PR1_URL)).toBeDefined();
  });

  it("pinned+snoozed PR is absent from allPrs (snooze takes priority)", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    pins.pin(PR1_URL, "pr");
    pins.snooze(PR1_URL, "pr", 1);

    const { allPrs, refresh } = useLaunchpadPrs();
    await refresh(REPOS);

    expect(allPrs.value.find((p) => p.url === PR1_URL)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the 3 new tests — expect them to fail**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadPrs 2>&1 | tail -30
```

Expected: existing 5 tests pass, 3 new tests fail ("`snoozedPrs` is not a function" or similar — `snoozedPrs` doesn't exist yet).

- [ ] **Step 3: Modify `useLaunchpadPrs.ts`**

Replace the entire content of `apps/desktop/src/composables/useLaunchpadPrs.ts` with:

```typescript
import { ref, computed } from "vue";
import { workspacePrsAll } from "../utils/backend";
import type { WorkspaceRepoPrs, WorkspaceRepo, PullRequest } from "../utils/backend";
import { useLaunchpadPins } from "./useLaunchpadPins";

export type { WorkspaceRepoPrs };

/** A PR enriched with its repo context (for flat list rendering). */
export interface PrWithRepo extends PullRequest {
  repoName: string;
  repoPath: string;
}

/**
 * Composable for the Launchpad PRs panel.
 * Aggregates open PRs from all repos in a workspace.
 * Each call returns a fresh reactive scope — no shared singleton.
 */
export function useLaunchpadPrs() {
  const repos = ref<WorkspaceRepoPrs[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const { isPinned, isSnoozed } = useLaunchpadPins();

  /** Flat list of all non-snoozed PRs: pinned items first, then by createdAt descending. */
  const allPrs = computed<PrWithRepo[]>(() =>
    repos.value
      .flatMap((r) => r.prs.map((pr) => ({ ...pr, repoName: r.repoName, repoPath: r.repoPath })))
      .filter((pr) => !isSnoozed(pr.url))
      .sort((a, b) => {
        const aPinned = isPinned(a.url) ? 0 : 1;
        const bPinned = isPinned(b.url) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return b.createdAt.localeCompare(a.createdAt);
      })
  );

  /** Flat list of currently-snoozed PRs (hidden from allPrs). */
  const snoozedPrs = computed<PrWithRepo[]>(() =>
    repos.value
      .flatMap((r) => r.prs.map((pr) => ({ ...pr, repoName: r.repoName, repoPath: r.repoPath })))
      .filter((pr) => isSnoozed(pr.url))
  );

  async function refresh(workspaceRepos: WorkspaceRepo[]): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      repos.value = await workspacePrsAll(workspaceRepos);
    } catch (e) {
      error.value = (e as Error).message ?? String(e);
    } finally {
      loading.value = false;
    }
  }

  return { repos, allPrs, snoozedPrs, loading, error, refresh };
}
```

- [ ] **Step 4: Run all tests in the file — expect 8 passing**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadPrs 2>&1 | tail -20
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git add apps/desktop/src/composables/useLaunchpadPrs.ts \
        apps/desktop/src/composables/__tests__/useLaunchpadPrs.test.ts
git commit -m "$(cat <<'EOF'
feat(launchpad): wire pin/snooze into useLaunchpadPrs

allPrs: filters snoozed, sorts pinned-first then createdAt desc.
snoozedPrs: new computed for the snoozed bandeau.
3 new integration tests.
EOF
)"
```

---

## Task 3: Modify `useLaunchpadIssues` — pin-sort + snooze-filter

**Files:**
- Modify: `apps/desktop/src/composables/__tests__/useLaunchpadIssues.test.ts`
- Modify: `apps/desktop/src/composables/useLaunchpadIssues.ts`

- [ ] **Step 1: Add 3 failing tests to the existing test file**

Add these imports at the top of `apps/desktop/src/composables/__tests__/useLaunchpadIssues.test.ts`:

```typescript
import { useLaunchpadPins, _resetPinsForTesting } from "../useLaunchpadPins";
```

Add this describe block at the end of the file:

```typescript
describe("useLaunchpadIssues — pin/snooze integration", () => {
  const ISSUE1_URL = "https://github.com/org/alpha/issues/10";
  const ISSUE2_URL = "https://github.com/org/alpha/issues/20";

  const ISSUE1: Issue = {
    ...MOCK_ISSUE,
    number: 10,
    url: ISSUE1_URL,
    updatedAt: "2026-03-01T10:00:00Z", // older
    createdAt: "2026-02-01T10:00:00Z",
  };
  const ISSUE2: Issue = {
    ...MOCK_ISSUE,
    number: 20,
    url: ISSUE2_URL,
    updatedAt: "2026-05-01T10:00:00Z", // newer
    createdAt: "2026-04-01T10:00:00Z",
  };
  const DATA_TWO: WorkspaceRepoIssues[] = [
    { repoPath: "/repo/a", repoName: "alpha", issues: [ISSUE1, ISSUE2], filter: "assigned", error: null },
  ];

  beforeEach(() => {
    localStorage.clear();
    _resetPinsForTesting();
    mockFetch.mockReset();
  });

  it("pinned issue appears before non-pinned issue in allIssues", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    // Pin ISSUE1 (the older one) — it should jump to the front
    pins.pin(ISSUE1_URL, "issue");

    const { allIssues, refresh } = useLaunchpadIssues();
    await refresh(REPOS);

    expect(allIssues.value[0].url).toBe(ISSUE1_URL);
    expect(allIssues.value[1].url).toBe(ISSUE2_URL);
  });

  it("snoozed issue is absent from allIssues and present in snoozedIssues", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    pins.snooze(ISSUE1_URL, "issue", 1);

    const { allIssues, snoozedIssues, refresh } = useLaunchpadIssues();
    await refresh(REPOS);

    expect(allIssues.value.find((i) => i.url === ISSUE1_URL)).toBeUndefined();
    expect(allIssues.value.find((i) => i.url === ISSUE2_URL)).toBeDefined();
    expect(snoozedIssues.value.find((i) => i.url === ISSUE1_URL)).toBeDefined();
  });

  it("pinned+snoozed issue is absent from allIssues (snooze takes priority)", async () => {
    mockFetch.mockResolvedValue(DATA_TWO);
    const pins = useLaunchpadPins();
    pins.pin(ISSUE1_URL, "issue");
    pins.snooze(ISSUE1_URL, "issue", 1);

    const { allIssues, refresh } = useLaunchpadIssues();
    await refresh(REPOS);

    expect(allIssues.value.find((i) => i.url === ISSUE1_URL)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the 3 new tests — expect them to fail**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadIssues 2>&1 | tail -20
```

Expected: existing 6 tests pass, 3 new tests fail.

- [ ] **Step 3: Modify `useLaunchpadIssues.ts`**

Replace the entire content of `apps/desktop/src/composables/useLaunchpadIssues.ts` with:

```typescript
import { ref, computed } from "vue";
import { workspaceIssuesAll } from "../utils/backend";
import type { WorkspaceRepoIssues, WorkspaceRepo, Issue } from "../utils/backend";
import { useLaunchpadPins } from "./useLaunchpadPins";

export type { WorkspaceRepoIssues };

/** Valid filter values for the Issues tab. */
export type IssueFilter = "" | "assigned" | "mentioned" | "created";

/** An issue enriched with its repo context (for flat list rendering). */
export interface IssueWithRepo extends Issue {
  repoName: string;
  repoPath: string;
}

/**
 * Composable for the Launchpad Issues panel.
 * Aggregates open GitHub Issues from all repos in a workspace.
 * Each call returns a fresh reactive scope — no shared singleton.
 */
export function useLaunchpadIssues() {
  const repos = ref<WorkspaceRepoIssues[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Currently active filter. Defaults to "assigned". Change before calling refresh(). */
  const activeFilter = ref<IssueFilter>("assigned");

  const { isPinned, isSnoozed } = useLaunchpadPins();

  /** Flat list of all non-snoozed issues: pinned first, then by updatedAt descending. */
  const allIssues = computed<IssueWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.issues.map((issue) => ({ ...issue, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .filter((issue) => !isSnoozed(issue.url))
      .sort((a, b) => {
        const aPinned = isPinned(a.url) ? 0 : 1;
        const bPinned = isPinned(b.url) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
  );

  /** Flat list of currently-snoozed issues (hidden from allIssues). */
  const snoozedIssues = computed<IssueWithRepo[]>(() =>
    repos.value
      .flatMap((r) =>
        r.issues.map((issue) => ({ ...issue, repoName: r.repoName, repoPath: r.repoPath }))
      )
      .filter((issue) => isSnoozed(issue.url))
  );

  async function refresh(workspaceRepos: WorkspaceRepo[]): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      repos.value = await workspaceIssuesAll(workspaceRepos, activeFilter.value);
    } catch (e) {
      error.value = (e as Error).message ?? String(e);
    } finally {
      loading.value = false;
    }
  }

  return { repos, allIssues, snoozedIssues, loading, error, activeFilter, refresh };
}
```

- [ ] **Step 4: Run all tests in the file — expect 9 passing**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test -- --reporter=verbose --testPathPattern=useLaunchpadIssues 2>&1 | tail -20
```

Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git add apps/desktop/src/composables/useLaunchpadIssues.ts \
        apps/desktop/src/composables/__tests__/useLaunchpadIssues.test.ts
git commit -m "$(cat <<'EOF'
feat(launchpad): wire pin/snooze into useLaunchpadIssues

allIssues: filters snoozed, sorts pinned-first then updatedAt desc.
snoozedIssues: new computed for the snoozed bandeau.
3 new integration tests.
EOF
)"
```

---

## Task 4: i18n — 11 new keys in all 5 locales

**Files:**
- Modify: `apps/desktop/src/locales/en.ts`
- Modify: `apps/desktop/src/locales/fr.ts`
- Modify: `apps/desktop/src/locales/es.ts`
- Modify: `apps/desktop/src/locales/pt-BR.ts`
- Modify: `apps/desktop/src/locales/zh-CN.ts`

- [ ] **Step 1: Add 11 keys to `en.ts`**

In `apps/desktop/src/locales/en.ts`, find the `launchpad` block. After `issueMilestone: "Milestone: {0}",` and before the closing `},`, add:

```typescript
    pin: "Pin",
    unpin: "Unpin",
    snooze: "Snooze",
    unsnooze: "Cancel snooze",
    snooze1d: "1 day",
    snooze3d: "3 days",
    snooze1w: "1 week",
    snooze2w: "2 weeks",
    snoozedCount: "{0} snoozed item(s)",
    snoozedUntil: "Snoozed until {0}",
    showSnoozed: "Show snoozed",
```

The `launchpad` section in `en.ts` (lines 1055–1083) should become:

```typescript
  launchpad: {
    title: "Launchpad",
    wipTab: "WIP",
    noRepos: "No repositories in this workspace.",
    refresh: "Refresh",
    loading: "Loading…",
    errorFetch: "Failed to load WIP data: {0}",
    staged: "{0} staged",
    unstaged: "{0} unstaged",
    untracked: "{0} untracked",
    noUpstream: "no upstream",
    clean: "Clean",
    lastCommit: "Last commit {0}",
    prsTab: "PRs",
    noPrs: "No open pull requests in this workspace.",
    prDraft: "Draft",
    prApproved: "Approved",
    prChangesRequested: "Changes requested",
    prReviewRequired: "Review required",
    prCiSuccess: "CI passed",
    prCiFailure: "CI failed",
    prCiPending: "CI pending",
    issuesTab: "Issues",
    noIssues: "No issues found with this filter.",
    issueFilterAssigned: "Assigned to me",
    issueFilterMentioned: "Mentions me",
    issueFilterCreated: "Created by me",
    issueMilestone: "Milestone: {0}",
    pin: "Pin",
    unpin: "Unpin",
    snooze: "Snooze",
    unsnooze: "Cancel snooze",
    snooze1d: "1 day",
    snooze3d: "3 days",
    snooze1w: "1 week",
    snooze2w: "2 weeks",
    snoozedCount: "{0} snoozed item(s)",
    snoozedUntil: "Snoozed until {0}",
    showSnoozed: "Show snoozed",
  },
```

- [ ] **Step 2: Add 11 keys to `fr.ts`**

In `apps/desktop/src/locales/fr.ts`, find the `launchpad` block. After `issueMilestone: "Jalon : {0}",` and before the closing `},`, add:

```typescript
    pin: "Épingler",
    unpin: "Désépingler",
    snooze: "Snoozer",
    unsnooze: "Annuler le snooze",
    snooze1d: "1 jour",
    snooze3d: "3 jours",
    snooze1w: "1 semaine",
    snooze2w: "2 semaines",
    snoozedCount: "{0} élément(s) snooze",
    snoozedUntil: "Snooze jusqu'au {0}",
    showSnoozed: "Afficher les snoozés",
```

- [ ] **Step 3: Add 11 keys to `es.ts`**

In `apps/desktop/src/locales/es.ts`, find the `launchpad` block. After `issueMilestone: "Hito: {0}",` and before the closing `},`, add:

```typescript
    pin: "Fijar",
    unpin: "Desfijar",
    snooze: "Posponer",
    unsnooze: "Cancelar posposición",
    snooze1d: "1 día",
    snooze3d: "3 días",
    snooze1w: "1 semana",
    snooze2w: "2 semanas",
    snoozedCount: "{0} elemento(s) pospuesto(s)",
    snoozedUntil: "Pospuesto hasta {0}",
    showSnoozed: "Mostrar pospuestos",
```

- [ ] **Step 4: Add 11 keys to `pt-BR.ts`**

In `apps/desktop/src/locales/pt-BR.ts`, find the `launchpad` block. After `issueMilestone: "Marco: {0}",` and before the closing `},`, add:

```typescript
    pin: "Fixar",
    unpin: "Desafixar",
    snooze: "Adiar",
    unsnooze: "Cancelar adiamento",
    snooze1d: "1 dia",
    snooze3d: "3 dias",
    snooze1w: "1 semana",
    snooze2w: "2 semanas",
    snoozedCount: "{0} item(ns) adiado(s)",
    snoozedUntil: "Adiado até {0}",
    showSnoozed: "Mostrar adiados",
```

- [ ] **Step 5: Add 11 keys to `zh-CN.ts`**

In `apps/desktop/src/locales/zh-CN.ts`, find the `launchpad` block. After `issueMilestone: "里程碑：{0}",` and before the closing `},`, add:

```typescript
    pin: "置顶",
    unpin: "取消置顶",
    snooze: "稍后提醒",
    unsnooze: "取消提醒",
    snooze1d: "1 天",
    snooze3d: "3 天",
    snooze1w: "1 周",
    snooze2w: "2 周",
    snoozedCount: "{0} 个已推迟项目",
    snoozedUntil: "推迟至 {0}",
    showSnoozed: "显示已推迟",
```

- [ ] **Step 6: Run full test suite — expect no TypeScript errors**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test 2>&1 | tail -20
```

Expected: all tests pass (TypeScript enforces locale shape via `Locale` type, so missing keys in any locale file would be a compile error).

- [ ] **Step 7: Commit**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git add apps/desktop/src/locales/en.ts \
        apps/desktop/src/locales/fr.ts \
        apps/desktop/src/locales/es.ts \
        apps/desktop/src/locales/pt-BR.ts \
        apps/desktop/src/locales/zh-CN.ts
git commit -m "$(cat <<'EOF'
feat(i18n): add 11 pin/snooze keys to all 5 locales

Keys: pin, unpin, snooze, unsnooze, snooze1d, snooze3d, snooze1w, snooze2w,
snoozedCount, snoozedUntil, showSnoozed — in launchpad block.
EOF
)"
```

---

## Task 5: `LaunchpadView.vue` — ⋮ menu, pin badge, snoozed bandeau

**Files:**
- Modify: `apps/desktop/src/components/LaunchpadView.vue`

This task has no Vitest unit tests (UI logic inside a single component). Verify visually with `pnpm dev:web` after implementation.

- [ ] **Step 1: Replace the entire `LaunchpadView.vue` with the new version**

Create the complete replacement file at `apps/desktop/src/components/LaunchpadView.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useLaunchpadWip } from "../composables/useLaunchpadWip";
import { useLaunchpadPrs } from "../composables/useLaunchpadPrs";
import { useLaunchpadIssues } from "../composables/useLaunchpadIssues";
import { useLaunchpadPins } from "../composables/useLaunchpadPins";
import { useI18n } from "../composables/useI18n";
import type { WorkspaceRepo } from "../utils/backend";
import type { IssueFilter } from "../composables/useLaunchpadIssues";

const props = defineProps<{
  repos: WorkspaceRepo[];
}>();

const { t } = useI18n();

const { wip, loading: wipLoading, error: wipError, refresh: refreshWip } = useLaunchpadWip();
const { allPrs, snoozedPrs, repos: prRepos, loading: prsLoading, error: prsError, refresh: refreshPrs } = useLaunchpadPrs();
const { allIssues, snoozedIssues, repos: issueRepos, loading: issuesLoading, error: issuesError, activeFilter: issueFilter, refresh: refreshIssues } = useLaunchpadIssues();
const { pin, unpin, snooze, unsnooze, isPinned, isSnoozed, snoozedUntil } = useLaunchpadPins();

type Tab = "wip" | "prs" | "issues";
const activeTab = ref<Tab>("wip");

// ── ⋮ menu state ──────────────────────────────────────────────────────────────
const openMenuUrl = ref<string | null>(null);
const openSnoozeFor = ref<string | null>(null);

// ── Snoozed bandeau visibility ─────────────────────────────────────────────────
const showSnoozedPrs = ref(false);
const showSnoozedIssues = ref(false);

function setTab(tab: Tab) {
  activeTab.value = tab;
}

function handleRefresh() {
  if (activeTab.value === "wip") refreshWip(props.repos);
  else if (activeTab.value === "prs") refreshPrs(props.repos);
  else refreshIssues(props.repos);
}

function setIssueFilter(filter: IssueFilter) {
  issueFilter.value = filter;
  refreshIssues(props.repos);
}

const isLoading = () => wipLoading.value || prsLoading.value || issuesLoading.value;

// ── Menu helpers ──────────────────────────────────────────────────────────────
function toggleMenu(url: string): void {
  if (openMenuUrl.value === url) {
    openMenuUrl.value = null;
    openSnoozeFor.value = null;
  } else {
    openMenuUrl.value = url;
    openSnoozeFor.value = null;
  }
}

function closeMenu(): void {
  openMenuUrl.value = null;
  openSnoozeFor.value = null;
}

function pinAndClose(url: string, type: "pr" | "issue"): void {
  pin(url, type);
  closeMenu();
}

function unpinAndClose(url: string): void {
  unpin(url);
  closeMenu();
}

function snoozeAndClose(url: string, type: "pr" | "issue", days: 1 | 3 | 7 | 14): void {
  snooze(url, type, days);
  closeMenu();
}

function unsnoozeAndClose(url: string): void {
  unsnooze(url);
  closeMenu();
}

function formatSnoozedUntil(url: string): string {
  const d = snoozedUntil(url);
  if (!d) return "";
  return new Date(d).toLocaleDateString();
}

onMounted(() => {
  refreshWip(props.repos);
  refreshPrs(props.repos);
  refreshIssues(props.repos);
});
</script>

<template>
  <div class="launchpad-view" @click="closeMenu()">
    <div class="launchpad-view__header">
      <h2 class="launchpad-view__title">{{ t("launchpad.title") }}</h2>
      <button
        class="launchpad-view__refresh"
        :disabled="isLoading()"
        @click.stop="handleRefresh"
      >
        {{ isLoading() ? t("launchpad.loading") : t("launchpad.refresh") }}
      </button>
    </div>

    <!-- Tab bar -->
    <div class="launchpad-view__tabs">
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'wip' }"
        @click="setTab('wip')"
      >
        {{ t("launchpad.wipTab") }}
      </button>
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'prs' }"
        @click="setTab('prs')"
      >
        {{ t("launchpad.prsTab") }}
        <span v-if="allPrs.length > 0" class="launchpad-view__tab-badge">
          {{ allPrs.length }}
        </span>
      </button>
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'issues' }"
        @click="setTab('issues')"
      >
        {{ t("launchpad.issuesTab") }}
        <span v-if="allIssues.length > 0" class="launchpad-view__tab-badge">
          {{ allIssues.length }}
        </span>
      </button>
    </div>

    <!-- WIP tab -->
    <div v-if="activeTab === 'wip'" class="launchpad-view__panel">
      <div v-if="wipError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", wipError) }}
      </div>
      <p v-else-if="!wipLoading && wip.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noRepos") }}
      </p>
      <ul v-else class="launchpad-view__repo-list">
        <li
          v-for="item in wip"
          :key="item.path"
          class="launchpad-view__repo-item"
        >
          <span class="launchpad-view__repo-name">{{ item.name }}</span>
          <span class="launchpad-view__repo-branch">{{ item.branch }}</span>
          <span v-if="item.hasNoUpstream" class="launchpad-view__no-upstream">
            {{ t("launchpad.noUpstream") }}
          </span>
          <template v-else>
            <span v-if="item.ahead > 0" class="launchpad-view__ahead">↑{{ item.ahead }}</span>
            <span v-if="item.behind > 0" class="launchpad-view__behind">↓{{ item.behind }}</span>
          </template>
          <template v-if="item.stagedCount === 0 && item.unstagedCount === 0 && item.untrackedCount === 0">
            <span class="launchpad-view__clean">{{ t("launchpad.clean") }}</span>
          </template>
          <template v-else>
            <span v-if="item.stagedCount > 0" class="launchpad-view__staged">
              {{ t("launchpad.staged", item.stagedCount) }}
            </span>
            <span v-if="item.unstagedCount > 0" class="launchpad-view__unstaged">
              {{ t("launchpad.unstaged", item.unstagedCount) }}
            </span>
            <span v-if="item.untrackedCount > 0" class="launchpad-view__untracked">
              {{ t("launchpad.untracked", item.untrackedCount) }}
            </span>
          </template>
          <span v-if="item.lastCommitAt" class="launchpad-view__last-commit">
            {{ t("launchpad.lastCommit", item.lastCommitAt) }}
          </span>
          <span v-if="item.error" class="launchpad-view__repo-error">{{ item.error }}</span>
        </li>
      </ul>
    </div>

    <!-- PRs tab -->
    <div v-if="activeTab === 'prs'" class="launchpad-view__panel">
      <div v-if="prsError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", prsError) }}
      </div>
      <p v-else-if="!prsLoading && allPrs.length === 0 && snoozedPrs.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noPrs") }}
      </p>
      <ul v-else class="launchpad-view__pr-list">
        <li
          v-for="pr in allPrs"
          :key="`${pr.repoPath}/${pr.number}`"
          class="launchpad-view__pr-item"
        >
          <!-- Pin badge — always visible on pinned items -->
          <span v-if="isPinned(pr.url)" class="launchpad-view__pin-badge" aria-label="Pinned">📌</span>
          <span class="launchpad-view__pr-repo">{{ pr.repoName }}</span>
          <span class="launchpad-view__pr-title">
            <a :href="pr.url" target="_blank" rel="noopener noreferrer">
              #{{ pr.number }} {{ pr.title }}
            </a>
          </span>
          <span v-if="pr.draft" class="launchpad-view__pr-badge launchpad-view__pr-badge--draft">
            {{ t("launchpad.prDraft") }}
          </span>
          <span
            v-if="pr.reviewDecision === 'APPROVED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--approved"
          >
            {{ t("launchpad.prApproved") }}
          </span>
          <span
            v-else-if="pr.reviewDecision === 'CHANGES_REQUESTED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--changes"
          >
            {{ t("launchpad.prChangesRequested") }}
          </span>
          <span
            v-else-if="pr.reviewDecision === 'REVIEW_REQUIRED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--review"
          >
            {{ t("launchpad.prReviewRequired") }}
          </span>
          <span
            v-if="pr.checksRollup === 'SUCCESS'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-success"
          >
            {{ t("launchpad.prCiSuccess") }}
          </span>
          <span
            v-else-if="pr.checksRollup === 'FAILURE'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-failure"
          >
            {{ t("launchpad.prCiFailure") }}
          </span>
          <span
            v-else-if="pr.checksRollup === 'PENDING'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-pending"
          >
            {{ t("launchpad.prCiPending") }}
          </span>
          <span class="launchpad-view__pr-labels">
            <span
              v-for="label in pr.labels"
              :key="label"
              class="launchpad-view__pr-label"
            >{{ label }}</span>
          </span>
          <!-- ⋮ action menu -->
          <div class="launchpad-view__item-menu" @click.stop>
            <button
              class="launchpad-view__menu-btn"
              :class="{ 'launchpad-view__menu-btn--open': openMenuUrl === pr.url }"
              :aria-label="`Actions for PR #${pr.number}`"
              @click="toggleMenu(pr.url)"
            >⋮</button>
            <div v-if="openMenuUrl === pr.url" class="launchpad-view__menu-dropdown">
              <button v-if="!isPinned(pr.url)" class="launchpad-view__menu-item" @click="pinAndClose(pr.url, 'pr')">
                📌 {{ t("launchpad.pin") }}
              </button>
              <button v-else class="launchpad-view__menu-item" @click="unpinAndClose(pr.url)">
                📌 {{ t("launchpad.unpin") }}
              </button>
              <template v-if="!isSnoozed(pr.url)">
                <button class="launchpad-view__menu-item" @click="openSnoozeFor = pr.url">
                  💤 {{ t("launchpad.snooze") }}
                </button>
                <div v-if="openSnoozeFor === pr.url" class="launchpad-view__snooze-options">
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 1)">{{ t("launchpad.snooze1d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 3)">{{ t("launchpad.snooze3d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 7)">{{ t("launchpad.snooze1w") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 14)">{{ t("launchpad.snooze2w") }}</button>
                </div>
              </template>
              <button v-else class="launchpad-view__menu-item" @click="unsnoozeAndClose(pr.url)">
                💤 {{ t("launchpad.unsnooze") }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <!-- Per-repo errors -->
      <template v-for="repo in prRepos" :key="repo.repoPath">
        <p v-if="repo.error" class="launchpad-view__repo-error">
          {{ repo.repoName }}: {{ repo.error }}
        </p>
      </template>
      <!-- Snoozed PRs bandeau -->
      <div
        v-if="snoozedPrs.length > 0"
        class="launchpad-view__snoozed-bandeau"
        role="button"
        tabindex="0"
        @click="showSnoozedPrs = !showSnoozedPrs"
        @keydown.enter="showSnoozedPrs = !showSnoozedPrs"
      >
        💤 {{ t("launchpad.snoozedCount", snoozedPrs.length) }}
      </div>
      <ul v-if="showSnoozedPrs && snoozedPrs.length > 0" class="launchpad-view__snoozed-list">
        <li v-for="pr in snoozedPrs" :key="pr.url" class="launchpad-view__snoozed-item">
          <span class="launchpad-view__pr-repo">{{ pr.repoName }}</span>
          <span class="launchpad-view__snoozed-title">{{ pr.title }}</span>
          <span class="launchpad-view__snoozed-until">{{ t("launchpad.snoozedUntil", formatSnoozedUntil(pr.url)) }}</span>
          <button class="launchpad-view__snooze-cancel" @click="unsnooze(pr.url)">
            {{ t("launchpad.unsnooze") }}
          </button>
        </li>
      </ul>
    </div>

    <!-- Issues tab -->
    <div v-if="activeTab === 'issues'" class="launchpad-view__panel">
      <!-- Filter buttons -->
      <div class="launchpad-view__issue-filters">
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'assigned' }"
          @click="setIssueFilter('assigned')"
        >
          {{ t("launchpad.issueFilterAssigned") }}
        </button>
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'mentioned' }"
          @click="setIssueFilter('mentioned')"
        >
          {{ t("launchpad.issueFilterMentioned") }}
        </button>
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'created' }"
          @click="setIssueFilter('created')"
        >
          {{ t("launchpad.issueFilterCreated") }}
        </button>
      </div>

      <div v-if="issuesError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", issuesError) }}
      </div>
      <p v-else-if="!issuesLoading && allIssues.length === 0 && snoozedIssues.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noIssues") }}
      </p>
      <ul v-else class="launchpad-view__issue-list">
        <li
          v-for="issue in allIssues"
          :key="`${issue.repoPath}/${issue.number}`"
          class="launchpad-view__issue-item"
        >
          <!-- Pin badge — always visible on pinned items -->
          <span v-if="isPinned(issue.url)" class="launchpad-view__pin-badge" aria-label="Pinned">📌</span>
          <span class="launchpad-view__pr-repo">{{ issue.repoName }}</span>
          <span class="launchpad-view__issue-title">
            <a :href="issue.url" target="_blank" rel="noopener noreferrer">
              #{{ issue.number }} {{ issue.title }}
            </a>
          </span>
          <span v-if="issue.milestone" class="launchpad-view__issue-milestone">
            {{ t("launchpad.issueMilestone", issue.milestone) }}
          </span>
          <span class="launchpad-view__pr-labels">
            <span
              v-for="label in issue.labels"
              :key="label"
              class="launchpad-view__pr-label"
            >{{ label }}</span>
          </span>
          <!-- ⋮ action menu -->
          <div class="launchpad-view__item-menu" @click.stop>
            <button
              class="launchpad-view__menu-btn"
              :class="{ 'launchpad-view__menu-btn--open': openMenuUrl === issue.url }"
              :aria-label="`Actions for issue #${issue.number}`"
              @click="toggleMenu(issue.url)"
            >⋮</button>
            <div v-if="openMenuUrl === issue.url" class="launchpad-view__menu-dropdown">
              <button v-if="!isPinned(issue.url)" class="launchpad-view__menu-item" @click="pinAndClose(issue.url, 'issue')">
                📌 {{ t("launchpad.pin") }}
              </button>
              <button v-else class="launchpad-view__menu-item" @click="unpinAndClose(issue.url)">
                📌 {{ t("launchpad.unpin") }}
              </button>
              <template v-if="!isSnoozed(issue.url)">
                <button class="launchpad-view__menu-item" @click="openSnoozeFor = issue.url">
                  💤 {{ t("launchpad.snooze") }}
                </button>
                <div v-if="openSnoozeFor === issue.url" class="launchpad-view__snooze-options">
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 1)">{{ t("launchpad.snooze1d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 3)">{{ t("launchpad.snooze3d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 7)">{{ t("launchpad.snooze1w") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 14)">{{ t("launchpad.snooze2w") }}</button>
                </div>
              </template>
              <button v-else class="launchpad-view__menu-item" @click="unsnoozeAndClose(issue.url)">
                💤 {{ t("launchpad.unsnooze") }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <!-- Per-repo errors -->
      <template v-for="repo in issueRepos" :key="repo.repoPath">
        <p v-if="repo.error" class="launchpad-view__repo-error">
          {{ repo.repoName }}: {{ repo.error }}
        </p>
      </template>
      <!-- Snoozed Issues bandeau -->
      <div
        v-if="snoozedIssues.length > 0"
        class="launchpad-view__snoozed-bandeau"
        role="button"
        tabindex="0"
        @click="showSnoozedIssues = !showSnoozedIssues"
        @keydown.enter="showSnoozedIssues = !showSnoozedIssues"
      >
        💤 {{ t("launchpad.snoozedCount", snoozedIssues.length) }}
      </div>
      <ul v-if="showSnoozedIssues && snoozedIssues.length > 0" class="launchpad-view__snoozed-list">
        <li v-for="issue in snoozedIssues" :key="issue.url" class="launchpad-view__snoozed-item">
          <span class="launchpad-view__pr-repo">{{ issue.repoName }}</span>
          <span class="launchpad-view__snoozed-title">{{ issue.title }}</span>
          <span class="launchpad-view__snoozed-until">{{ t("launchpad.snoozedUntil", formatSnoozedUntil(issue.url)) }}</span>
          <button class="launchpad-view__snooze-cancel" @click="unsnooze(issue.url)">
            {{ t("launchpad.unsnooze") }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.launchpad-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.launchpad-view__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.launchpad-view__title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.launchpad-view__refresh {
  padding: 4px 10px;
  font-size: 0.85rem;
  cursor: pointer;
}

.launchpad-view__refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.launchpad-view__error {
  color: var(--color-danger, #e53e3e);
  font-size: 0.875rem;
}

.launchpad-view__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}

.launchpad-view__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.875rem;
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text, inherit);
}

.launchpad-view__tab--active {
  border-bottom-color: var(--color-accent, #3182ce);
  font-weight: 600;
}

.launchpad-view__tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--color-accent, #3182ce);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}

.launchpad-view__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__empty {
  color: var(--color-text-muted, #718096);
  font-size: 0.875rem;
  margin: 12px 0;
}

/* WIP list */
.launchpad-view__repo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launchpad-view__repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
}

.launchpad-view__repo-name { font-weight: 600; min-width: 100px; }
.launchpad-view__repo-branch { color: var(--color-text-muted, #718096); font-family: monospace; font-size: 0.8rem; }
.launchpad-view__ahead { color: var(--color-success, #38a169); }
.launchpad-view__behind { color: var(--color-warning, #d69e2e); }
.launchpad-view__staged { color: var(--color-accent, #3182ce); }
.launchpad-view__unstaged { color: var(--color-warning, #d69e2e); }
.launchpad-view__untracked { color: var(--color-text-muted, #718096); }
.launchpad-view__clean { color: var(--color-success, #38a169); }
.launchpad-view__no-upstream { color: var(--color-text-muted, #718096); font-style: italic; }
.launchpad-view__last-commit { color: var(--color-text-muted, #718096); font-size: 0.8rem; margin-left: auto; }
.launchpad-view__repo-error { color: var(--color-danger, #e53e3e); font-size: 0.8rem; }

/* PR list */
.launchpad-view__pr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__pr-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
  position: relative;
}

.launchpad-view__pr-repo {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  background: var(--color-surface, #edf2f7);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.launchpad-view__pr-title {
  flex: 1;
  min-width: 200px;
  font-weight: 500;
}

.launchpad-view__pr-title a {
  color: inherit;
  text-decoration: none;
}

.launchpad-view__pr-title a:hover {
  text-decoration: underline;
}

.launchpad-view__pr-badge {
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.launchpad-view__pr-badge--draft { background: var(--color-surface, #edf2f7); color: var(--color-text-muted, #718096); }
.launchpad-view__pr-badge--approved { background: #c6f6d5; color: #276749; }
.launchpad-view__pr-badge--changes { background: #fed7d7; color: #9b2c2c; }
.launchpad-view__pr-badge--review { background: #fef3c7; color: #92400e; }
.launchpad-view__pr-badge--ci-success { background: #c6f6d5; color: #276749; }
.launchpad-view__pr-badge--ci-failure { background: #fed7d7; color: #9b2c2c; }
.launchpad-view__pr-badge--ci-pending { background: #fef3c7; color: #92400e; }

.launchpad-view__pr-labels {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.launchpad-view__pr-label {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  background: var(--color-surface, #edf2f7);
  color: var(--color-text-muted, #718096);
}

/* Pin badge */
.launchpad-view__pin-badge {
  font-size: 0.75rem;
  flex-shrink: 0;
}

/* ⋮ menu */
.launchpad-view__item-menu {
  margin-left: auto;
  flex-shrink: 0;
  position: relative;
}

.launchpad-view__menu-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text-muted, #718096);
  line-height: 1;
  transition: opacity 0.1s, background 0.1s;
}

.launchpad-view__pr-item:hover .launchpad-view__menu-btn,
.launchpad-view__issue-item:hover .launchpad-view__menu-btn,
.launchpad-view__menu-btn--open,
.launchpad-view__menu-btn:focus {
  opacity: 1;
}

.launchpad-view__menu-btn:hover {
  background: var(--color-surface, #edf2f7);
}

.launchpad-view__menu-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 100;
  background: var(--color-surface-raised, #f7fafc);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  min-width: 160px;
  padding: 4px 0;
}

.launchpad-view__menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  text-align: left;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--color-text, inherit);
  white-space: nowrap;
}

.launchpad-view__menu-item:hover {
  background: var(--color-surface, #edf2f7);
}

.launchpad-view__menu-item--sub {
  padding-left: 24px;
  font-size: 0.8rem;
  color: var(--color-text-muted, #718096);
}

.launchpad-view__snooze-options {
  border-top: 1px solid var(--color-border, #e2e8f0);
  margin-top: 2px;
  padding-top: 2px;
}

/* Snoozed bandeau */
.launchpad-view__snoozed-bandeau {
  margin-top: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--color-surface, #edf2f7);
  color: var(--color-text-muted, #718096);
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
}

.launchpad-view__snoozed-bandeau:hover {
  background: var(--color-border, #e2e8f0);
}

.launchpad-view__snoozed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.launchpad-view__snoozed-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--color-surface, #edf2f7);
  font-size: 0.8rem;
  opacity: 0.75;
}

.launchpad-view__snoozed-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted, #718096);
}

.launchpad-view__snoozed-until {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  white-space: nowrap;
}

.launchpad-view__snooze-cancel {
  padding: 2px 8px;
  font-size: 0.75rem;
  border-radius: 4px;
  border: 1px solid var(--color-border, #e2e8f0);
  background: none;
  cursor: pointer;
  color: var(--color-text, inherit);
  flex-shrink: 0;
}

.launchpad-view__snooze-cancel:hover {
  background: var(--color-surface-raised, #f7fafc);
}

/* Issues list */
.launchpad-view__issue-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.launchpad-view__filter-btn {
  padding: 3px 10px;
  font-size: 0.8rem;
  border-radius: 12px;
  border: 1px solid var(--color-border, #e2e8f0);
  background: none;
  cursor: pointer;
  color: var(--color-text, inherit);
}

.launchpad-view__filter-btn--active {
  background: var(--color-accent, #3182ce);
  color: #fff;
  border-color: var(--color-accent, #3182ce);
}

.launchpad-view__issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__issue-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
  position: relative;
}

.launchpad-view__issue-title {
  flex: 1;
  min-width: 200px;
  font-weight: 500;
}

.launchpad-view__issue-title a {
  color: inherit;
  text-decoration: none;
}

.launchpad-view__issue-title a:hover {
  text-decoration: underline;
}

.launchpad-view__issue-milestone {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  background: var(--color-surface, #edf2f7);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test 2>&1 | tail -20
```

Expected: all tests pass (LaunchpadView.vue has no test file — its logic is covered by the composable tests).

- [ ] **Step 3: Commit**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git add apps/desktop/src/components/LaunchpadView.vue
git commit -m "$(cat <<'EOF'
feat(launchpad): add pin badge, ⋮ menu, and snoozed bandeau to LaunchpadView

- ⋮ button per PR/Issue row (hover-activated) with pin/unpin and snooze submenu
- 📌 badge inline on pinned items (always visible)
- Snoozed bandeau at bottom of PRs and Issues panels with expand/collapse
EOF
)"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run the full test suite one last time**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm test 2>&1 | tail -30
```

Expected: all tests pass (7 + 8 + 9 = 24 tests in the three launchpad test files, plus the rest of the suite).

- [ ] **Step 2: TypeScript type-check**

```bash
cd /Users/laurent/Documents/GitHub/GitWand/apps/desktop
pnpm exec vue-tsc --noEmit 2>&1 | tail -20
```

Expected: no type errors.

- [ ] **Step 3: Confirm git log shows all 5 commits**

```bash
cd /Users/laurent/Documents/GitHub/GitWand
git log --oneline -5
```

Expected output (most recent first):
```
<sha> feat(launchpad): add pin badge, ⋮ menu, and snoozed bandeau to LaunchpadView
<sha> feat(i18n): add 11 pin/snooze keys to all 5 locales
<sha> feat(launchpad): wire pin/snooze into useLaunchpadIssues
<sha> feat(launchpad): wire pin/snooze into useLaunchpadPrs
<sha> feat(launchpad): add useLaunchpadPins module-singleton composable
```

---

## Spec Coverage Checklist

- [x] `useLaunchpadPins` module singleton with localStorage key `"gitwand-launchpad-pins"`
- [x] `PinnedItem` / `SnoozedItem` types
- [x] `pin`, `unpin`, `snooze`, `unsnooze` mutations
- [x] `isPinned`, `isSnoozed` (auto-expiry at call time), `snoozedUntil` queries
- [x] `pins` / `activeSnoozed` readonly state
- [x] Lazy pruning of expired snoozes on next write
- [x] Snooze presets: 1, 3, 7, 14 days
- [x] `allPrs`: snoozed filtered out + pinned-first sort
- [x] `snoozedPrs`: snoozed items
- [x] `allIssues` / `snoozedIssues`: same pattern
- [x] 7 + 3 + 3 = 13 new Vitest tests
- [x] ⋮ menu per row with pin/unpin and snooze submenu
- [x] 📌 pin badge always visible on pinned items
- [x] Snoozed bandeau (click to expand) with unsnooze button per item
- [x] 11 keys × 5 locales = 55 i18n entries
- [x] No new `.vue` component (all changes in `LaunchpadView.vue`)
