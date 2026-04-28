---
title: Changelog — GitWand
description: Release history for GitWand — the native Git client with AI conflict resolution. Follow new features, fixes, and improvements across every version.
---

# Changelog

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
