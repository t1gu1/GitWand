---
title: Changelog — GitWand
description: Release history for GitWand — the native Git client with AI conflict resolution. Follow new features, fixes, and improvements across every version.
---

# Changelog

## v2.8.1 — May 2026

Patch release addressing regressions reported after v2.8.0.

**Windows — CMD console flash.** Every Git command, `gh` CLI call, and external tool spawn was opening a visible black CMD window on Windows. All child processes now carry the `CREATE_NO_WINDOW` flag so they run fully silent. The only intentional exception is the `claude login` interactive flow, which needs a visible terminal to complete OAuth.

**Auto-updater stuck on "Installation…".** On macOS, Gatekeeper holds the newly-written binary for signature verification before allowing execution. If `relaunch()` was called too soon it threw "operation not permitted", leaving the update modal frozen on the spinner forever. A 3-second post-download delay is now applied on macOS only — on Windows the NSIS installer handles process restart itself, so no delay is needed. Any remaining `relaunch()` failure is caught and surfaced as a readable error with a manual-reopen instruction instead of silently hanging.

**Pull requests not loading when GitWand is opened from the Dock or Finder (macOS).** Apps launched outside a terminal inherit a minimal `PATH` that does not include Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`). The `gh` CLI — required for the PR panel — lives there and was therefore invisible to GitWand. All child-process spawns now extend `PATH` with the four common Homebrew and MacPorts prefixes on macOS automatically.

**CI release — intermittent asset upload failure.** GitHub's Releases API occasionally returns a 500 error when several platform builds upload assets in parallel. A verification step now runs after each build, detects any missing asset, and re-uploads it with up to three retries.

## v2.8.0 — May 2026

### Agent Sessions View + Scheduled AI tasks

GitWand now sees the AI agents working on your repos — and can act on your behalf while you sleep.

**Agent Sessions View** answers the question "what is my AI agent actually doing right now?" A new panel in the sidebar detects running Claude Code, Cursor, and Windsurf processes by examining their working directories, cross-referenced against your repo's worktrees. Each card shows the tool, branch, ahead/behind/modified status, and whether the session is currently live (animated pulse indicator). One click opens the worktree in a GitWand tab so you can watch the diff evolve in real time, or launch a fresh Claude Code session on any worktree directly from GitWand.

**Scheduled AI tasks** is a lightweight automation layer with no daemon, no cloud, and no configuration files — four opt-in tasks that integrate cleanly with the Git events you already work with:

- **Auto-resolve on conflict** fires the moment a `MERGE_HEAD` appears, runs the conflict resolver automatically, and logs the result.
- **Nightly pull + rebase** runs `git pull --rebase` at the hour and minute you choose — once per day, skipped if you're offline.
- **Release notes on tag** triggers when you push a `v*` tag and generates a CHANGELOG entry via the AI provider already configured in Settings.
- **AI commit batch** watches for staged files as you switch away from the app or close it, and surfaces an AI commit message suggestion so it's ready when you return.

All tasks have a toggle, show their last-run timestamp, and log every action to the Logs tab. AI-dependent tasks disable themselves gracefully when AI is turned off.

### Website refresh

The homepage has been redesigned from the ground up. The flat 20-card feature wall is gone; in its place:

A **live terminal demo** in the hero replaces the static screenshot — watch `gitwand resolve` classify and auto-resolve 12 conflicted files in real time, with a ↻ Replay button to run it again. Right after the hero, a **conflict before/after block** shows the exact transformation — one side tries `'dark'`, the other reads from localStorage, GitWand picks the right answer in a single line.

A **10-pattern grid** dedicates a card to each resolution pattern, with its name in monospace, a colour-coded confidence badge (certain / high / medium / low), a plain-English description, and an ⚡ Auto-resolved or ○ Review needed indicator. Below that, **tabbed features** organise 20 cards into four navigable tabs: Core Git, AI, Integrations, and New in v2.8 — so you can find what matters without scrolling past a wall of equal-weight items.

The page closes with a **benchmarks section** that leads with numbers, not adjectives: 249k ops/sec on a single conflict, 40k on five, 4.5k on fifty, ~8 MB binary (vs ~150 MB Electron), 322 tests all passing, and 0 hallucinations — fully deterministic resolution.

## v2.7.0 — May 2026

### Workspaces, Hooks manager, and Worktree first-class

Three pillars that together make GitWand the command center for multi-repo engineering workflows.

**Workspaces** bring the multi-repo dashboard you've always wanted — without any cloud, account, or proprietary sync. Drop a `.gitwand-workspace.json` in a directory (commitable if you like), group your repos by project or squad, and get a single view of every repo's branch, ahead/behind count, and modified file count. Fetch all, pull all, or open all in tabs in one click. The foundation v2.9's Launchpad will build on.

**Hooks manager** makes `.git/hooks` visible and controllable. The new Hooks tab in Settings lists every hook in the repo, lets you toggle it on/off with a switch (using the `.disabled` suffix convention understood by tools like Husky), create new hooks from a dropdown of all 18 standard Git hook names, and delete them with confirmation. The same 3-layer pattern (Rust command → dev-server endpoint → typed TS wrapper) used for all GitWand backend features.

**Worktree first-class** finishes what v1.6 started. Hit ⌘⇧N from anywhere, type a task name, and GitWand creates the worktree (path auto-derived as a sibling of the main worktree), creates the branch (`task/<name>` by default), and opens the worktree in a new tab — one gesture, no terminal. Each worktree row in the manager now shows live status pills (↑ ahead, ↓ behind, ~ modified, ✓ clean). And a new Cleanup panel surfaces non-main worktrees with nothing left to push, so you can select and delete merged branches in bulk.

---

## v2.6.0 — May 2026

### Refactoring-aware merge

The conflict resolver has a new trick: it now understands that two branches can make incompatible changes to a file not because they edited the same lines with conflicting intent, but simply because one branch renamed a variable while the other added new uses of the old name. These are the conflicts that look scary but aren't — and they've been invisible to every merge algorithm until now.

`@gitwand/core@2.6.0` introduces a four-phase pipeline for this. When a hunk resists all the standard patterns, the refactoring detector kicks in. It tokenises the base, ours, and theirs versions, identifies tokens that disappeared from one side and appeared on the other, and confirms via a full bijective substitution check that the token sequence maps cleanly. It handles three refactoring kinds: local variable / parameter renames (scoped to the enclosing function), top-level function and class renames (applied globally), and method moves between classes. Once the refactoring is confirmed, both branches are inverted back to the base nomenclature, merged with the standard 3-way engine (which now operates on code that agrees on all names), and the refactoring is replayed forward on the result. The whole pipeline runs inside a try/catch — if anything is uncertain, it degrades to `complex` without touching the conflict.

The feature is opt-in. Set `refactoringAware: { enabled: true }` in your `GitWandOptions` or `.gitwandrc`. With it disabled (the default), the code path is completely silent and adds zero overhead.

A technical note on a non-obvious edge case this release also fixes: when two parameters are renamed simultaneously in the same commit (`a` → `left`, `b` → `right`), both appear with the same occurrence count, which the original bijective algorithm misclassified as ambiguous. The fix uses permutation search over same-count candidate groups and validates each assignment against the full token sequence — correct result, negligible cost at the scales these hunks actually appear.

---

## v2.5.1 — May 2026

### PR filter — finally working end-to-end

The "Assignées" and "Reviews" filter buttons in the PR sidebar were silently showing all PRs regardless of the selection. Three separate bugs compounded to produce this failure. First, `ghCurrentUser()` was fetching from `/api/gh-current-user` (pointing at Vite's dev server on port 5173, which served back `index.html`), so JSON parsing threw `Unexpected token '<'` and the identity resolved to `null`. Second, the old error handler was `.catch(() => {})` — which swallowed the failure completely and showed all PRs as if the filter were off. Third, busy repos like Dendreo have more than 50 open PRs, and the `--limit 50` cap in the Rust backend silently dropped older ones; PR #9023 (assigned to Laurent) never appeared in any list. All three are fixed: the URL now carries the `${DEV_SERVER}` prefix used by every other endpoint; the error lands in a visible `currentUserError` ref with a Retry button in the UI; and the limit is raised to 300 in Rust and paginated 3 × 100 in the dev-server.

### Offline mode

A new `useNetworkStatus()` composable wires the browser's `online` / `offline` events to an `isOffline` ref that propagates through the app. When offline, `SyncSplitButton` disables all remote actions (push, pull, fetch, merge remote) and shows a tooltip explaining why. The app header shows an "Offline" pill. No more mystery failures when the laptop is on a train.

### Error log replaces the blocking banner

The red error banner that blocked the header whenever the app encountered an unhandled error is gone. In its place: a slim, non-blocking toast with a "View logs" link, a discrete red dot on the settings button to signal unread entries, and a dedicated Logs tab in Settings that shows a timestamped, reverse-chronological list (max 200 entries) with a Clear button. Errors are persisted to `localStorage` so they survive a reload.

---

## v2.5.0 — April 2026

### LLM fallback for complex conflicts

The core engine gets its biggest new capability since tree-sitter structural merge: a generative model fallback for the hunks that the deterministic patterns can't touch. When `llmFallback.enabled: true` is set in `GitWandOptions`, every hunk classified as `complex` by the pattern engine is routed to a model endpoint you supply — any API that accepts a prompt string and returns a string. The resolver constructs a context-aware prompt (configurable window of surrounding lines), calls the model, validates the output through the parse-tree and post-merge scoring pipeline, and accepts the resolution if its score clears the `minPostMergeScore` threshold. Below threshold, it falls back cleanly to `complex` and surfaces the hunk for manual review.

The new `llm_proposed` ConflictType appears in decision traces whenever a model resolution was accepted. The full audit trail — model name, latency, prompt hash, truncated raw response, validation score, accepted/rejected — is recorded in `LlmTrace` and attached to the hunk's `DecisionTrace`, so you can see exactly what happened and reproduce it.

The synchronous `resolve()` continues to work exactly as before — it never calls the model. The LLM path is only active in `resolveAsync()`, so the performance characteristics of the standard pipeline are unchanged.

`@gitwand/mcp` gains a `resolve_hunk` tool that exposes this full pipeline to any MCP client. Pass `ours`, `theirs`, and optionally `base`, and get back `type`, `confidence`, `resolution`, `explanation`, and `llmTrace` when a model was involved. Ten new corpus fixtures (F36–F45) cover the v2.5 surface.

### Desktop polish

Recent and pinned repositories now appear on the empty state and in the repo-switcher dropdown — no more hunting for a path you just had open. Push confirmation detects unpushed local tags and offers to include them. Two visual fixes: the Tags modal buttons were too small (now `size="md"` to match the rest of the app), and the Rewind button had a transparent background in Light mode (now uses `opacity: 0.12` on the danger color). The Worktree and Submodule panels have been migrated to `BaseModal` for visual consistency with every other overlay in the app.

---

## v2.4.1 — April 2026

### Semantic validation lands in core

The headline change is invisible from the merge editor: GitWand's resolver now refuses to ship a resolution that breaks the file's parse tree. Every candidate fix is fed through tree-sitter for the file's language, and resolutions that produce parse errors are either retried with another pattern or surfaced as manual conflicts. A new `postMergeRisk` dimension on `ConfidenceScore` (weight −0.20) retroactively demotes any resolution whose output doesn't parse cleanly — so the score you see in the trace is the score *after* validation.

Validation now ships in three tiers. `off` skips the parse-tree pass entirely — useful for raw-throughput batch resolves. `balanced` is the new default (renamed from `standard`) and runs the parse-tree check. `strict`, opt-in via `.gitwandrc`, layers `tsc --noEmit` and `eslint` on top through the new `adapters/strict-node.ts`. External-tool errors come back as a typed `ExternalValidationResult { tool, errors, passed }` instead of the previous loose `strictErrors` shape, so consumers can render per-tool diagnostics rather than concatenating strings.

The async resolver got the same treatment: `resolveAsync()` now populates `externalValidation` on every return path, regardless of which tier ran. Five new corpus fixtures (F31–F35) cover the v2.4 surface, and two new test suites (`v2-core-scenarios.test.ts` and `validation-parse-tree.test.ts`, 1,100 lines together) hold the line at **841/841 passing**.

This closes the v2.4 entry on the [CORE-V2-ROADMAP](https://github.com/devlint/GitWand/blob/main/CORE-V2-ROADMAP.md). The expected impact, per the roadmap target, is a roughly 50 % drop in parse-tree-broken false positives.

### In-app Help Panel

A new Help button in the header — mirrored in the macOS menu bar — opens a multilingual overlay covering Getting Started, Conflicts, Shortcuts, Workflow, AI features, and an FAQ. Press `Esc` to dismiss. Translated across all five locales.

### Agent discovery surfaces on the website

`gitwand.devlint.fr` now publishes the surfaces AI tooling looks for: an MCP server card, Agent Skills entries, an RFC 8288 `api-catalog` link, WebMCP browser-tool declarations, and explicit AI usage signals in `robots.txt`. The result is that an agent visiting the site can find `@gitwand/mcp` and its install path on its own — no human in the loop. The `server-card.json` is wired into `bump-version.sh`, so the version stays aligned with every release.

### Fixes

The post-merge "Delete «branch»" button was offering to delete `master`, `main`, or `develop` if you'd just merged them — now those mainline names are filtered out, and only feature/PR branches are eligible for cleanup.

The Histogram-diff opt-out flag was reading `import.meta.env.GITWAND_DIFF`, which isn't typed on `ImportMeta` without Vite types — `tsc --build` was breaking in CI. Replaced with a `typeof process`-guarded `process.env` lookup that works under Node.js without breaking browser/Tauri.

`@gitwand/cli` and `@gitwand/mcp` were stuck at 2.3.0 because `bump-version.sh` deliberately skips packages whose version drifts from `@gitwand/core`. The resync brings them to 2.4.1 alongside core, and the publish workflow's `[ version == tag ]` precondition now passes. `server.json`, `server.ts`, and `server-card.json` are aligned in the same commit.

---

## v2.3.0 — April 2026

The umbrella tag for three back-to-back `@gitwand/core` releases — v2.1, v2.2, v2.3 — that take the resolver from "good with text diff" to "good with the structure of the file." Plus cherry-pick from the log with full conflict-resolution flow, and a hardened auto-update manifest publish in CI.

### `@gitwand/core@2.1.0` — Histogram diff

The underlying diff routine now uses **Histogram diff** (rare-anchor splitting with forward/backward extension, JGit-style), replacing the pure DP / Hirschberg backend that shipped through 2.0.x. The new alignment is more stable on real source code, which directly lifts the success rate of `non_overlapping` and `insertion_at_boundary` patterns — corpus fixtures that previously fell into `complex` are now auto-resolved end-to-end.

The change is opaque to consumers: `lcs(a, b)`, `computeDiff(base, branch)`, and `mergeNonOverlapping(base, ours, theirs)` keep their public signatures. Set `GITWAND_DIFF=lcs` at call time to roll back to the legacy backend (debug, reproducibility, perf comparison). On runtimes without `process.env`, Histogram is always used.

A primitive `detectBlockMove(base, ours, theirs)` (Rabin-Karp rolling hash with token-diversity and literal anti-collision filters) ships alongside it — no scoring impact in 2.1, but it's the foundation for the v2.6 refactoring-aware merge. `ConfidenceScore.dimensions` gains an optional `algorithmStability` field reserved for the same purpose; default 0 keeps numeric output identical to v1.4 for all existing patterns.

### `@gitwand/core@2.2.0` — Format profile registry & JSON Patch

The JSON and YAML resolvers gain a registry of **format profiles** that annotate JSON Pointer paths with a merge strategy. The result is that two long-standing functional gaps disappear:

- **JSON arrays** at `/dependencies`, `/scripts`, `/keywords`, `/files`, etc. now merge semantically (set-by-identity or merge-keys) instead of bailing out on `Array.isArray`.
- **YAML sequences** in `helm/values.yaml` and Kubernetes manifests (containers, volumes, env vars, ports) merge by `name` (or `port` / `host` per resource) instead of failing on a single divergent line.

Five built-in profiles ship in 2.2: `package.json`, `tsconfig.json` (and `tsconfig.<variant>.json`), `composer.json`, `helm/values.yaml`, and a generic `kubernetes` profile that matches manifests under `k8s/`, `kubernetes/`, `manifests/`, or with conventional basenames. `registerFormatProfile(profile)` registers a custom profile and returns an unregister function for clean teardown in tests.

Under the hood, this version also ships a minimal in-house **RFC 6902 (JSON Patch)** implementation: `diffJson(base, target)` produces an op sequence (`add` / `remove` / `replace`), `applyJsonPatch(doc, ops)` applies it immutably, and `mergeJsonPatches(ours, theirs)` returns the concat when paths are disjoint or `null` plus a list of conflicting paths otherwise. The round-trip property `applyJsonPatch(base, diffJson(base, x)) ≡ x` is verified on 100 random JSON inputs. `move` and `copy` are deliberately not supported — express them via `add` + `remove`.

A new `GitWandOptions.disableFormatProfiles?: boolean` (default `false`) reverts the JSON and YAML resolvers to their v2.1 behaviour, useful when a third-party profile causes unexpected silent deletions, or for A/B comparison on a specific repo.

### `@gitwand/core@2.3.0` — Tree-sitter structural merge

The big one. GitWand now does an **AST-based first pass** for TypeScript, TSX, JavaScript, JSX, Python, Go, and Rust files: parse `base` / `ours` / `theirs` with `web-tree-sitter`, pair top-level entities (functions, classes, methods, top-level statements) by canonical signature, and merge entity-by-entity — the same approach as Mergiraf and Weave. When the structural pass yields `null`, the existing hunk-based engine takes over, so there's no loss of coverage on cases the structural merge can't handle.

Three things make this stay browser-compatible. `web-tree-sitter` is an *optional* peer dependency (`>=0.20.0`) — consumers who don't need structural merge don't pay for the WASM. Grammars come from `tree-sitter-wasms` and load lazily, behind a loader that supports both v0.20 and v0.26 API shapes. And the loader uses three environment adapters (`structural/parsers/adapters/{node,browser,tauri}.ts`) so the package keeps zero static Node.js imports; the Node-specific path is dynamic and guarded.

The async entry point `resolveAsync()` runs the structural pass and falls back to `resolve()` when needed. The synchronous `resolve()` keeps its v2.2 contract for callers that don't want to wait on WASM init.

### Cherry-pick from the log, with conflict resolution

The right-click *Cherry-pick* entry in the commit log used to call `git cherry-pick` and assume it succeeded. It now treats conflicts as a first-class state: `isCherryPicking` stays `true` while there are unresolved conflicts, the desktop switches to the changes view and selects the first conflicted file (mirroring `mergeBranch()`), and auto-fetch/poll pause for the duration. `cherryPickContinue()` handles multi-pass conflicts — it keeps the cherry-pick mode active until everything is resolved. The conflict banner button reads *Annuler le cherry-pick* or *Annuler le merge* depending on which operation is in flight. New i18n key `header.abortCherryPick` across all five locales.

### Polish

- Test regression: the CSS resolver's reason string explicitly skips the structural merge path. Stylesheets aren't AST-parseable in the way the structural dispatcher expects, so the test pins this contract.
- The release workflow's auto-update manifest publish gains a fallback endpoint and tighter retry semantics — a transient hiccup on the primary endpoint no longer fails the whole release.
- The README and website drop the macOS Gatekeeper workaround. The app has been Developer-ID-signed and notarized since v1.9.0, so the manual `xattr -d com.apple.quarantine` step is no longer needed.

### Fixes

A Rust panic in the diff line-counter — caused by removed-line counts going negative on an unsigned int — is fixed; the counter now uses signed integers.

The PR create form's base-branch detection used to fail because the branch list was still empty when the form opened. The form now waits for the list and uses the raw branch name instead of the display string, so candidate-base resolution works.

Untracked file diffs now render in the UI — the desktop falls back to parsing the diff output for files Git doesn't yet track.

The Vite alias points at `packages/core` source instead of the prebuilt dist, so a fresh clone runs the desktop dev server without an extra build step.

---

## v2.0.1 — April 2026

### A friendlier update prompt

The in-app update modal used to render the GitHub release notes as-is — a download table with platform/file rows and a raw "see the changelog" link. Useful for CI debugging, less so when you're being told a new GitWand is available. The modal now shows a sparkle, the version, a one-line teaser, and a link straight to this page anchored at the right heading. The release manifest still carries the technical body for future iterations, but the modal stops surfacing it.

---

## v2.0.0 — April 2026

### Native macOS menu bar

GitWand has a proper File / Edit / Repository / View / Window / Help menu bar on macOS. Open repositories, clone or fork, find in log, merge, open the integrated Git terminal, toggle the sidebar — all from the system menu, with labels translated across the five supported locales. The menu rebuilds on locale change and on repo open/close, so repository-only items grey out when nothing is loaded.

### Clone & Fork from the UI

Three entry points for getting a repo without leaving the app: secondary buttons under the empty state, a `+` dropdown on the tab strip, and File menu items (`⌘⇧O` for Clone). Pick a parent folder, paste a Git URL, GitWand creates the subfolder named after the repo. Fork uses `gh repo fork --remote-name=upstream` so you get the right two-remote setup for upstream PRs out of the box — no terminal trip.

### Beta update channel

A new toggle in Settings → General opts you into the beta channel. Stable users keep the in-app one-click auto-install. Beta users get notified of pre-release builds and download from the GitHub release page manually — a deliberate split because the Tauri updater can't be retargeted at runtime, and we'd rather be honest about that than fake an auto-install path that doesn't exist.

### OpenAI Codex CLI provider

Pair GitWand with Codex the same way it pairs with Claude Code CLI. The app detects the `codex` binary, pings to check auth, then routes commit messages, branch-name suggestions, conflict resolution, PR descriptions, and the rest through `codex exec`. Works with your ChatGPT subscription via `codex login`, or with `OPENAI_API_KEY` — no extra setup, no API key entry in Settings.

### Dashboard contributors — full history, scrollable

Contributors on the Dashboard now reflect the entire HEAD history via `git shortlog -sne` instead of a windowed `git log -n 250` aggregation. The list scrolls horizontally with scroll-snap and a fourth card peeking in to cue the swipe — so you see every author who ever touched the repo, not just whoever committed last.

### Five menu accelerators long overdue

Small items that disproportionately reduce friction once they're wired:

- **`⌘F`** — focus the search input in the commit log (and switch to the log view first if you weren't already there).
- **`⌘⇧T`** — open the integrated Git terminal in an overlay.
- **`⌘⇧S`** — toggle the sidebar to reclaim horizontal space for the diff.
- **`⌘⇧U`** — open the undo / rewind popover (separate from `⌘Z`, which stays on text-undo so editing a commit message doesn't accidentally rewind a merge).
- **Repository → Merge…** — opens the merge picker directly from the menu.

Toggle Light/Dark Mode loses its `⌘⇧T` accelerator (now claimed by Open in Terminal per the v2 spec). Still in View, still on the header chip.

### Fixes

- `RepoTabStrip` `+` dropdown was clipped by the strip's `overflow-y: hidden` and silently invisible. The menu now teleports to `<body>` and positions itself via `getBoundingClientRect`.
- `BaseModal` primary / danger buttons used `opacity: 0.5` for the disabled state, which read as "still active" against saturated backgrounds in light mode. Disabled now flips to neutral background + muted text.
- Browser-mode `FolderPicker` opened *underneath* `CloneModal` and `ForkModal` because both layers used `z-index: 100`. The folder picker is bumped to `z-index: 200` — it always dominates the modal that triggered it.
- `codex exec` doesn't accept `--quiet` (we'd added it on a hopeful guess); removed from detection ping and prompt calls.

---

## v1.8.0 — April 2026

### Shared design chrome — BaseModal everywhere

Ten modals — `EditCommitOverlay`, `MergeSuccessModal`, `PrReviewModal`, `RebaseEditor`, `SettingsPanel`, `SplitCommitModal`, `StashManager`, `BranchRenameModal`, `BranchDeleteModal`, `SearchPalette` — all now share a single `BaseModal` wrapper that handles the backdrop, focus-trap, Esc-to-close, and footer layout in one place. Accessibility fixes apply everywhere at once; duplicated chrome is gone.

### AppHeader rebuilt as composable blocks

The 1654-line `AppHeader.vue` monolith is split into focused components: `SyncSplitButton`, `BranchSelector`, `BranchMenu`, `SearchTrigger + SearchPalette`, `RepoTabStrip`, and `HeaderLogo`. Each is typed, i18n'd across all 5 locales, and independently testable. The `⌘K` command palette surfaces branches, commits, and quick actions from anywhere in the app.

### Merge editor — line numbers and minimap

The merge editor gains per-line numbering on code and conflict panels, plus a right-side canvas minimap that highlights auto-resolvable vs manual conflicts. Click any region in the minimap to jump to that conflict — particularly useful across large merges with dozens of hunks.

### PR intelligence panel redesign

The intelligence panel replaces emoji section icons with accent-soft tiles, upgrades the scope grid to stat cards with a radial hover gradient, and unifies file/hotspot/AI flag rows with a `border-left` severity strip. The conflict summary became a success/danger banner. Loading states use a dot spinner; reduced-motion preferences disable all transforms and animations.

### Branch rename and delete modals

`BranchRenameModal` and `BranchDeleteModal` replace the inline `rename()` / `confirm()` flows. The delete modal includes a type-the-name guard for unmerged branches. Backed by a new `git_rename_branch` primitive with the full three-layer implementation (Rust + dev-server + TypeScript wrapper).

---

## v1.7.0 — April 2026

### Split commit by hunks

A new "Split this commit…" entry in the commit log's context menu opens a modal that lets you break a single commit into two by picking individual lines across files. Each file shows as a collapsible row with diff stats and a hunk count; expand it to pick which lines go into the first commit, with the rest flowing into the second automatically. Large commits (> 3 files) get an "Expand all / Collapse all" toolbar.

Split is also wired into interactive rebase: pick a commit, switch its action to `split`, and the rebase halts at that commit, opens the split modal with the commit preloaded, then resumes after you confirm. Splitting a merge commit is blocked at every entry point — doing so would silently drop the second parent and flatten history.

### Correct patch headers for file lifecycle events

Added and deleted files were causing `git apply --cached` to fail with "does not exist in index" when a split touched a file creation or deletion. The diff now carries `status` and `oldPath` from `git_show`, and `patchBuilder` emits the correct extended headers (`new file mode`, `deleted file mode`, `rename from/to`) to match.

### Fix: context-line detection in git_show parser

The final site that still used `!starts_with('\\')` to detect context lines — at line 1811 of the `git_show` parser — is now corrected to `starts_with(' ')`. Empty strings were misclassified as context lines, producing phantom context in splits touching empty-line boundaries.

---

## v1.6.3 — April 2026

### Worktree manager

Create, list, and remove Git worktrees from a dedicated overlay panel. Each worktree shows its branch, HEAD SHA, path, and status badges (main / locked / bare). "Open in tab" opens any worktree as a first-class repo tab, enabling parallel work on two branches without stashing or switching. Every non-current branch in the branch popover gains a one-click worktree shortcut (⧉ icon) for a two-click "open this branch without touching my working tree" flow.

### Submodule panel

A new "Submodules" header button lists all submodules declared in `.gitmodules` with live status badges (clean / modified / not initialized). "Init & Update all" runs `git submodule update --init --recursive`. "Open in tab" opens any initialized submodule as a standalone repo tab. An inline warning banner counts uninitialized submodules and doubles as a one-click init trigger.

### Auto-update infrastructure fixes

Several gaps in the auto-update setup that had been preventing `.sig` file generation and installer delivery on all platforms are resolved: `createUpdaterArtifacts: true` added to `tauri.conf.json`, permissions (`updater:default`, `process:default`, `process:allow-restart`) added to `capabilities/default.json`, the updater endpoint simplified to a static `latest.json`, and the release workflow corrected to use the cryptographically-signed manifest produced by `tauri-action` rather than a hand-crafted one with empty signature fields.

---

## v1.6.2 — April 2026

### Image diff viewer

Binary image files (PNG, JPG, WebP, GIF, SVG) now render in the commit diff with four comparison modes: side-by-side with dimension and size metadata, overlay with opacity control, blink alternating the two images to reveal pixel-level deltas, and a draggable reveal slider. A 20 MB per-side guardrail skips oversized images with an explicit notice. SVG files render as text, not raster. A new `read_file_at_revision(path, rev)` backend command fetches file bytes at any git revision, enabling comparisons across `HEAD^`, branches, stashes, and anything in between.

### Folder tree in commit diff

The file list in `CommitDiffViewer` gains a flat ↔ tree toggle. Tree mode shows an expandable folder tree with per-folder aggregates and a click-to-filter that narrows the list to a folder's descendants with a breadcrumb and clear button. The sidebar column is now resizable by dragging its left edge (180–600 px, double-click to reset, persisted in `localStorage`). Full keyboard navigation on the tree.

---

## v1.6.1 — April 2026

### MCP Registry — ownership verification fix

`@gitwand/mcp@1.6.0` was published without the `mcpName` field required by the MCP Registry for ownership verification, causing the initial submission to fail with HTTP 400. This patch adds `"mcpName": "io.github.devlint/gitwand"` to `packages/mcp/package.json` and re-publishes as `1.6.1`. The registry listing is now live at `registry.modelcontextprotocol.io`.

---

## v1.5.1 — April 2026

### Release build fix — tauri-bundler binary crash

The `parity_probe` test binary was declared as `[[bin]]` with `required-features`. The Tauri bundler auto-discovers every `[[bin]]` entry and tries to embed it as a sidecar regardless of whether the feature flag is enabled, which caused release builds to fail on every platform with "does not exist". The probe is moved to `[[example]]`, which the bundler ignores. Source moves from `src-tauri/src/bin/` to `src-tauri/examples/`.

### macOS permission dialogs — repeated prompts fixed

Opening the home directory was triggering a `.join(".git").exists()` probe on every child entry, hitting macOS TCC for `Documents`, `Desktop`, `Downloads`, `Pictures`, `Movies`, `Music`, and `Library` on each listing. A `MACOS_TCC_PROTECTED` guard now skips the `.git` probe for these well-known system folders — they're never git repos anyway.

### i18n sweep — composable error strings

The remaining hardcoded French error strings in the AI-powered composables (`useCommitMessage`, `useBranchName`, `useReleaseNotes`, and nine others) now route through the `errors.*` i18n namespace across all 5 locales.

---

## v1.5.0 — April 2026

### XSS hardening

All `v-html` usage now routes through a shared `useSafeHtml` / `useMarkdown` composable that sanitizes output with DOMPurify. README rendering, PR bodies, commit-message previews, and every other bit of user- or Git-authored markup is filtered through a conservative DOMPurify profile with a URI allow-list, `target="_blank" rel="noopener noreferrer"` hardening, and `javascript:` protocol blocking.

### English-first UI

The desktop app now defaults to English, with French as a secondary locale kept in sync. The locale registry's source of truth moves from `fr.ts` to `en.ts`. The Settings panel still lets you force either language; the OS locale is respected automatically.

### `.gitwandrc` — `generatedFiles` option

Users can now declare extra glob patterns in `.gitwandrc` (e.g., `"dist/**"`, `"**/*.generated.ts"`) that GitWand treats as generated when applying the `generated_file` resolver. Patterns are additive on top of the built-in list.

### Post-merge validation — YAML + TOML

The `validateMergedContent` contract is extended with format-specific parsers. Invalid YAML or TOML after a merge is surfaced as a `syntaxError` with a `YAML: …` / `TOML: …` prefix, matching the existing JSON behaviour.

### LCS memory — 35× reduction

The diff engine's LCS now runs a hybrid `Int32Array` DP under 4 million cells and switches to Hirschberg's divide-and-conquer above that threshold. Measured on 3000×3000 inputs: ~36 MB → ~1 MB. Tie-break behaviour is preserved so existing diffs are byte-identical.

### Parallel conflict loading

Conflicted files are now read in parallel (bounded concurrency) instead of serially in both the desktop app and the CLI. Throughput scales with file count on large merges.

---

## v1.4.0 — April 2026

### AI everywhere

Fourteen AI-powered features shipped across the v1.4 cycle: branch-name suggestion from staged diff or a description; PR title and description from the `currentBranch..base` diff; hunk-level critique in the PR review panel; natural-language conflict explanations in the merge editor; pre-merge risk summary; stash message from unstaged diff; semantic squash grouping in interactive rebase; AI-ranked Absorb target selection; natural-language commit search; blame context ("why did this line change?"); AI release notes generator; and rotating localised feature tips on the empty state.

### Conflict engine — pattern registry

The classification pipeline is rewritten around a prioritised pattern registry. Each pattern declares its `priority`, `requires` (diff3 / diff2 / both), `detect`, `confidence`, `explanation`, `passReason`, and `failReason`. Two new patterns are added: `reorder_only` (pure permutations, auto-resolved) and `insertion_at_boundary` (pure insertions on both sides with an intact base, auto-resolved). Confidence scoring is tuned with boosters, penalties, and stricter guarding on `complex`.

### Auto-update check

The app checks for new versions against the GitHub Releases feed on launch and shows a toast with a changelog link when a new version is available. The current version is visible in the footer / About section.

---

## v1.2.0 — April 2026

### Interactive rebase

Drag-and-drop reorder in the log, per-commit actions (squash, edit message, drop, fixup), multi-select squash with combined message, rebase onto branch from the UI, and in-flight conflict handling (continue / abort / skip).

### Absorb

Right-click any modified file to absorb it into an existing commit. GitWand finds the best candidate via `git blame`, or you can do a partial absorb by selecting specific hunks. Inspired by GitButler's absorb workflow.

### AI commit messages

A dropdown in the commit area analyses the staged diff and produces a summary and description. Provider-agnostic: Claude Code CLI, Claude API, OpenAI-compatible, and Ollama are all supported. Regenerate, shorten, expand, switch language — without leaving the commit panel.

### Universal Undo

An operation stack covering commit, merge, rebase, cherry-pick, stash, and discard. One-click undo via `git reset` / `git reflog`. The history panel lets you jump back to any prior state.

---

## v1.1.0 — April 2026

### MCP server

`@gitwand/mcp` ships with 5 tools (`gitwand_status`, `gitwand_resolve_conflicts`, `gitwand_preview_merge`, `gitwand_explain_hunk`, `gitwand_apply_resolution`) and 3 resources over stdio transport. Compatible with Claude Code, Claude Desktop, Cursor, and Windsurf. Includes `/resolve` and `/preview` slash commands for Claude Code.

### CLI — enriched JSON output

The CLI now emits confidence scores, decision traces, `pendingHunks` with ours/theirs/base, and post-merge validation results in `--json` mode.

### Partial resolution

The desktop app can now apply all automatically-resolvable hunks even when some hunks remain manual — you don't have to wait until everything is resolved before committing the safe ones.

---

## v1.0.0 — 2026

### Full desktop Git client + conflict engine

The first production release. The core engine covers 8 conflict patterns (same_change, one_side_change, delete_no_change, whitespace_only, non_overlapping, value_only_change, generated_file, complex), LCS 3-way merge, diff2 + diff3 format support, composite confidence scoring, configurable merge policies via `.gitwandrc`, and a full format-aware resolver suite (JSON/JSONC, Markdown, YAML, Vue SFC, CSS/SCSS, TS/JS imports, npm/yarn/pnpm lockfiles).

The desktop app ships a complete Git workflow: staging, commit, push/pull, branches, merge editor, advanced diff, history, DAG graph, file history, blame, time-travel diff, merge preview, cherry-pick, stash, amend, repo switcher, multi-tabs, terminal, PR workflow via `gh` CLI, inline code review, intelligence panel, AI suggestions (Claude / OpenAI / Ollama), i18n in FR and EN, and dark/light/system theme.

332 tests, a 20-fixture real-world corpus, and benchmarks at 249k ops/s on a single conflict. CI/CD runs on macOS universal, Linux, and Windows.

---

## v0.0.1 — April 2026

### First public build

The initial release proved out the core idea: a TypeScript conflict-resolution engine with 5 automatic patterns (same_change, one_side_change, delete_no_change, whitespace_only, non_overlapping), a CLI with `--ci / --json` structured output, a VS Code extension with inline diagnostics and CodeLens annotations, and a CI pipeline across Node 18, 20, and 22. 28 tests covering all patterns against real-world fixtures (package.json, Laravel routes, Vue SFC, CSS, .env files).
