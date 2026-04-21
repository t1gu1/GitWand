---
title: "Splitting a commit by hunks: what went into GitWand v1.7.0"
description: "How I added a hunk-level commit splitter to GitWand, why merge commits needed a hard block, and the patch-header bug that only surfaced on file creations."
date: 2026-04-21
---

# Splitting a commit by hunks: what went into GitWand v1.7.0

GitWand v1.7.0 ships the first piece of the Git 2.54 alignment line on the roadmap: **split a commit in two by picking individual lines across files**. The feature lives in the commit-log context menu ("Split this commit…") and also as a new `split` action in the interactive rebase editor, alongside `pick`, `edit`, `squash`, `fixup`, and `drop`.

The headline feature is the modal, but most of the engineering work went into three places that the UI doesn't show: a merge-commit guard, correct patch headers for added/deleted/renamed files, and a rebase state flag that finally stops conflating "conflict" with "still in progress".

---

## Part 1 — The split flow

### In one sentence

You pick which lines stay in the first commit. The rest flow into a second commit. Two commits out, one commit in, same tree at the end.

### What it looks like

The modal lists each file as a collapsible summary row — chevron, short name, path, `+N / -N`, hunk count, and a "`X lines selected`" badge that updates live. Collapsed by default for any commit with more than three files, which matters: a 17-file commit used to mount 17 `DiffViewer` components at once, which was both slow and broke the flex layout. Now a 17-file commit shows 17 44-pixel summary rows, and you expand the one(s) you care about.

Selections persist across collapse/expand — the inner `DiffViewer` unmounts on collapse (via `v-if`), so I added an `initialSelection` prop that deep-clones the saved `LineSelection` into the component's state on remount. Watchers don't fire on mount without `immediate: true`, so seeding at setup time is safe.

A toolbar appears above the file list when there are more than three files: "Expand all / Collapse all". For small splits (≤ 3 files), everything expands by default because that's the common case.

### The backend primitive

`git_split_commit` is a new command, implemented in both the Rust/Tauri path (`lib.rs`) and the Node dev-server (`dev-server.mjs`), wrapped by a TypeScript helper (`gitSplitCommit`) and a `useSplitCommit` composable. Per the GitWand architecture note pinned to my memory — **any backend change has to land in all three layers in lockstep** — this was a deliberate ritual, with a parity probe to confirm the two backends return identical payloads for identical inputs.

The shape is:

```
git_split_commit(cwd, commitHash, firstCommitMessage, firstCommitPatches)
  → { firstHash, secondHash }
```

The algorithm, roughly:

1. `git reset --mixed HEAD^` to unstage the target commit's changes.
2. For each file in `firstCommitPatches`, build a standalone patch and `git apply --cached` it (more on this below).
3. `git commit -m firstCommitMessage` — that's the first half.
4. `git add -A && git commit -C HEAD@{2}` — amend-by-repeat puts the rest into the second commit, preserving the original message.

Simple on paper. Two things made it tricky in practice.

---

## Part 2 — The merge-commit guard

### The bug

Step 1 is `git reset --mixed HEAD^`. If `HEAD` is a merge commit, `HEAD^` means "first parent only". The second parent disappears from the reachability graph, and with it, every commit that only existed on the merged-in branch. The split "succeeds" — no errors, no warnings — and you quietly lose history.

Worse, `git reflog` still has the old merge SHA, so you can undo it — but only if you notice. The typical user flow is "click split, get two commits, close the modal, move on". By the time you realize, you might have pushed.

### The fix

Block merge commits at every layer. Defense in depth because each layer is a separate entry point:

- **Rust backend** (`git_split_commit` in `lib.rs`) — probes `git rev-list --parents -n 1 HEAD`, counts tokens, errors if `parent_count != 1`.
- **Node dev-server** (`dev-server.mjs`) — same check via `execSync`.
- **TypeScript composable** (`useSplitCommit.ts`) — early return in `openFor` if `targetCommit.parents.length > 1`.
- **App-level dispatcher** (`App.vue`) — checks `entry.parents?.length ?? 0 > 1` before even opening the modal.
- **Context menu** (`CommitLog.vue`) — the "Split this commit…" entry is disabled (reduced opacity, `cursor: not-allowed`, tooltip) for merge commits.

The UI-level checks are cosmetic but important: they prevent the user from ever *trying*. The backend checks are the real guard, because the interactive-rebase `split` action is a second entry point that doesn't go through the context menu.

The root-commit case (parent_count == 0) gets the same treatment. Splitting the initial commit would need `git update-ref -d HEAD` followed by a reconstruction, and it's not on the v1.7 scope.

---

## Part 3 — The patch-header bug

### The symptom

Splitting a commit that **added** a new file failed with:

```
error: <path> does not exist in index
error: patch failed: <path>:0
```

Deleted files had a similar failure mode. Modified files worked fine.

### The cause

`patchBuilder.ts` was emitting the same header for every file:

```
diff --git a/<path> b/<path>
--- a/<path>
+++ b/<path>
```

That's correct for a modification — the file exists on both sides. But `git apply --cached` validates the `--- a/<path>` anchor against the current index. At step 2 of the split (after `git reset --mixed HEAD^`), the index reflects `HEAD^`'s state. A file that was *added* in the target commit doesn't exist in `HEAD^`'s index — so `--- a/<path>` fails the "source must exist" check.

Git's own patches handle this by encoding the file-level status in the extended header:

- **Added**: `new file mode 100644` + `--- /dev/null` + `+++ b/<path>`
- **Deleted**: `deleted file mode 100644` + `--- a/<path>` + `+++ /dev/null`
- **Renamed**: `rename from <old>` + `rename to <new>` + `--- a/<old>` + `+++ b/<new>`

### The fix

`GitDiff` now carries two new optional fields, plumbed through the full stack from the Rust `git_show` parser:

```ts
interface GitDiff {
  path: string;
  hunks: DiffHunk[];
  status?: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;  // for renames
  // …
}
```

`patchBuilder` branches on `status` and emits the right header. The rename path is rare inside a split flow (you'd have to intentionally split a commit that both renames and edits a file) but harmless to support, and it falls out naturally once you're branching on status anyway.

---

## Part 4 — The rebase `inProgress` flag

### The bug nobody reported

The interactive rebase editor used to close itself when `rebase.startRebase()` returned `{ success: true, conflict: false }`. That's correct for a clean rebase that runs to completion. It's wrong for an `edit` halt — or, as of v1.7, a synthetic `split` halt.

`git rebase -i` exits with code 0 when it halts on `edit` ("stopped at <commit>, amend or run `git rebase --continue`"). No error, no conflict marker, no merge trouble. Same exit shape as "fully done". The backend can't tell them apart from the exit code.

So the editor dismissed itself mid-rebase. The progress banner disappeared. The user was left wondering what had happened.

### The fix

Add an explicit `inProgress` flag to the result type of `startRebase`, `rebaseContinue`, and `rebaseSkip`. `conflict` is now reserved strictly for merge-conflict halts. `inProgress` is the authoritative "the rebase is not finished" signal, detected via `detectRebaseState(cwd)` after exit.

Callers switched from `if (result.success && !result.conflict)` to `if (result.success && !result.inProgress)`. The progress banner now stays up on `edit` and `split` halts, surfaces the right affordances ("Continue" / "Skip" / "Abort" / "Split this commit…"), and only dismisses when the whole rebase is actually done.

This change was latent in `useInteractiveRebase.ts` — a comment in the pre-v1.7 code literally said "treat the same as a conflict halt so the UI stays on the progress banner". It worked, but it was a lie: the UI thought the rebase was mid-conflict when it was mid-edit, and that lie was about to become load-bearing for the `split` action. So v1.7 cashed in the refactor.

---

## Part 5 — The ghost-row layout bug

### What I saw

On a commit with 17 files, the first two or three summary rows rendered at the correct 44-pixel height. The rest compressed to thin strips — sometimes a few pixels tall, sometimes just a border. Scrolling the container didn't help because there was nothing to scroll.

### Why

`.scm-diffs` is a `display: flex; flex-direction: column; overflow: auto`. The children (`.scm-file`) all have a natural height of 44px (the summary row). In a flex column container, **children shrink below their intrinsic size when total content exceeds available space** — unless you explicitly tell them not to. Without `flex-shrink: 0`, the browser treats the 17 × 44px as "too tall, compress some of them until it fits", and `overflow: auto` never engages because after compression everything technically fits.

### The fix

One CSS rule:

```css
.scm-file {
  /* …existing rules… */
  flex-shrink: 0;
}
```

Children keep their intrinsic height, total content exceeds the container, `overflow: auto` engages, and you scroll. This is one of those rules you remember every five years and forget again in between.

---

## What's next

v1.7 was the first piece of the Git 2.54 alignment on the roadmap. v1.8 is the rest of that line: trailer-aware commits, blame diff-algorithm selection, `git log -L` combined with pickaxe, and triangular-workflow ahead/behind badges for forks.

GitWand v1.7.0 is [available on GitHub](https://github.com/devlint/GitWand/releases). Context menu on any non-merge commit → "Split this commit…".
