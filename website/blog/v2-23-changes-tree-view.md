---
title: "A folder tree for your changes, and rebases that work in the real app: GitWand v2.23"
description: "v2.23 gives the Changes sidebar a list/tree layout toggle with collapsible folders, puts stage/unstage/discard on every file and folder row, and fixes interactive rebase in the packaged desktop app via a dedicated git_interactive_rebase command."
date: 2026-06-18
head:
  - - meta
    - property: og:title
      content: "A folder tree for your changes, and rebases that work in the real app: GitWand v2.23"
  - - meta
    - property: og:description
      content: "A nested folder tree for the Changes sidebar, per-file and per-folder stage/unstage/discard, and a fix that makes interactive rebase work in the packaged desktop app."
  - - meta
    - name: twitter:title
      content: "Changes tree view + interactive rebase fix: GitWand v2.23"
---

# Changes tree view + interactive rebase that actually works: GitWand v2.23

`@gitwand/desktop@2.23.0` is a quality-of-life release for the two places you spend the most time: the **Changes sidebar** and the **rebase editor**. The sidebar learns to show your working-tree changes as a folder tree and to act on files and folders in place; interactive rebase gets a fix that makes it work in the shipped app, not just from source.

Most of this came in from [@t1gu1](https://github.com/t1gu1)'s pull requests — reviewed, tested, and merged for this release.

---

## See your changes as a folder tree

A flat list is fine for three changed files. For thirty, spread across a dozen directories, it's a wall. v2.23 adds a **list / tree toggle** to the Changes view, sitting in the controls row to the right of the monorepo scope picker (and stretching full-width with text labels when there's no scope picker to share the row with).

In tree mode, each git section — Staged, Modified, Untracked — nests its files under their folders, and the folders collapse and expand just like the sections themselves. Open the directories you're working in, fold the rest away. Selecting a file automatically expands the folders leading to it, so the tree never hides what you just clicked.

Both the chosen layout and the per-section collapse state are persisted in `localStorage`, so the sidebar comes back the way you left it.

The tree-building itself lives in a new `useFileTree` composable — a pure function that takes the flat list of changed entries and returns a nested structure, with a flatten step that projects it into render-ready rows respecting the collapsed state (the same approach the diff folder-tree already used). Keeping it pure means it's covered by unit tests rather than tangled into the component, including the fiddly cases: untracked directories that arrive as a single trailing-slash entry, cumulative folder paths used as stable keys, and roll-up counts per folder.

---

## Stage, unstage, and discard — right where you are

The other half of the release is about acting on changes without drilling into section-level controls.

Every file row now carries a **discard** button alongside stage / unstage — previously discard lived only at the section header. In tree mode, **folder rows** get the same trio (stage / unstage / discard) operating on every file underneath them, so you can stage a whole directory or throw away a subtree in one click.

Section headers, folder rows, and file rows now share one visual vocabulary: a segmented **"action group"** — square buttons fused into a single pill, split by a hairline divider. And they're **always visible** now, not revealed on hover, so the action you want is never one mouse-position away from disappearing.

---

## Interactive rebase that works in the packaged app

Here's the one that was quietly broken. Reordering, squashing, editing, or dropping commits from the rebase editor *did nothing* in the built desktop app — even though it worked perfectly when running GitWand from source.

The cause was a runtime gap. The frontend was POSTing the rebase to an `/api/git-interactive-rebase` HTTP endpoint that only exists in `dev:web` mode (the Node dev-server used during development). In the packaged Tauri app there's no such server, so the request went nowhere — the rebase silently never reached git.

v2.23 closes the gap with a real `git_interactive_rebase` Tauri command. It writes your edited todo list to a temp file and injects it into `git rebase -i` through `GIT_SEQUENCE_EDITOR` — the one piece of environment control a plain command runner can't provide — then reports back whether the rebase paused on a conflict, so the editor's continue / skip / abort flow works exactly as before. The Rust command, its `backend.ts` wrapper, and the dev-server route are all kept in parity, so the feature now behaves identically whether you're in the real app or `dev:web`.

While we were in there, every base-branch picker in the app — the branch menu, the merge picker, the rebase target — now shares a single `branchSort`: current branch first, then `main` / `master`, then most-recently-committed, then alphabetical. The branch you're most likely to be reaching for sits at the top, everywhere.

> A note from the release: adding a new always-visible field to the branch selector nudged the main JS bundle five kilobytes over its budget. Rather than raise the ceiling, we lazy-loaded the create-branch field and the 600-line merge-preview panel with `defineAsyncComponent` — they only mount inside pop-over and modal UI anyway — which split them into their own chunks and brought the main bundle back under budget. The bundle-size check that caught it runs in CI on every build.

---

## Also in this release

- **Linux AppImage external links** — clicking the GitHub / Azure sign-in buttons, a PR or issue link in the Launchpad, "open repo on the web", or the changelog link did nothing in the released AppImage. The opener now tries `xdg-open`, `gio`, `kde-open5`, and `$BROWSER` in turn with a de-polluted environment and surfaces a real error if they all fail, and every external link in the app routes through the OS opener — so none can silently do nothing again.

---

## Upgrading

Desktop auto-update will offer v2.23.0, or grab it from [GitHub Releases](https://github.com/devlint/GitWand/releases). `@gitwand/core`, `@gitwand/cli`, and `@gitwand/mcp` are on npm at `2.23.0`. Nothing to migrate — everything here is additive, and your layout and folder-collapse preferences start fresh on first open.
