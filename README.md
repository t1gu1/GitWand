<p align="center">
  <img src="assets/logo.svg" alt="GitWand" width="300" height="120">
</p>

<h1 align="center">GitWand</h1>

<p align="center">
  <strong>A fast, native Git client with built-in smart conflict resolution</strong>
</p>

<p align="center">
  <a href="#desktop-app">Desktop</a> &bull;
  <a href="#conflict-resolution-engine">Conflict engine</a> &bull;
  <a href="#merge-preview">Merge preview</a> &bull;
  <a href="#cli">CLI</a> &bull;
  <a href="#mcp-server">MCP Server</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#roadmap">Roadmap</a> &bull;
  <a href="#code-signing-policy">Code signing</a>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-8B5CF6">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-100%25-3178C6">
  <img alt="Tests" src="https://img.shields.io/badge/tests-322%20passing-22c55e">
  <img alt="Version" src="https://img.shields.io/badge/version-1.7.0-22c55e">
</p>

---

GitWand is a lightweight, native Git client built with Tauri 2 and Vue 3. It covers the full daily workflow — changes, history, branches, push/pull — and goes further with **automatic resolution of trivial merge conflicts**, **integrated code review** with inline comments and intelligence analysis, and a typed resolution engine with composite confidence scoring. Since v1.3, AI assists every step of the workflow — branch naming, PR writing, hunk-level review, semantic squash, natural-language commit search, and more.

## Desktop app

### Repository view

Staged, unstaged, untracked and conflicted files in a sidebar with inline diffs in the main area. Stage, unstage, discard and commit without leaving the interface. Partial staging at the line or hunk level.

### Commit workflow

Summary + description fields, optional commit signature, Ctrl+Enter shortcut. **Unpushed commits can be amended** directly from the history log — a pencil icon appears on hover, opening an overlay pre-filled with the existing message.

### Branches

Click the branch name in the header to search, switch, create or delete branches. Merge any branch from the dedicated merge button. Each non-current branch shows a **merge preview button** that simulates the merge result before committing.

### Merge preview

Before merging a branch, GitWand predicts the outcome without touching the working tree — using `git merge-base`, `git show` and `git merge-file -p --diff3`. The result shows a per-file breakdown:

- **Auto-resolvable** — GitWand can handle it automatically
- **Partial** — some hunks need manual resolution
- **Manual** — complex conflicts requiring human judgment
- **Add/delete** — file added on one side, deleted on the other

A badge summarises the overall result: `Clean merge`, `100% auto-resolvable`, or `N conflicts to review`.

### Push & Pull

One-click push and pull with badge counters showing ahead/behind commits. Auto-fetch runs in the background every 30 seconds.

### History & graph

Browse the full commit log in the sidebar. Click any commit to see its diff with a file list and scroll-spy highlighting. Long commit descriptions collapse to 2 lines with an expand toggle. A separate **DAG graph view** renders the full branch topology as an SVG with lane layout and ref badges.

### Diff viewer

Side-by-side or inline toggle, persisted across sessions. Syntax highlighting for 30+ languages, word-level diff using LCS, collapsible unchanged regions, canvas minimap, hunk navigation (prev/next), double-column line numbers.

### File history & blame

Full file history with `git log --follow`, blame view grouped by commit, time-travel diff between any two versions of a file.

### Repo switcher

The current repo name in the header opens a dropdown showing all recently opened repositories. Pin favourites, remove entries, switch instantly — no file picker needed.

### Pull Requests & Code Review

Browse, create, checkout and merge GitHub PRs without leaving the app. The PR list sits in the sidebar (like the commit log) and the full detail — diff, CI checks, comments, inline review — fills the main area.

- **Inline comments** — read and write review comments anchored to diff lines, with full threading and code suggestions (` ```suggestion ``` ` blocks applicable in one click)
- **Review submission** — Approve / Request changes / Comment, with a draft queue to accumulate comments before sending
- **🧠 Intelligence panel** — conflict prediction (`git merge-tree` before merging), hotspot analysis (files that caused conflicts historically), review scope (% of codebase touched), static AI suggestions (breaking changes, missing migrations, removed exports), file review history

### Settings

Language (FR/EN, OS auto-detected), theme (dark/light/system), commit signature, diff mode, AI provider (Claude / OpenAI-compatible / Ollama), external editor, Git binary path, switch behavior (stash/ask/refuse). All persisted in localStorage.

### Installing

Download the latest build for your platform from [GitHub Releases](https://github.com/devlint/GitWand/releases):

- **macOS** — `.dmg` (Universal: Apple Silicon + Intel)
- **Linux** — `.AppImage` or `.deb`
- **Windows** — `.msi` or `.exe`

#### macOS — first launch workaround

GitWand is not yet Apple-notarized (on the v1.5 roadmap), so Gatekeeper will refuse the first launch with *"GitWand can't be opened because Apple cannot check it for malicious software"*. Pick one of:

1. **Right-click → Open** — in Finder, right-click (or Ctrl-click) `GitWand.app` → **Open** → **Open** again in the dialog. macOS remembers the choice.
2. **System Settings** — try to open the app once, then go to **System Settings → Privacy & Security** → click **Open Anyway** next to the blocked-app message.
3. **Terminal** — remove the quarantine flag:
   ```bash
   xattr -dr com.apple.quarantine /Applications/GitWand.app
   ```

Only apply this to builds you downloaded from the official [GitHub Releases](https://github.com/devlint/GitWand/releases) page.

### Running from source

```bash
git clone https://github.com/devlint/GitWand.git
cd GitWand
pnpm install

# Browser dev mode — no Rust needed
cd apps/desktop && pnpm dev:web

# Tauri desktop mode — requires Rust toolchain
# Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
pnpm --filter desktop tauri dev
```

---

## Conflict resolution engine

GitWand's core engine (`@gitwand/core`) automatically resolves trivial Git merge conflicts. It never touches complex or ambiguous hunks.

### Resolution patterns

GitWand v1.4 introduced a **pattern registry** — the classifier evaluates patterns in priority order, each declaring whether it requires diff3 (base available), diff2, or works on both.

| Pattern | Description | Confidence |
|---|---|---|
| **same_change** | Both branches made the exact same edit | Certain |
| **one_side_change** | Only one branch modified the block | Certain |
| **delete_no_change** | One branch deleted, the other didn't touch it | Certain |
| **non_overlapping** | Additions at different locations in the block | High |
| **whitespace_only** | Same logic, different indentation/spacing | High |
| **reorder_only** | Same lines, different order — pure permutation (v1.4) | High |
| **insertion_at_boundary** | Pure insertions on both sides, base intact (v1.4) | High |
| **value_only_change** | Scalar value update (version number, constant) | Medium |
| **generated_file** | File matches a known generated-file path pattern | High |
| **complex** | Overlapping edits — never auto-resolved | — |

### Composite confidence score

Every resolution carries a `ConfidenceScore` object rather than a simple label:

```ts
{
  score: 84,           // 0–100 composite score
  label: "high",       // "certain" | "high" | "medium" | "low"
  dimensions: {
    typeClassification: 90,  // certainty of the detected pattern
    dataRisk: 20,            // risk of data loss if auto-resolved
    scopeImpact: 10,         // impact of change size
  },
  boosters: ["Path matches generated-file pattern: lockfile"],
  penalties: ["Content will be regenerated — theirs assumed more recent"],
}
```

Score formula: `score = typeClassification − dataRisk×0.4 − scopeImpact×0.15`

### Format-aware resolvers

For structured files, GitWand uses semantic resolvers before falling back to text matching:

- **JSON / JSONC** — recursive key-by-key merge using `JSON.parse`/`JSON.stringify`. Handles nested objects, detects unresolvable scalar conflicts, strips comments in `.jsonc`.
- **Markdown** — section-aware merge by ATX heading (H1–H6). Merges independent sections, falls back to text if the same section is modified on both sides.

### Configurable merge policies

Create a `.gitwandrc` file at the project root to define resolution strategies:

```json
{
  "policy": "prefer-merge",
  "patternOverrides": {
    "*.lock": "prefer-theirs",
    "src/generated/**": "prefer-theirs",
    "CHANGELOG.md": "prefer-ours"
  }
}
```

Available policies: `prefer-ours`, `prefer-theirs`, `prefer-safety`, `prefer-merge`, `strict`.

### Decision trace

Every classification step is logged in a `DecisionTrace` for auditing and debugging:

```
✓ src/config.ts — 3/3 resolved
  L12 [one_side_change] certain — Only the incoming branch modified this block.
  L25 [same_change] certain — Both branches made the exact same edit.
  L41 [value_only_change:json] high — Scalar value updated on one side (version field).
```

---

## CLI

[![npm](https://img.shields.io/npm/v/@gitwand/cli?color=22c55e&label=%40gitwand%2Fcli)](https://www.npmjs.com/package/@gitwand/cli)

```bash
# Use directly with npx
npx @gitwand/cli resolve

# Or install globally
npm install -g @gitwand/cli
```

```bash
gitwand resolve              # Resolve all conflicted files in the repo
gitwand resolve --dry-run    # Preview without writing
gitwand resolve --verbose    # Detailed decision trace
gitwand status               # Show conflict status per file
gitwand resolve --ci         # CI mode: JSON output + semantic exit codes
```

### Enriched JSON output

The `--ci` / `--json` flag now returns a full structured report with composite confidence scores, decision traces, and pending hunks for LLM-assisted resolution:

```json
{
  "version": "0.1.0",
  "timestamp": "2026-04-14T12:00:00.000Z",
  "summary": {
    "files": 2,
    "totalConflicts": 5,
    "autoResolved": 4,
    "remaining": 1,
    "allResolved": false
  },
  "files": [
    {
      "path": "src/config.ts",
      "totalConflicts": 3,
      "autoResolved": 3,
      "remaining": 0,
      "validation": {
        "isValid": true,
        "hasResidualMarkers": false,
        "syntaxError": null
      },
      "resolutions": [
        {
          "line": 15,
          "type": "one_side_change",
          "resolved": true,
          "explanation": "Only one side modified this block",
          "confidence": {
            "score": 95,
            "label": "certain",
            "typeClassification": 100,
            "dataRisk": 5,
            "scopeImpact": 10
          },
          "trace": {
            "selected": "theirs",
            "hasBase": true,
            "summary": "One-side change detected — incoming accepted.",
            "steps": ["..."]
          }
        }
      ],
      "pendingHunks": []
    },
    {
      "path": "src/complex.ts",
      "totalConflicts": 2,
      "autoResolved": 1,
      "remaining": 1,
      "validation": {
        "isValid": false,
        "hasResidualMarkers": true,
        "syntaxError": null
      },
      "resolutions": ["..."],
      "pendingHunks": [
        {
          "line": 42,
          "type": "complex",
          "explanation": "Overlapping edits on both sides.",
          "ours": "const timeout = 5000;",
          "theirs": "const timeout = 10000;\nconst retries = 3;",
          "base": "const timeout = 3000;",
          "trace": {
            "selected": null,
            "summary": "Both sides modified — manual resolution required.",
            "steps": ["..."]
          }
        }
      ]
    }
  ]
}
```

The `pendingHunks` array gives AI agents and CI scripts everything they need to handle the conflicts that GitWand can't auto-resolve — the ours/theirs/base content, the classification trace, and the confidence breakdown.

---

## MCP Server

[![npm](https://img.shields.io/npm/v/@gitwand/mcp?color=22c55e&label=%40gitwand%2Fmcp)](https://www.npmjs.com/package/@gitwand/mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-22c55e)](https://registry.modelcontextprotocol.io/?search=gitwand)

GitWand ships an MCP (Model Context Protocol) server that exposes its conflict resolution engine to AI agents — Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client.

### Setup

Add this to your MCP client configuration (e.g. `claude_desktop_config.json` or `.claude/settings.json`):

```json
{
  "mcpServers": {
    "gitwand": {
      "command": "npx",
      "args": ["-y", "@gitwand/mcp"]
    }
  }
}
```

The server defaults to the working directory of the client. To pin it to a specific repo, add `"--cwd", "/absolute/path/to/repo"` to the `args` array. With Claude Code, install in one line:

```bash
claude mcp add gitwand -- npx -y @gitwand/mcp
```

### Tools

| Tool | Description |
|------|-------------|
| `gitwand_status` | List conflicted files with their complexity and auto-resolvability |
| `gitwand_resolve_conflicts` | Auto-resolve trivial conflicts, return DecisionTrace + pendingHunks |
| `gitwand_preview_merge` | Dry-run resolution — stats and risk assessment without writing files |
| `gitwand_explain_hunk` | Explain why a specific hunk was classified its type (full trace + context) |
| `gitwand_apply_resolution` | Apply a custom (LLM-provided) resolution to a specific complex hunk |

### Resources

| URI | Description |
|-----|-------------|
| `gitwand://repo/conflicts` | Current conflict state — files, counts, types |
| `gitwand://repo/policy` | Active `.gitwandrc` configuration |
| `gitwand://hunk/{file}/{line}` | Raw hunk content for a specific conflict |

### The human ↔ LLM collaboration loop

The MCP server enables a powerful workflow where GitWand handles the trivial conflicts automatically and the LLM tackles the complex ones:

1. **LLM calls `gitwand_preview_merge`** — sees how many conflicts exist and how many GitWand can handle
2. **LLM calls `gitwand_resolve_conflicts`** — GitWand auto-resolves the easy ones, returns `pendingHunks` for the rest
3. **LLM reads the `pendingHunks`** — each one contains ours/theirs/base content and a full decision trace
4. **LLM calls `gitwand_apply_resolution`** for each pending hunk — writes its resolution directly

### Claude Code slash commands

GitWand also ships `.claude/commands/` for Claude Code:

```bash
/resolve   # Full conflict resolution workflow
/preview   # Merge preview and risk assessment
```

---

## Architecture

```
gitwand/
├── packages/
│   ├── core/       @gitwand/core — Resolution engine (TypeScript)
│   │               parser, resolver, classifier, format resolvers,
│   │               confidence scoring, corpus tests (322 tests)
│   ├── cli/        @gitwand/cli — Command-line interface
│   ├── mcp/        @gitwand/mcp — MCP server (stdio transport)
│   │               tools (5), resources (3), Claude Code commands
│   └── vscode/     VS Code extension — CodeLens, diagnostics, status bar
├── apps/
│   └── desktop/    Tauri 2 + Vue 3 desktop app
│                   src-tauri/  Rust backend (git commands, IPC)
│                   src/        Vue frontend
└── .claude/
    └── commands/   Claude Code slash commands (/resolve, /preview)
```

The core engine is framework-agnostic and usable as a library:

```ts
import { resolve } from "@gitwand/core";

const result = resolve(conflictedContent, "src/app.ts");
console.log(`${result.stats.autoResolved}/${result.stats.totalConflicts} resolved`);

// With options
const result = resolve(content, "package.json", {
  policy: "prefer-merge",
  minConfidence: "medium",
  patternOverrides: { "*.lock": "prefer-theirs" },
});
```

---

## Development

```bash
git clone https://github.com/devlint/GitWand.git
cd GitWand
pnpm install
pnpm build          # Build all packages
pnpm test           # 322 tests across core
```

### Running benchmarks

```bash
cd packages/core
pnpm test:bench     # vitest bench — ops/s per fixture size
```

Baseline results on Apple M-series:

| Input | Throughput |
|---|---|
| 1 conflict / ~30 lines | ~249 000 ops/s |
| 5 conflicts / ~140 lines | ~40 000 ops/s |
| 50 conflicts / ~1350 lines | ~4 500 ops/s |
| JSON/Markdown format-aware | ~137 000 ops/s |

### Internationalization

GitWand uses a zero-dependency type-safe i18n system. `fr.ts` is the reference locale defined with `as const`. `en.ts` must match the same structure — TypeScript enforces it. The `useI18n()` composable provides `t(key, ...args)` with dotted key resolution and positional interpolation. OS language is auto-detected; users can override in Settings.

---

## Roadmap

### v1.0.0 — Shipped ✅

- [x] Core engine — 8 conflict patterns, LCS 3-way, diff2 + diff3, format-aware resolvers (JSON, Markdown, YAML, Vue SFC, CSS, lockfiles)
- [x] Composite confidence scoring (score 0–100 + dimensions)
- [x] Configurable merge policies — `.gitwandrc`, per-glob overrides
- [x] Decision trace + explain-only mode
- [x] Corpus of 20 reference fixtures + metrics + benchmarks
- [x] CLI — `gitwand resolve`, `gitwand status`, CI mode
- [x] VS Code extension — CodeLens, diagnostics, one-click resolve
- [x] Desktop app — full Git client (changes, history, branches, push/pull)
- [x] Diff viewer — side-by-side, word-level, syntax highlighting, staging, minimap
- [x] File history + blame + time-travel diff
- [x] DAG commit graph
- [x] Merge preview — zero side-effect simulation before merging
- [x] Cherry-pick, stash manager, amend commit
- [x] Repo switcher, multi-repo tabs, monorepo awareness
- [x] AI suggestions — Claude / OpenAI-compatible / Ollama for conflict resolution
- [x] PR workflow — list, create, checkout, merge (GitHub via `gh` CLI)
- [x] Inline code review — comments, threads, suggestions, multi-line selection
- [x] Review submission — Approve / Request changes / Comment, draft queue
- [x] 🧠 Intelligence panel — conflict prediction, hotspot analysis, review scope, AI suggestions, file review history

### v1.1.0 — LLM Integration ✅

- [x] MCP server (`@gitwand/mcp`) — 5 tools + 3 resources, stdio transport
- [x] Claude Code slash commands — `/resolve` and `/preview` workflows
- [x] Enriched CLI JSON output — confidence scores, decision traces, `pendingHunks`
- [x] Human ↔ LLM collaboration loop for complex conflict resolution

### v1.2.0 — Interactive Rebase & AI Commits ✅

- [x] Interactive rebase — drag-and-drop reorder, squash, edit message, drop, fixup
- [x] Squash multi-sélection with combined message
- [x] Rebase onto branch from UI, conflict handling (continue/abort/skip)
- [x] AI commit message transforms — dropdown menu (Claude Code CLI / Claude / OpenAI / Ollama)
- [x] Undo stack scaffolding (commit, merge, rebase, cherry-pick, stash, discard)
- [x] `gh-merge-pr` dev-server endpoint + TypeScript wrapper
- [x] Website — LLM/MCP section and FAQ on homepage

### v1.3.0 — AI Everywhere ✅

- [x] AI branch-name suggestion from diff or description
- [x] AI PR title & description from commit range
- [x] Hunk-level AI critique in the Intelligence panel
- [x] Natural-language conflict explanation in the merge editor
- [x] Pre-merge AI risk summary in the merge preview
- [x] AI stash message from unstaged diff (including switch-branch flow)
- [x] Semantic squash grouping in interactive rebase
- [x] AI-ranked Absorb target when lines span multiple commits
- [x] Natural-language commit log search
- [x] Blame context — "why did this line change?"
- [x] AI release notes / changelog generator
- [x] Dashboard: rotating feature tips before repo selection

### v1.4.0 — Pattern Registry & Auto-Update ✅

- [x] Pattern registry — prioritised, `diff3` / `diff2` / `both` declarative patterns
- [x] New resolver `reorder_only` — pure permutations auto-resolved
- [x] New resolver `insertion_at_boundary` — pure insertions on both sides, base intact
- [x] Refined composite confidence scoring (boosters/penalties tuned for v1.4 patterns)
- [x] Desktop — auto-update check against GitHub Releases + app version display
- [x] Shared hex-cube favicon across desktop app and website

### v1.5.0 — Hardening, performance & English-first ✅

- [x] XSS hardening — shared `useSafeHtml` / `useMarkdown` composable sanitising every `v-html` via DOMPurify + markdown-it
- [x] Dev-server CORS + filesystem-path enforcement to prevent cross-origin and traversal
- [x] English-first UI — default locale flipped to English across app and website, French kept in sync
- [x] `.gitwandrc` — `generatedFiles` option for user-defined glob patterns routed to the `generated_file` resolver
- [x] Post-merge validation extended to YAML + TOML with format-specific error reporting
- [x] LCS memory — O(n·m) → O(min(n, m)) via hybrid `Int32Array` DP + Hirschberg (~35× on 3000×3000)
- [x] Parallel conflict loading + `saveAllFiles` in the desktop app (bounded concurrency)
- [x] Parallel CLI file loop in `gitwand resolve`
- [x] Rust↔Node parity probe harness for 3 Tauri commands

### v1.5.1 — Release hotfix & macOS TCC ✅

- [x] Fix CI universal-darwin `lipo` failure — `autobins = false` so `parity-probe` only builds under its feature flag
- [x] Stop macOS 50× permission prompt loop — skip `.git` probe on TCC-protected home subfolders (Documents, Desktop, Downloads, Pictures, Movies, Music, Library)
- [x] Composable error messages routed through i18n (`errors.*` keys across 5 locales)

### Next — v1.6.0 — Distribution & visual diff

Target: end of May 2026. Planned scope (see [PLAN-v1.6.md](./PLAN-v1.6.md) for specs):

- [x] **`@gitwand/core`, `@gitwand/cli`, `@gitwand/mcp` published to npm** + listed on the official [MCP Registry](https://registry.modelcontextprotocol.io/?search=gitwand) as `io.github.devlint/gitwand` (shipped 2026-04-20 — see CHANGELOG for 1.6.1)
- [ ] **Image diff** — side-by-side, overlay, blink, slider (PNG, JPEG, SVG, WebP, GIF); heatmap + AI alt-text (P1)
- [ ] **Folder diff** — compare two folders, branches, or commits; AI summary per folder (P1)

Deferred to v1.7: Submodules & Git worktrees, GitLab / Bitbucket integration, macOS notarization + Windows code signing.

See [ROADMAP.md](./ROADMAP.md) for the full phased plan with competitive analysis.

---

## Code signing policy

Windows builds of GitWand are code-signed. Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

| Role | Member |
|------|--------|
| Committers / Reviewers | [Laurent Guitton](https://github.com/devlint) |
| Approvers | [Laurent Guitton](https://github.com/devlint) |

This program will not transfer any information to other networked systems unless specifically requested by the user.

---

## License

MIT — [Laurent Guitton](https://github.com/devlint)
