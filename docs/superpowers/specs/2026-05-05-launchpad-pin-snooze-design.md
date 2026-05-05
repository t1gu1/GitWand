# Launchpad Pin / Snooze — Design Spec

**Date:** 2026-05-05  
**Feature:** v2.9.0 Launchpad — PR5  
**Status:** Approved

---

## Goal

Add pin and snooze capabilities to the Launchpad's PRs and Issues tabs so users can surface important items at the top of a list (pin) or temporarily hide items they don't want to deal with right now (snooze).

---

## Scope

Both operations (pin **and** snooze) apply to both item types (PRs **and** Issues). The `url` field uniquely identifies any item across both types and serves as the stable key.

---

## Architecture

**Approach:** `useLaunchpadPins` module singleton, applied inside the existing composables.

- `useLaunchpadPins` — new module-singleton composable, owns persistence and exposes read/write API
- `useLaunchpadPrs` — modified: `allPrs` sorts pin-first + filters snoozed, new `snoozedPrs` computed
- `useLaunchpadIssues` — same modifications mirrored
- `LaunchpadView.vue` — adds ⋮ menu per item, pin badge, snoozed bandeau

---

## Data Model

### Storage

Persisted in `localStorage` under key `"gitwand-launchpad-pins"` — separate from `AppSettings` (this is runtime state, not a user preference setting). Format: JSON object `{ pins: PinnedItem[], snoozes: SnoozedItem[] }`.

### Types

```typescript
interface PinnedItem {
  url: string;        // unique identifier (GitHub URL of the PR or Issue)
  type: "pr" | "issue";
  pinnedAt: string;   // ISO 8601 date string
}

interface SnoozedItem {
  url: string;
  type: "pr" | "issue";
  snoozedUntil: string; // ISO 8601 date string — item reappears after this date
}
```

### Snooze presets

| Label | Days |
|-------|------|
| 1 day | 1 |
| 3 days | 3 |
| 1 week | 7 |
| 2 weeks | 14 |

---

## `useLaunchpadPins` Composable

**Module singleton** — shares state across all call sites (same pattern as `useSettings`). Loaded once, reactive refs exported.

### API

```typescript
// Mutations
pin(url: string, type: "pr" | "issue"): void
unpin(url: string): void
snooze(url: string, type: "pr" | "issue", days: 1 | 3 | 7 | 14): void
unsnooze(url: string): void

// Queries
isPinned(url: string): boolean
isSnoozed(url: string): boolean   // false if snoozedUntil <= now (auto-expiry)
snoozedUntil(url: string): string | null

// State (readonly)
pins: readonly PinnedItem[]
activeSnoozed: readonly SnoozedItem[]  // only non-expired snoozes
```

### Expiry semantics

`isSnoozed(url)` compares `snoozedUntil` against `Date.now()` at call time — no background timer needed. Expired snooze entries are lazily pruned on the next write operation.

### Pin + snooze coexistence

An item can be both pinned and snoozed simultaneously. Snooze takes priority: a pinned+snoozed item is hidden from the active list (the snooze bandeau shows it instead). When the snooze expires it reappears at the top because it is still pinned.

---

## Modified Composables

### `useLaunchpadPrs`

`allPrs` computed:
1. Flat-maps repos → PRs with repo context (unchanged)
2. **Filters out** items where `isSnoozed(pr.url)` is true
3. **Sorts:** pinned items first (`isPinned`), then by `createdAt` descending

New `snoozedPrs` computed:
- Same flat-map as above
- **Keeps only** items where `isSnoozed(pr.url)` is true
- Exposed in the composable's return value

### `useLaunchpadIssues`

Identical pattern — `allIssues` and `snoozedIssues`.

---

## `LaunchpadView.vue` Changes

### ⋮ menu (per item, appears on row hover)

A small `⋮` button appears at the right edge of each PR/Issue row on hover. Clicking it opens a dropdown:

**If item is not pinned:**
- "📌 Épingler" → calls `pin(url, type)`

**If item is pinned:**
- "📌 Désépingler" → calls `unpin(url)`

**If item is not snoozed:**
- "💤 Snoozer" → submenu with 4 options:
  - "1 jour" → `snooze(url, type, 1)`
  - "3 jours" → `snooze(url, type, 3)`
  - "1 semaine" → `snooze(url, type, 7)`
  - "2 semaines" → `snooze(url, type, 14)`

**If item is snoozed:**
- "💤 Annuler le snooze" → `unsnooze(url)`

### Pin badge

A small 📌 icon is shown inline to the left of the title on pinned items — visible at all times (not just on hover). This gives a persistent visual signal that the item is pinned.

### Snoozed bandeau

Shown at the bottom of the PRs panel and Issues panel independently, only when `snoozedPrs.length > 0` (or `snoozedIssues.length > 0`).

- Text: `t("launchpad.snoozedCount", N)` — e.g. "2 éléments snoozés"
- Click toggles a local `showSnoozedPrs` / `showSnoozedIssues` boolean ref
- When expanded: renders the snoozed items below the bandeau, each showing:
  - Repo name + title (same layout as active items)
  - `t("launchpad.snoozedUntil", date)` — expiry date
  - "💤 Annuler le snooze" button → calls `unsnooze(url)`, item returns to active list

### No new component

All changes live inside `LaunchpadView.vue` via conditional sections. No new `.vue` file is needed.

---

## i18n

11 new keys added to all 5 locales (`en`, `fr`, `es`, `pt-BR`, `zh-CN`) inside the `launchpad` block:

| Key | EN | FR |
|-----|----|----|
| `pin` | Pin | Épingler |
| `unpin` | Unpin | Désépingler |
| `snooze` | Snooze | Snoozer |
| `unsnooze` | Cancel snooze | Annuler le snooze |
| `snooze1d` | 1 day | 1 jour |
| `snooze3d` | 3 days | 3 jours |
| `snooze1w` | 1 week | 1 semaine |
| `snooze2w` | 2 weeks | 2 semaines |
| `snoozedCount` | {0} snoozed item(s) | {0} élément(s) snooze |
| `snoozedUntil` | Snoozed until {0} | Snooze jusqu'au {0} |
| `showSnoozed` | Show snoozed | Afficher les snoozés |

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/desktop/src/composables/useLaunchpadPins.ts` | Module singleton — pin/snooze state + localStorage |
| Create | `apps/desktop/src/composables/__tests__/useLaunchpadPins.test.ts` | 7 Vitest tests |
| Modify | `apps/desktop/src/composables/useLaunchpadPrs.ts` | `allPrs` pin-sort + snooze-filter, `snoozedPrs` computed |
| Modify | `apps/desktop/src/composables/__tests__/useLaunchpadPrs.test.ts` | 3 new tests |
| Modify | `apps/desktop/src/composables/useLaunchpadIssues.ts` | `allIssues` pin-sort + snooze-filter, `snoozedIssues` computed |
| Modify | `apps/desktop/src/composables/__tests__/useLaunchpadIssues.test.ts` | 3 new tests |
| Modify | `apps/desktop/src/components/LaunchpadView.vue` | ⋮ menu, pin badge, snoozed bandeau |
| Modify | `apps/desktop/src/locales/en.ts` | 11 new keys |
| Modify | `apps/desktop/src/locales/fr.ts` | 11 new keys |
| Modify | `apps/desktop/src/locales/es.ts` | 11 new keys |
| Modify | `apps/desktop/src/locales/pt-BR.ts` | 11 new keys |
| Modify | `apps/desktop/src/locales/zh-CN.ts` | 11 new keys |

---

## Tests

### `useLaunchpadPins` — 7 tests

1. `pin()` adds item; `isPinned()` returns true
2. `unpin()` removes item; `isPinned()` returns false
3. `snooze(url, type, 7)` → `isSnoozed()` true; `snoozedUntil()` ≈ now + 7 days
4. Snooze with past `snoozedUntil` → `isSnoozed()` returns false (auto-expiry)
5. `unsnooze()` removes snooze; `isSnoozed()` returns false
6. Item can be both pinned and snoozed simultaneously — both states coexist
7. Persistence: state survives a fresh call to `useLaunchpadPins()` (reads from localStorage)

### `useLaunchpadPrs` — 3 new tests

1. Pinned PR appears before non-pinned PR in `allPrs`
2. Snoozed PR absent from `allPrs`, present in `snoozedPrs`
3. PR that is both pinned and snoozed: absent from `allPrs` (snooze takes priority)

### `useLaunchpadIssues` — 3 new tests (mirror of above)

---

## Out of Scope

- **Workspace-aware pins** — pins are global (not per-workspace). Can be scoped later if needed.
- **"All" filter button** in Issues tab — deferred.
- **Pin expiry** — pins don't expire; only snoozes do.
- **Vue Équipe** — separate optional feature, not part of this PR.
