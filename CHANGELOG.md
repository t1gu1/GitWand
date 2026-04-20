# Changelog

All notable changes to GitWand will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.2] - 2026-04-20

### Added

- **Image diff viewer** — binary image files (PNG, JPG, WebP, GIF, SVG) now render in the commit diff with four comparison modes:
  - **Side-by-side** — before/after framed with dimension + size metadata
  - **Overlay** — stacked images with opacity control
  - **Blink** — alternates the two images to reveal pixel-level deltas
  - **Slider** — draggable reveal between before/after
  Includes a 20 MB per-side guardrail (oversize images are skipped with an explicit notice), safe rendering for SVG (text content, not raster), and an "animated" metadata badge for GIF. New `read_file_at_revision(path, rev)` backend command — available in both the Rust/Tauri and Node dev-server paths — fetches file bytes at any git revision so the viewer can compare `HEAD^` against `HEAD`, across branches, across stashes, etc.
- **Folder tree view in commit diff** — the file list in `CommitDiffViewer` gets a flat ↔ tree toggle. Tree mode shows an expandable folder tree with per-folder aggregates (files changed, additions, deletions) and lets you click any folder to filter the list down to its descendants — a breadcrumb + clear (×) button surfaces the active filter. The sidebar column is now **resizable by dragging its left edge**, with double-click to reset; width is clamped 180–600 px and persisted in `localStorage` (`gitwand.cdv.filelistWidth`). Full keyboard navigation (arrow keys, Enter, Esc) on the tree. New `folder_diff` backend command (3 layers: Rust/Tauri + Node/dev-server + TypeScript wrapper) builds the aggregated tree. i18n across all 5 locales (en, fr, es, pt-BR, zh-CN).

### Changed

- `@gitwand/core`, `@gitwand/cli`, `@gitwand/mcp`, `@gitwand/desktop`, and `gitwand-website` bumped to `1.6.2`. `@gitwand/mcp` server-reported protocol version and `packages/mcp/server.json` (MCP Registry manifest) aligned to `1.6.2` so registry consumers see a consistent version.

### Docs

- `packages/mcp/README.md` — document the two supported install paths for `mcp-publisher` (Homebrew and prebuilt binary) so new contributors aren't blocked on the registry-publish step.

### Internals

- `.gitignore` ignores Vite's `*.timestamp-*.mjs` temp files and the `.release-notes-*.md` scratch notes so they stop surfacing in `git status`.

## [1.6.1] - 2026-04-20

### Fixed

- **`@gitwand/mcp` missing `mcpName` field** — the MCP Registry rejects submissions whose referenced npm package lacks the `mcpName` field (ownership-verification mechanism preventing squatting). `@gitwand/mcp@1.6.0` was published without it, so the initial registry submission failed with HTTP 400. Fix: add `"mcpName": "io.github.devlint/gitwand"` to `packages/mcp/package.json` and re-publish as `1.6.1`.
- **`@gitwand/mcp` server-reported version** — `src/server.ts` hardcoded the protocol handshake version to `1.6.0`, now bumped to `1.6.1` in sync with package.json.

### Changed

- `packages/mcp/server.json` (MCP Registry manifest) bumped to `1.6.1` accordingly. `@gitwand/core` and `@gitwand/cli` remain at `1.6.0` — no code change needed there.

### Docs

- Root README and `packages/mcp/README.md` show an **MCP Registry** badge pointing to `registry.modelcontextprotocol.io`.
- Website (`HomeLanding.vue`, 5 locales) — MCP badge updated to surface the registry listing, FAQ answer for MCP install now leads with the `claude mcp add gitwand -- npx -y @gitwand/mcp` one-liner, and the CLI platform card fixes the stale `npm i -g gitwand` (was never a valid package name) to `npm i -g @gitwand/cli`.
- Root README roadmap — the `published to npm + MCP Registry` line is checked off with a ship date.

## [1.5.1] - 2026-04-19

### Fixed

- **CI release — tauri-bundler failing on every platform** — the `parity_probe` test binary was declared as `[[bin]]` with `required-features = ["parity-probe"]`. tauri-bundler auto-discovers **every** `[[bin]]` entry in `Cargo.toml` and tries to embed it as a sidecar in the final bundle, regardless of whether the feature was enabled — so release builds failed with `Failed to copy binary from .../target/release/parity_probe: does not exist`. Fix: move the probe from `[[bin]]` to `[[example]]` (examples are ignored by tauri-bundler and aren't built by default). Source moves from `src-tauri/src/bin/parity_probe.rs` to `src-tauri/examples/parity_probe.rs`; build command becomes `cargo build --example parity-probe`; output path becomes `target/debug/examples/parity-probe`. Parity harness default path updated accordingly.
- **macOS permission dialog prompting 50× on home folder** — opening the home directory triggered a `.join(".git").exists()` probe on every entry, which hit macOS TCC for `Documents`, `Desktop`, `Downloads`, `Pictures`, `Movies`, `Music`, and `Library`. Unsigned/ad-hoc dev builds don't persist TCC decisions, so the dialog reappeared for every child access. Fix: `MACOS_TCC_PROTECTED` guard in both the Rust (`list_dir`) and Node (`dev-server.mjs`) backends skips the `.git` probe for these well-known system folders when listing the home directory — they're never git repos anyway.
- **Unused variable warning** — `shortcut` → `_shortcut` in the global-shortcut closure at `src-tauri/src/lib.rs` (silences the clippy warning in release builds).

### Changed

- `@gitwand/core`, `@gitwand/desktop`, and `gitwand-website` bumped to `1.5.1`.

### Internals

- **i18n sweep — composable errors** — the remaining hardcoded French error strings in the AI-powered composables (`useCommitMessage`, `useBranchName`, `useReleaseNotes`, `useStashMessage`, `usePrDescription`, `useSquashSuggestion`, `usePrHunkCritique`, `useBlameContext`, `useMergeRisk`, `useCommitSearch`, `useHunkExplanation`, `useAIProvider`) now route through the `errors.*` namespace populated in all 5 locales. A standalone `t` helper is exported from `useI18n` so non-component modules can translate without instantiating the composable.

## [1.5.0] - 2026-04-19

### Security

- **XSS hardening across 10 views** — all `v-html` usage now routes through a shared `useSafeHtml` / `useMarkdown` composable that sanitizes output with DOMPurify (markdown-it for the markdown path). README rendering, PR bodies, commit-message previews, and every other bit of user- or Git-authored markup is filtered through a conservative DOMPurify profile with a URI allow-list, `target="_blank" rel="noopener noreferrer"` hardening, and `javascript:` protocol blocking.
- **Dev-server CORS + filesystem path enforcement** — the Node dev-server now refuses requests from unexpected origins and validates every repo/file path against a safe root, preventing path traversal on the desktop app's local HTTP bridge.

### Added

- **English-first UI** (P3.1) — the desktop app now defaults to English, with French as a secondary locale kept in sync. The locale registry's source of truth moves from `fr.ts` to `en.ts`, and the public website landing page mirrors the same default. French is automatically picked up when the browser / OS prefers it, and the Settings panel still lets users force either language.
- **`.gitwandrc` — `generatedFiles` option** (P2.4) — users can now declare extra glob patterns (e.g. `"dist/**"`, `"**/*.generated.ts"`) that GitWand treats as generated when applying the `generated_file` resolver. Patterns are additive on top of the built-in list.
- **Post-merge validation — YAML + TOML** (P2.5) — the `validateMergedContent` contract is extended with format-specific parsers. Invalid YAML / TOML after a merge is surfaced as a `syntaxError` with a `YAML: …` / `TOML: …` prefix, matching the existing JSON behaviour.
- **3 new parity-tested Tauri↔Node commands** (P2.3) — the Rust/Tauri and Node/dev-server backends now share a parity probe harness to catch drift; 3 commands are validated end-to-end on every build.

### Changed

- `@gitwand/core` and `@gitwand/desktop` bumped to `1.5.0`.
- `@gitwand/cli` and `@gitwand/mcp` bumped to `1.3.0` (parallel CLI loop, module split).
- `gitwand-website` bumped to `1.5.0` and aligned with the app release tag.

### Performance

- **LCS memory — O(n·m) → O(min(n, m))** (P2.1) — the diff engine's LCS now runs a hybrid `Int32Array` DP under 4M cells and switches to Hirschberg's divide-and-conquer above. Measured on 3000×3000 inputs: ~36 MB → ~1 MB, a ~35× reduction. Tie-break behaviour is preserved so existing diffs are byte-identical.
- **Parallel conflict loading in the desktop app** (P1.2) — conflicted files are read in parallel instead of one-by-one, with bounded concurrency. Same concurrency model applied to `saveAllFiles`.
- **Parallel CLI file loop** (P1.3) — `gitwand resolve` walks the conflict set concurrently (bounded) rather than serially. Throughput scales with file count on big merges.

### Internals

- **Shared markdown pipeline** (P1.4) — every view that used to call markdown-it / DOMPurify directly now goes through a single `useMarkdown` composable.
- **Resolver refactor** (P1.1) — the monolithic `resolver.ts` was split into 6 focused sub-modules (`validation`, `policy`, `generated-detection`, …), keeping the public API identical.
- **CLI refactor** (P2.2) — `cli/index.ts` split into sub-modules, one per command concern.
- Removed deprecated `@types/dompurify` — DOMPurify 3.x ships its own types.

## [1.4.0] - 2026-04-17

### Added

#### AI Everywhere (Phase 1.3.x)

- **AI branch-name suggestion** (1.3.1) — generate `feat/…` / `fix/…` branch names from a description or the staged diff.
- **AI PR title & description** (1.3.1) — `PrCreateView` analyses the `currentBranch..base` diff and produces a structured title + body (summary, test plan, breaking changes).
- **Hunk-level AI critique in PR Review** (1.3.1) — the Intelligence panel now surfaces per-hunk feedback (risks, regressions, concrete suggestions) instead of static heuristics.
- **Natural-language conflict explanation** (1.3.2) — the DecisionTrace is translated into plain English inside the merge editor ("this hunk changes the `login()` signature on both sides — manual resolution required").
- **Pre-merge AI risk summary** (1.3.2) — `MergePreview` complements the `merge-tree` simulation with an AI summary of risk ("3 files touch auth, high regression probability if untested").
- **AI stash message** (1.3.3) — the stash flow (including the switch-branch modal) proposes a message from the unstaged diff.
- **AI semantic squash grouping** (1.3.3) — interactive rebase groups candidate commits by intent and proposes a combined message.
- **AI-ranked Absorb target** (1.3.3) — when lines span multiple commits, the best candidate is picked from a semantic ranking rather than the first `git blame` hit.
- **Natural-language commit search** (1.3.4) — query the log with plain-English questions ("when did we introduce log pagination?").
- **AI blame context** (1.3.4) — "why did this line change?" button on each blame block, with context from neighbouring commits.
- **AI release notes generator** (1.3.4) — structured markdown (Added / Changed / Fixed) from `git log <tag>..<tag>`, ready to paste into a GitHub release.
- **Rotating feature tips on the empty state** (1.3.5) — a pool of ~20 localised tips cycles every 30 s on the dashboard before repo selection.

#### Conflict engine — v1.4

- **Pattern registry** — classification pipeline rewritten around a prioritised pattern registry; each pattern declares its `priority`, `requires` (`diff3` / `diff2` / `both`), `detect`, `confidence`, and `explanation`.
- **New resolver: `reorder_only`** — detects pure permutations (same lines on both sides, different order). Auto-resolved.
- **New resolver: `insertion_at_boundary`** — detects pure insertions on both sides with an intact base. Auto-resolved.
- **Refined confidence scoring** — boosters, penalties, and dimensions tuned for the two new patterns and for stricter guarding on `complex`.

#### Desktop

- **Auto-update check** — background check against the GitHub Releases feed on app launch, with a toast + changelog link when a new version is available.
- **App version display** — current version now visible in the footer / About section.

#### Branding

- Shared hex-cube favicon across desktop app and website.

### Changed

- `@gitwand/core`, `@gitwand/cli`, `@gitwand/mcp`, `gitwand-vscode`, `gitwand-website`, `@gitwand/desktop` versions aligned to `1.4.0`.
- `ConflictType` union extended with `reorder_only` and `insertion_at_boundary`.
- Replaced hardcoded CSS values with design tokens across desktop views.

## [1.2.0] - 2026-04-16

### Added

- **Interactive rebase** (Phase 1.2.1) — drag-and-drop reorder in the log, per-commit actions (squash, edit message, drop, fixup), multi-select squash with combined message, rebase onto branch from the UI, in-flight conflict handling (continue/abort/skip).
- **Absorb** (Phase 1.2.2, inspired by GitButler) — right-click a modified file to absorb it into an existing commit, automatic candidate detection via `git blame`, partial absorb through hunk selection (`useAbsorb.ts`).
- **AI commit messages** (Phase 1.2.3) — dropdown in the commit area analyses the staged diff and produces summary + description. Provider-agnostic: Claude Code CLI, Claude API, OpenAI-compatible, Ollama. Regenerate, shorten, expand, switch language.
- **Universal Undo** (Phase 1.2.4) — operation stack covering commit, merge, rebase, cherry-pick, stash, discard. One-click undo via `git reset` / `git reflog`. History panel lets you jump back to any prior state.
- `gh-merge-pr` endpoint in the desktop dev-server plus a TypeScript wrapper.
- Website homepage: new LLM/MCP section and FAQ.

### Changed

- `@gitwand/core`, `@gitwand/cli`, `@gitwand/mcp`, `gitwand-vscode`, `gitwand-website` versions aligned to `1.2.0`.
- Desktop app (`@gitwand/desktop`) and Tauri bundle bumped to `1.2.0`.

## [1.1.0] - 2026-04

### Added

- **MCP server** (`@gitwand/mcp`) — 5 tools (`gitwand_status`, `gitwand_resolve_conflicts`, `gitwand_preview_merge`, `gitwand_explain_hunk`, `gitwand_apply_resolution`) and 3 resources, stdio transport, compatible with Claude Code, Claude Desktop, Cursor, Windsurf.
- **Claude Code slash commands** — `/resolve` and `/preview` workflows.
- **Enriched CLI JSON output** — confidence scores, decision traces, `pendingHunks` with ours/theirs/base, post-merge validation.
- **Partial resolution** in the desktop app — apply resolvable hunks even when others remain manual.
- **Merge success modal** with Close and Push actions, light/dark themed via design tokens.
- **Dashboard README improvements** — GitHub-style header parsing, GFM tables, checkboxes, anchor navigation, relative image handling.
- **Website MCP Server page** and FR/EN homepage toggle.
- **New 3D hexagonal cube logo**; Tauri app icons regenerated (ico, icns, multi-size PNG).

## [1.0.0] - 2026

### Added

- Core conflict resolution engine: 8 patterns (same_change, one_side_change, delete_no_change, whitespace_only, non_overlapping, value_only_change, generated_file, complex), LCS 3-way, diff2 + diff3.
- Composite confidence scoring (`ConfidenceScore` 0–100), configurable merge policies via `.gitwandrc`, decision trace, explain-only mode.
- Format-aware resolvers: JSON/JSONC, Markdown, YAML, Vue SFC, CSS/SCSS, TS/JS imports, npm/yarn/pnpm lockfiles.
- CLI (`gitwand resolve`, `gitwand status`) with `--ci` / `--json` structured output.
- VS Code extension: diagnostics, CodeLens, status bar, `resolveFile` / `resolveAll` commands.
- Desktop app (Tauri 2 + Vue 3): complete Git workflow — staging, commit, push/pull, branches, merge editor, advanced diff, history, DAG graph, file history, blame, time-travel diff, merge preview, cherry-pick, stash, amend, repo switcher, multi-tabs, terminal, PR workflow via `gh` CLI, inline code review, intelligence panel, AI suggestions (Claude / OpenAI / Ollama), i18n FR/EN, theme dark/light/system.
- 332 tests, 20 fixtures corpus, benchmarks (249k ops/s on single conflict).
- CI/CD multi-OS (macOS universal, Linux, Windows), Tauri updater, VitePress documentation site.

## [0.0.1] - 2026-04-03

### Added

- **Core engine** (`@gitwand/core`) with 5 automatic conflict resolution patterns:
  - `same_change` — both branches made the exact same edit (certain)
  - `one_side_change` — only one branch modified a block (certain)
  - `delete_no_change` — one branch deleted, the other didn't touch (certain)
  - `whitespace_only` — same code, different formatting (high)
  - `non_overlapping` — additions at different locations, LCS-based 3-way diff (high)
- **CLI** (`@gitwand/cli`) with commands:
  - `gitwand resolve` — auto-resolve trivial conflicts
  - `gitwand status` — show conflict status
  - `--ci` / `--json` mode with structured JSON output and exit codes
  - `--dry-run`, `--verbose`, `--no-whitespace` options
- **VS Code extension** (`gitwand-vscode`) with:
  - DiagnosticsProvider — inline warnings on each conflict
  - CodeLensProvider — clickable annotations above each conflict marker
  - StatusBarItem — conflict count with auto-resolvable ratio
  - Commands: `resolveFile`, `resolveAll`
- **Desktop app placeholder** (Tauri + Vue 3, Phase 4)
- CI pipeline via GitHub Actions (Node 18, 20, 22)
- 28 tests covering all patterns + real-world scenarios (package.json, Laravel routes, Vue SFC, CSS, .env files)

[Unreleased]: https://github.com/devlint/GitWand/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/devlint/GitWand/releases/tag/v1.4.0
[1.2.0]: https://github.com/devlint/GitWand/releases/tag/v1.2.0
[1.1.0]: https://github.com/devlint/GitWand/releases/tag/v1.1.0
[1.0.0]: https://github.com/devlint/GitWand/releases/tag/v1.0.0
[0.0.1]: https://github.com/devlint/GitWand/releases/tag/v0.0.1
