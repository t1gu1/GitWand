# Desktop App

The GitWand desktop app is a lightweight, native Git client built with Tauri 2 and Vue 3. It covers the full daily workflow and adds smart conflict resolution on top.

## Repository View

The main interface shows staged, unstaged, untracked, and conflicted files in a sidebar. The main area displays inline diffs. You can stage, unstage, and discard changes without leaving the interface.

**Partial staging** is supported at the line or hunk level — select exactly what goes into your next commit.

## Commit Workflow

- Summary and description fields
- Optional commit signature
- `Ctrl+Enter` / `Cmd+Enter` shortcut to commit
- **Amend unpushed commits** — a pencil icon appears on hover in the history log, opening an overlay pre-filled with the existing message

## Branches

Click the branch name in the header to:

- Search branches
- Switch to a branch
- Create a new branch
- Delete a branch
- Merge any branch via the merge button

## Merge Preview

Before merging, GitWand predicts the outcome **without touching the working tree** using `git merge-base`, `git show`, and `git merge-file -p --diff3`.

The preview shows a per-file breakdown:

| Status | Meaning |
|--------|---------|
| Auto-resolvable | GitWand can handle it automatically |
| Partial | Some hunks need manual resolution |
| Manual | Complex conflicts requiring human judgment |
| Add/delete | File added on one side, deleted on the other |

A badge summarises the overall result: `Clean merge`, `100% auto-resolvable`, or `N conflicts to review`.

## Push & Pull

One-click push and pull with badge counters showing ahead/behind commits. Auto-fetch runs in the background every 30 seconds.

## History & Graph

Browse the full commit log in the sidebar. Click any commit to see its diff with a file list and scroll-spy highlighting.

Long commit descriptions collapse to 2 lines with an expand toggle.

A separate **DAG graph view** renders the full branch topology as an SVG with lane layout and ref badges.

## Diff Viewer

- Side-by-side or inline toggle (persisted across sessions)
- Syntax highlighting for 30+ languages
- Word-level diff using LCS
- Collapsible unchanged regions
- Canvas minimap
- Hunk navigation (prev/next)
- Double-column line numbers

## Image Diff Viewer (v1.6)

Binary image files in a commit diff render side-by-side instead of the opaque "Binary file changed" line. Four comparison modes are available via a toggle:

| Mode | What it does |
|------|--------------|
| Side-by-side | Before / after with dimension + size metadata overlay |
| Overlay | Stacked images with an opacity slider |
| Blink | Alternates between the two images to reveal pixel-level deltas |
| Slider | Draggable reveal between before and after |

Supported formats: **PNG, JPG, WebP, GIF, SVG**. GIFs get an "animated" badge. SVGs render as raster (so you see the actual image) — the text diff remains available via the file history. Images larger than 20 MB per side are skipped with an explicit notice to keep the viewer snappy.

Under the hood, a new `read_file_at_revision(path, rev)` backend command (available in both the Rust/Tauri and Node dev-server paths) fetches file bytes at any git revision, so the viewer can compare `HEAD^` vs `HEAD`, across branches, stashes, or arbitrary refs.

## Folder Tree in Commit Diff (v1.6)

The file list on the right of the commit diff has a **flat ↔ tree** toggle. Tree mode collapses deeply-nested changes into an expandable folder tree with per-folder aggregates (files changed, additions, deletions), making a 200-file commit navigable at a glance.

- Click any folder to **filter the list** down to its descendants
- Breadcrumb at the top surfaces the active filter with a clear (×) button
- Sidebar is **resizable** — drag its left edge, or double-click to reset. Width is clamped 180–600 px and persisted across sessions
- Keyboard navigation throughout (arrow keys, Enter, Esc)
- Available in all five UI locales

The backing `folder_diff` backend command (Rust/Tauri + Node dev-server + TypeScript wrapper) builds the aggregated tree.

## File History & Blame

- Full file history with `git log --follow`
- Blame view grouped by commit
- Time-travel diff between any two versions of a file

## Repo Switcher

Click the repo name in the header to open a dropdown with all recently opened repositories. Pin favorites, remove entries, and switch instantly.

## Pull Requests

Browse, create, checkout, and merge GitHub PRs without leaving the app:

- PR list in the sidebar
- Full detail view: diff, CI checks, comments, inline review
- Inline comments anchored to diff lines with full threading
- Code suggestions via ` ```suggestion ``` ` blocks, applicable in one click

## AI Everywhere (v1.3)

AI is woven into every step of the workflow. Each suggestion is opt-in (explicit button or shortcut) and traceable (the prompt and provider used are visible). Works with any configured AI provider — Claude Code CLI, Claude API, OpenAI-compatible, or Ollama.

### PR & branch workflow

- **AI branch name** — propose a `feat/…` / `fix/…` name from a description or the staged diff instead of typing one
- **AI PR title & description** — `PrCreateView` analyses the commits in `currentBranch..base` and drafts a structured title + body (summary, test plan, breaking changes)
- **Hunk-level critique in the PR Intelligence panel** — per-hunk feedback on risks, regressions, and concrete suggestions (replaces the static-heuristics panel)

### Merge & rebase insight

- **Natural-language conflict explanation** — in the merge editor, the `DecisionTrace` is rendered in plain English ("this hunk changes the `login()` signature on both sides — manual required")
- **Pre-merge AI risk summary** — the merge preview complements the `merge-tree` simulation with an AI risk read ("3 files touch auth, high regression probability if untested")
- **Semantic squash in interactive rebase** — AI groups candidate commits by intent and proposes a combined message

### Commit & stash

- **AI stash message** — before `git stash` (and in the switch-branch flow), AI proposes a message from the unstaged diff
- **AI-ranked Absorb target** — when the selected lines span multiple commits, AI ranks candidates semantically instead of taking the first `git blame` hit

### History & search

- **Natural-language commit search** — query the log with plain-English questions ("when did we introduce log pagination?")
- **Blame context** — "why did this line change?" button on each blame block, answered with context from neighbouring commits
- **AI release notes generator** — produce structured markdown (Added / Changed / Fixed) from `git log <tag>..<tag>`, ready to paste into a GitHub release

### Dashboard

- **Rotating feature tips** — the empty state before repo selection cycles through ~20 localised tips every 30 s to surface features you might not have discovered

## Auto-update & version (v1.4)

On launch, GitWand checks the GitHub Releases feed for a newer version and shows a toast with a changelog link when one is available. The current version is displayed in the footer / About view.

## Settings

- **Language**: French / English
- **Theme**: Light / Dark
- **Commit signature**: Optional GPG signing
- **Diff mode**: Side-by-side or inline (default)
- **AI provider**: Claude Code CLI / Claude API / OpenAI-compatible / Ollama (used for every AI feature above)
