# GitWand — Roadmap

> Full release details: [CHANGELOG.md](./CHANGELOG.md)

---

## What's Next

### v2.16.0 — PR Activity Notifications

Native OS notifications for PR events — review request, new comment, CI flip, mention — without leaving GitWand. The infrastructure is nearly ready (`useRepoPoller`, `useLaunchpadPrs`, `useConnectivity`); only the diff-snapshot layer and OS emission are missing.

**Launchpad diff-snapshot**

- Between two poller ticks, compare the previous snapshot with the new one: new comments, CI status changes (pass/fail flip), incoming review requests, PR merge/close
- `useLaunchpadNotifications.ts`: module-level singleton, compares by `updatedAt` / `commentCount` / `ciStatus` — zero additional network requests

**Native notifications via `tauri-plugin-notification`**

- OS notification (macOS Notification Center, Linux libnotify, Windows toast) with title, body, and action (open the Launchpad on the relevant PR)
- Configurable granularity in Settings > Notifications: All activity · Reviews & comments · CI failures only · None
- "By people" mode: filter events identified as bots (GitHub Actions, Dependabot, Renovate)
- Gating: notifications only when the GitWand window is in the background (`visibilitychange`)

**Implementation**

- `tauri-plugin-notification` already in the Tauri 2 ecosystem
- macOS TCC permissions declared in `tauri.conf.json` (`allow-notification` capability)
- Notifications are pushed to `useLogs` — traceable in the Logs tab

---

### v2.17.0 — Inline CI Check Annotations

Overlay check-run annotations in the diff — the exact line that failed the linter or typecheck, right where you need it in the review.

**Backend**

- GitHub: `GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations`
- GitLab: pipeline job trace + `artifacts:reports:codequality` (common JSON format)
- Bitbucket: `/commit/{commit}/statuses` enriched with Pipelines annotations
- New type `CIAnnotation { path, line, level: "failure"|"warning"|"notice", title, message }`

**UI — DiffViewer**

- Gutter icons (❌ failure, ⚠ warning, ℹ notice) on affected lines
- On hover: tooltip with `title` + `message` — same pattern as inline comments
- In the CI tab: check-runs with annotations show a clickable "N annotations" badge

---

### v2.18.0 — Scratch worktree + extended Conflict Predictor

_Inspired by GitSquid. A natural extension of the GitWand engine and Worktree first-class (v2.7)._

**Scratch worktree for isolated resolution**

- From the merge preview or the Conflict Predictor, open a temporary isolated worktree (`gitwand-scratch-<timestamp>`) without touching the active checkout
- Resolve conflicts in this sandbox, validate, then bring changes back to the main checkout in one click
- Automatic cleanup of the scratch worktree after merge-back or abandonment

**Conflict Predictor extended to rebase and cherry-pick**

- `gitwand_preview_merge` extended to simulate a rebase (`git rebase --no-apply`) and a cherry-pick (`git cherry-pick --no-commit`) without modifying the working tree
- Hunk-by-hunk preview before launching the operation, with a risk level (low/medium/high)

---

### v2.19.0 — Monorepo Scope

_Inspired by GitSquid. Makes GitWand ergonomic on large monorepos (pnpm, Cargo, Nx…)._

- **Workspace scope picker**: select a sub-workspace — the graph, commit search, and stats all scope to its file tree
- **Auto-detection**: reads `pnpm-workspace.yaml`, `Cargo.toml [workspace]`, `nx.json`, `turbo.json`, `go.work`
- **Scope persisted per repo** in `.gitwand-workspace.json`
- **Right-click on a folder** in the folder tree → "Scope here" — ad-hoc scope without config

---

### v2.20.0 — Safety Bundle: pre-commit secrets scanner

_Inspired by GitSquid. A "safety" feature with zero network dependency — everything local._

- **Scanner integrated in the staging area**: AWS, GCP, Azure, GitHub tokens (`ghp_`, `github_pat_`), GitLab (`glpat-`), Slack, Stripe, OpenAI, Anthropic, RSA/OpenSSH/EC keys, JWTs, high-entropy literals
- **Extensible patterns** via `.gitwandrc`: `secrets.patterns[]` + `secrets.ignore[]`
- **Non-blocking UX**: orange badge in the commit area — the user can commit with confirmation or ignore the pattern
- **Zero network**: local matching via Rust (`regex` crate)
- **Opt-in pre-commit hook** in Settings > Hooks

---

### v2.21.0 — Stacked Branches (native)

_A differentiating feature: stacked PRs workflow without an external CLI (Graphite, ghstack…)._

The paradigm: short stacked branches (`feat/step-1` → `feat/step-2` → `feat/step-3`), each with its own PR targeting the previous one.

**Visualization** — The DAG automatically identifies stacks; a "Stack" banner in the sidebar; a "Stacks" tab in the Launchpad

**Creation** — "Stack a branch" button in the context menu; `⌘⇧S` shortcut from the commit area

**Restack** — Automatic detection when the base has moved; one-click "Restack" button (cascading `git rebase --onto`); conflict preview before execution

**PRs** — "Submit stack": creates or updates GitHub PRs for each layer; automatic retarget when a layer is merged

**Implementation** — Metadata in `.gitwand-workspace.json`; no external CLI dependency

---

### v2.22.0 — Voice Input (experimental)

- **Local dictation**: microphone button in the commit panel — transcription via embedded Whisper (`whisper-rs` Rust) — zero cloud
- **Optional AI enrichment**: pass dictated text through `useAIProvider` for conventional commit formatting
- **Models**: `tiny` or `base` downloaded on demand, stored locally
- **Multilingual**: Whisper auto-detects the language
- **Graceful fallback**: clear message if microphone access is denied by macOS TCC

---

### v2.23.0 — Terminal tabs & AI workspace

_Inspired by t1gu1's feedback: "How can I code with AI in GitWand?" — GitWand as a native AI workspace._

**Terminal with tabs**

- The integrated terminal extended with tabs: multiple simultaneous shell sessions (`⌘T` new, `⌘W` close, `⌘1..9` switch)
- Automatic title from the first command, or editable with a double-click
- Terminal panel anchored at the bottom, resizable height

**AI workspace (exploratory phase)**

- "New AI task" button: opens a blank worktree + launches a Claude Code (or Codex CLI) session in a dedicated terminal tab — the worktree diff displays live in GitWand
- Vision: GitWand as the command center for coding with AI — see what the agent changes, stage what you want, commit — without leaving the app
- User feedback expected to shape v2.24+

---

## Vision

GitWand is a native Git client that **understands** code, resolves trivial conflicts on its own, and makes visible what the terminal hides.

Positioning: neither "yet another Git GUI" nor an IDE. A first-class Git navigation tool — fast, local-first, cross-platform — with a unique algorithmic intelligence for conflict resolution, and a surface for interacting with AI agents (MCP, Agent Sessions, terminal).

**Core values**: open source (MIT) · native performance (Tauri 2 + Rust) · zero mandatory cloud · every feature optional and explicit.

---

## Competitive landscape

| Client | Stack | Price | Strengths | Weaknesses |
|--------|-------|-------|-----------|------------|
| **Kaleidoscope** | macOS native | ~€150/yr | Image diff, folder diff, visual 3-way merge | macOS-only, no Git workflow, no auto-resolve |
| **GitHub Desktop** | Electron | Free | Simple, GitHub PR workflow, cherry-pick/rebase | GitHub only, basic diff, no AI, no auto-resolve |
| **GitButler** | Tauri/Rust | Free | Virtual branches, stacked PRs, Agents Tab (Claude Code); MCP server, Series A Apr 2026 | Unfamiliar paradigm, no algorithmic auto-resolve |
| **GitKraken** | Electron | $8/mo | Agent Mode v12.0, multi-forge, Launchpad, cloud Workspaces, AI commit/PR/merge | Paid, Electron, cloud account required for advanced features |
| **GitSquid** | Tauri/Rust | €49/yr | Conflict Predictor, scratch worktree, Monorepo Scope, secrets scanner, multi-forge | Paid, no algorithmic auto-resolve |
| **Fork** | Native | $50 | Fast, clean UI, large repos | No inline PR review, no auto-resolve |
| **Tower** | Native | $69/yr | AI commits (Claude Code + Codex, v16 May 2026), multi-forge | Paid, no resolve engine |
| **Sublime Merge** | Native | $99 | Ultra-fast, configurable `diff_algorithm` | No PR workflow, no AI, no auto-resolve |

---

## Shipped

> Full change details per version: [CHANGELOG.md](./CHANGELOG.md)

| Version | Highlights |
|---------|-----------|
| **v2.15.1** | Git Tree polish & quick actions — Force push (branch context menu + protected-trunk/diverged-remote guard), Quick Stash `⌘⇧,` (instant, AI label) + pending badge in the commit area, Submodules in the Git Tree (branch-picker section, per-commit pointed-SHA badge, click-to-navigate) |
| **v2.15.0** | Git Tree multi-branch — Git Tree as primary view, Log panel removed, unified context menus, stash/branch/tag management from the graph, DAG trunk-pinning, WIP node, search bar |
| **v2.14.0** | Forge completeness — GitLab `updateComment`/`deleteComment`/CI checks, complete Bitbucket stubs, forge-agnostic `getConflictPreview`/`getHotspots`, multi-account provider |
| **v2.13.0** | AI & Review — custom AI prompt presets, GitHub-native inline code suggestions in PRs |
| **v2.12.0** | Branch Management & Identity — Archived Branches, Pinned Branches, Multiple Committer Identities, Commit Templates |
| **v2.11.0** | Large-scale performance — `backend.ts` domain split, Fork Point visualization, transparent command log (`⌘⇧L`), real-time clone progress, CommitLog pagination |
| **v2.10.0** | Forge integrations + MCP catalog — GitLab MRs, Bitbucket PRs, multi-account, in-app MCP catalog (Settings > MCP, one-click install) |
| **v2.9.0** | Launchpad — cross-repo PRs/Issues/WIP/Team dashboard, pin/snooze, `⌘L`, lazy Team, 95 green tests |
| **v2.8.0** | Agent Sessions View + Scheduled AI tasks — Agents panel, active MCP sessions, launch Claude Code from GitWand |
| **v2.8.2** | Performance hardening — lazy-load 20 panels, bundle −150 KB, libgit2 fast-path, consolidated polling, `lib.rs` split into 6 domains |
| **v2.7.0** | Multi-repo Workspaces + Hooks manager + Worktree first-class — tab=worktree, quick-create "New task" (`⌘⇧N`), cross-worktree status |
| **v2.6.0** | `@gitwand/core` Refactoring-aware merge — rename/move detection, opt-in via `.gitwandrc` |
| **v2.5.0** | LLM fallback opt-in — `llm_proposed` pattern, `resolveAsync()`, audit trail, desktop+CLI+MCP tie-in |
| **v2.4.1** | Semantic post-merge validation — tree-sitter parse-tree validity, opt-in `tsc --noEmit`, `postMergeRisk` dimension |
| **v2.3.0** | Tree-sitter structural dispatcher — entity-by-entity merge for TS/JS/Python/Go/Rust, +20-30% auto-resolution |
| **v2.2.0** | Format profile registry + JSON Patch arrays — `/dependencies`, `/scripts`, RFC 6902, +10-15% on JSON/YAML |
| **v2.1.0** | Histogram diff & block-move detection — Patience++, Rabin-Karp rolling hash |
| **v2.0.0** | Distribution & polish — Clone & Fork from the UI, Codex CLI provider, native macOS menu bar, Contributors Dashboard |
| **v1.9.0** | Git 2.54 suite — commit context menu (checkout/reset/revert/branch/tag/cherry-pick), Trailers, Blame diff algorithm, File history line-range + pickaxe, Tags panel, Conventional Commits prefixes |
| **v1.8.0** | Design system & modal foundations — AppHeader split, BaseModal, merge editor line numbers + minimap, PR description markdown |
| **v1.7.0** | Split commit by hunks — line-by-line selection, integrated into interactive rebase |
| **v1.6.x** | Folder diff, Image diff, Submodules & Worktrees, `@gitwand/core`/`@gitwand/cli`/`@gitwand/mcp` published on npm + MCP Registry |
| **v1.5.x** | Hardening, performance & English-first — XSS, LCS O(min), CI Rust↔Node parity, macOS TCC fix |
| **v1.4.0** | Pattern registry — `reorder_only`, `insertion_at_boundary`, desktop auto-update |
| **v1.3.0** | AI Everywhere — branch naming, PR writing, hunk review, conflict explanation, commit search, release notes |
| **v1.2.0** | Interactive Rebase, Absorb, AI commits, Undo stack |
| **v1.1.0** | MCP server (`@gitwand/mcp`) — 5 tools, 3 resources, Claude Code slash commands, enriched CLI JSON |
| **v1.0.0** | Full Git client + resolution engine — 8 patterns, diff3 LCS, format-aware resolvers, PR workflow + integrated Code Review |

---

## Design principles

1. **Intelligence first** — Every screen should offer more than the terminal.
2. **Native performance** — Tauri 2 + Rust. Sub-1s startup, smooth on 100k+ commits.
3. **Progressive** — Works immediately for simple cases. Advanced features are discovered naturally.
4. **Cross-platform** — macOS, Linux, Windows. Same quality everywhere.
5. **Free and open source** — Core and desktop under MIT.
