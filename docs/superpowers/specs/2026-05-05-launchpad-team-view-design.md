# Launchpad Vue Équipe — Design Spec

**Date:** 2026-05-05  
**Feature:** v2.9.0 Launchpad — Vue Équipe (optional team-activity view)  
**Status:** Approved

---

## Goal

Add a fourth "Équipe" tab to the Launchpad that shows what teammates are working on across all workspace repos — PRs by colleagues, active branches (PR-backed), and overlap detection between my local changes and their open PRs.

---

## Scope

- Colleagues' open PRs grouped by author, filtered to non-self only
- Active branches = PR-backed only (reuse already-fetched PR data)
- Overlap detection: my WIP files (staged + unstaged) + my branch (commits not yet merged) vs colleague PR files
- WIP takes priority over branch for overlap context
- Identity resolved via `gh api user` — one call, module-level cache
- No cloud, no new database — purely local + GitHub API via `gh` CLI

**Out of scope:** real-time activity, branch-without-PR listing, commit history per author, DM / notification features.

---

## Architecture

**Approach:** New `useLaunchpadTeam` composable, independent fetch pattern (same contract as `useLaunchpadPrs`/`useLaunchpadIssues`).

```
LaunchpadView.vue
  → useLaunchpadTeam.refresh(repos)
      → ghCurrentUser()               [gh api user — 1 call, module-level cache]
      → workspacePrsAll(repos)        [gh pr list — reuses existing wrapper]
      → filter: author.login !== me
      → group by author.login
      → workspaceWipAll(repos)        [Rust command — extended with changedFiles[]]
      → prFiles(repo, prNumber)       [gh pr view --json files — lazy, 1 call/PR]
      → overlap: intersection(myFiles, prFiles)
```

---

## Data Model

### Extended `WorkspaceWipItem`

```typescript
interface WorkspaceWipItem {
  // ...existing fields unchanged...
  changedFiles: string[]  // relative paths of staged + unstaged files
}
```

Rust side: `git status --porcelain` parsed to extract file paths (column 4+), deduplicated. Repos with no changes return `[]`. Fully backward-compatible.

### New types in `useLaunchpadTeam.ts`

```typescript
interface TeamMemberActivity {
  login: string
  prs: PrWithRepo[]            // all open PRs by this member (non-self)
  overlappingPrs: OverlappingPr[]  // subset with confirmed file overlap
}

interface OverlappingPr extends PrWithRepo {
  overlappingFiles: string[]   // files in common with my WIP/branch
  myContext: "wip" | "branch"  // source on my side (WIP takes priority)
}
```

---

## `useLaunchpadTeam` Composable

**Fresh-per-call** (not a module singleton — same pattern as `useLaunchpadPrs`).

### API

```typescript
// State (readonly)
teamActivity: readonly TeamMemberActivity[]
// sorted: members with overlappingPrs.length > 0 first, then alphabetical by login

loading: Ref<boolean>
error: Ref<string | null>

// Method
refresh(repos: WorkspaceRepo[]): Promise<void>
```

### `refresh()` implementation steps

1. Resolve identity: `await ghCurrentUser()` (cached — no repeat call)
2. Fetch PRs: `await workspacePrsAll(repos)` → flatten → split into `myPrs` (`author.login === currentUser`) and `colleaguePrs` (`author.login !== currentUser`)
3. Fetch WIP: `await workspaceWipAll(repos)` → extract `changedFiles` per repo
4. My changed files (`myFiles`) = union of all `changedFiles` across repos
5. If `myFiles` is empty (no WIP) → fetch files for `myPrs` in parallel (`Promise.all`) → `myFiles` = union of those file lists (`myContext: "branch"`)
6. For each colleague PR: lazy-load `await prFiles(repoPath, pr.number)` in parallel (`Promise.all`)
7. Compute `overlappingFiles = intersection(myFiles, colleaguePrFiles)` per PR
8. Build `TeamMemberActivity[]` from `colleaguePrs`, mark `OverlappingPr` entries
9. Sort: overlap members first, then alphabetical by `login`

---

## Backend Changes

### Rust — `workspace_wip_all` extended

`WorkspaceWipItem` gains `changed_files: Vec<String>`. The command runs `git status --porcelain` in addition to existing logic. Lines are parsed: skip `??` (untracked), extract path from column 4+ (handles renames `old -> new` by taking the new path). Deduplicated with `HashSet`. Repos with no changes emit `changed_files: []`.

### New Tauri commands

```rust
#[tauri::command]
async fn gh_current_user(/* ... */) -> Result<String, String>
// runs: gh api user --jq .login

#[tauri::command]
async fn pr_files(repo_path: String, pr_number: u32) -> Result<Vec<String>, String>
// runs: gh pr view <pr_number> --repo <repo> --json files --jq '[.files[].path]'
```

### New `backend.ts` wrappers

```typescript
// Cached identity — module-level
let _currentUserCache: string | null = null
export async function ghCurrentUser(): Promise<string> {
  if (_currentUserCache) return _currentUserCache
  const result = await invoke<string>("gh_current_user")
  _currentUserCache = result
  return result
}

// Lazy file list per PR
export async function prFiles(
  repoPath: string,
  prNumber: number
): Promise<string[]> {
  return invoke<string[]>("pr_files", { repoPath, prNumber })
}
```

### `dev-server.mjs` mock endpoints

```
GET /api/gh-current-user              → "mock-user"
GET /api/pr-files/:repo/:number       → ["src/auth.ts", "src/utils/token.ts"]
```

`workspace_wip_all` mock extended: at least one repo returns `changedFiles: ["src/auth.ts"]`.

---

## `LaunchpadView.vue` Changes

### Tab bar

Extend `type Tab = "wip" | "prs" | "issues" | "team"`. Add fourth `<button>` with label `t("launchpad.teamTab")`.

### Team panel structure

```
[Tab: Équipe]
  ├── Loading / Error state  (same pattern as PRs/Issues)
  ├── Empty state            t("launchpad.noTeamActivity")
  ├── Section: Chevauchements (N)    [only if overlaps exist]
  │     └── MemberCard (overlap=true) per member with overlaps
  │           ├── Avatar initiale + login + PR count
  │           └── PrRow per PR
  │                 ├── title + repo badge
  │                 └── [if overlap] ⚠ overlappingFiles  + t("launchpad.teamOverlapViaWip/Branch")
  └── Section: Équipe
        └── MemberCard (overlap=false) per remaining member
              ├── Avatar initiale + login + PR count
              └── PrRow per PR (title + repo badge, no overlap badge)
```

### MemberCard

- Avatar: colored circle with first letter of `login` — color deterministic from login hash, palette of 6 colors (no external image fetch — avoids rate limits)
- Login label in matching color
- PR count: `t("launchpad.teamPrCount", N)`
- Collapsed by default for members without overlap; expanded for members with overlap

### No new `.vue` file

All markup added inside `LaunchpadView.vue` as conditional sections, consistent with the existing pin/snooze bandeau pattern.

---

## i18n

8 new keys added to all 5 locales (`en`, `fr`, `es`, `pt-BR`, `zh-CN`) inside the `launchpad` block:

| Key | EN | FR |
|-----|----|----|
| `teamTab` | Team | Équipe |
| `noTeamActivity` | No team activity on this workspace | Aucune activité d'équipe sur ce workspace |
| `teamOverlaps` | Overlaps ({0}) | Chevauchements ({0}) |
| `teamMembers` | Team | Équipe |
| `teamOverlapFiles` | {0} shared file(s) | {0} fichier(s) en commun |
| `teamOverlapViaWip` | via WIP | via WIP |
| `teamOverlapViaBranch` | via branch | via branche |
| `teamPrCount` | {0} PR(s) | {0} PR(s) |

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/desktop/src/composables/useLaunchpadTeam.ts` | Team activity composable |
| Create | `apps/desktop/src/composables/__tests__/useLaunchpadTeam.test.ts` | 6 Vitest tests |
| Modify | `apps/desktop/src-tauri/src/lib.rs` | Extend `WorkspaceWipItem` + 2 new commands |
| Modify | `apps/desktop/src/utils/backend.ts` | `ghCurrentUser()`, `prFiles()` wrappers |
| Modify | `apps/desktop/src/components/LaunchpadView.vue` | 4th tab + team panel |
| Modify | `apps/desktop/dev-server.mjs` | Mock endpoints for team data |
| Modify | `apps/desktop/src/locales/en.ts` | 8 new keys |
| Modify | `apps/desktop/src/locales/fr.ts` | 8 new keys |
| Modify | `apps/desktop/src/locales/es.ts` | 8 new keys |
| Modify | `apps/desktop/src/locales/pt-BR.ts` | 8 new keys |
| Modify | `apps/desktop/src/locales/zh-CN.ts` | 8 new keys |

---

## Tests

### `useLaunchpadTeam` — 6 tests

1. PRs whose `author.login === currentUser` are excluded from `teamActivity`
2. Colleague PRs grouped by `author.login`, sorted by `createdAt` desc within each group
3. Overlap detected: `overlappingFiles` = intersection of my WIP files and PR files
4. Overlap via branch (`myContext: "branch"`) when WIP is empty
5. Members with `overlappingPrs.length > 0` sorted before members without
6. `ghCurrentUser()` is called only once across multiple `refresh()` calls (module-level cache)

---

## UI Behaviour Notes

- Avatar color: deterministic from `login` string (hash → pick from palette of 6 colors), no external image fetch
- Member cards with overlap: expanded by default; others: collapsed by default
- `prFiles()` calls are made in parallel (`Promise.all`) for all non-self PRs when the team tab is activated
- If a `prFiles()` call fails (e.g. rate limit), that PR is silently skipped for overlap detection (non-fatal)
- The team tab participates in the global `handleRefresh()` — same refresh button as other tabs
