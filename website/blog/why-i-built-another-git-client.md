---
title: "Why I built another Git client"
description: "There are already a dozen Git GUIs. Here's what was missing from all of them, and why I spent a year building GitWand anyway."
date: 2026-04-20
---

# Why I built another Git client

There are already a dozen Git GUIs. GitKraken, Fork, Tower, Sourcetree, GitHub Desktop, Sublime Merge, GitButler. Most of them are good. Some of them are excellent. So when people ask why I spent the better part of a year building yet another one, I owe them a real answer.

The short version: every Git client I've used shows you merge conflicts and stops there. Even for the obvious ones.

---

## The thing that kept bothering me

PhpStorm has a "magic wand" button in its merge editor. When you open a conflicted file, it scans every hunk and resolves the trivial ones automatically — the ones where only one side changed something, where both sides made the same edit, where the differences are just indentation. You're left with only the conflicts that genuinely need human judgment.

It's one of those features that, once you've used it, makes every other tool feel like it's missing a limb.

I've been using Git for a long time. I've resolved a lot of merge conflicts. And a huge portion of them — I'd estimate somewhere between 60% and 80% in a typical week — are completely trivial. A lockfile where two branches bumped the same dependency to different patch versions. A config file where only one branch touched a value. Two branches that independently made the exact same edit. None of these require a human decision. They're just noise.

Every Git client I know makes you resolve them manually anyway.

---

## What I actually wanted

I wanted a Git client that understood the *structure* of a conflict, not just its existence.

Not an AI that guesses at resolution and might hallucinate the wrong answer. Something deterministic — a classifier that applies explicit rules, explains its reasoning, and never touches anything ambiguous. If it's not certain, it asks. If it is certain, it just fixes it.

I also wanted this to be available everywhere, not just inside a specific IDE. In the terminal (`npx @gitwand/cli resolve`). In CI (`--ci` flag, structured JSON output). As an MCP tool that AI agents like Claude can call. And in a native desktop app that doesn't cost $150MB of RAM just to show a diff.

That's GitWand.

---

## The conflict resolution engine

The core of GitWand is a pattern registry — nine conflict types, evaluated in priority order, each with an explicit detection rule and a confidence score.

The patterns, from simplest to most complex:

| Pattern | What it detects | Confidence |
|---|---|---|
| `same_change` | Both branches made the exact same edit | Certain |
| `one_side_change` | Only one branch modified this block | Certain |
| `delete_no_change` | One branch deleted, the other left it alone | Certain |
| `non_overlapping` | Additions at different positions in the block | High |
| `whitespace_only` | Same logic, different indentation or spacing | High |
| `reorder_only` | Same lines, different order — a pure permutation | High |
| `insertion_at_boundary` | Both sides added lines, but at different ends | High |
| `value_only_change` | Same structure, one volatile value differs (hash, version…) | Medium |
| `complex` | Overlapping edits — never auto-resolved | — |

The engine requires `git merge --diff3` (or `merge.conflictstyle diff3` in your config) to unlock the most powerful patterns. With the three-way base available, `one_side_change` is trivially detectable: if ours matches the ancestor but theirs doesn't, take theirs. Without the base, you can't tell who changed what.

Every resolution carries a composite confidence score — not a simple label, but a weighted formula across five dimensions: classification certainty, data risk, block size, file complexity, and base availability. Anything below "high" is left for you, with a full decision trace explaining what was detected and why.

```
✓ src/config.ts — 3/3 resolved
  L12 [one_side_change] certain — Only the incoming branch modified this block.
  L25 [same_change] certain — Both branches made the exact same edit.
  L41 [value_only_change] high — Scalar value updated on one side (version field).
```

---

## The merge preview

One of my favorite features — and the one that gets the most surprised reactions from people seeing it for the first time — is the merge preview.

Before you merge any branch, GitWand simulates the outcome without touching your working tree. It uses `git merge-base`, `git show`, and `git merge-file -p --diff3` to compute exactly what would happen, then shows you a per-file breakdown:

- **Auto-resolvable** — the engine can handle it
- **Partial** — some hunks need your attention
- **Manual** — complex conflicts requiring human judgment
- **Add/delete** — a file was added on one side, deleted on the other

The summary badge tells you at a glance: `Clean merge`, `100% auto-resolvable`, or `3 conflicts to review`.

This matters because the worst time to discover a gnarly conflict is after you've already run `git merge` and your working tree is in a half-merged state. The preview gives you that information before you commit to anything.

---

## Format-aware resolvers

Plain-text conflict detection misses a lot. Two branches that both added a dependency to `package.json` will appear as an overlapping edit on the `dependencies` block — a false conflict, because the changes are semantically independent.

GitWand ships semantic resolvers for the file formats where this happens most often: JSON and JSONC (recursive key-by-key merge), Markdown (section-by-section merge by ATX heading), YAML, Vue single-file components, CSS/SCSS, TypeScript/JavaScript imports, and the major lockfile formats (npm, yarn, pnpm). For Cargo.toml. For Dockerfile. For `.env`.

The JSON resolver, as a quick example: it parses all three versions (ours, theirs, base), computes per-key diffs, and merges key by key. A key added on one side only → accept it. A key modified identically on both sides → keep it. A key modified differently on both sides → flag it as unresolvable and fall back to text. Nested objects are handled recursively.

The result is that a `package.json` where one branch added `lodash` and another added `axios` gets merged cleanly, even though the `dependencies` block was "touched" on both sides.

---

## The CLI and the MCP server

The desktop app is the main interface, but the engine doesn't live only there.

`npx @gitwand/cli resolve` runs the same engine from the terminal. `--dry-run` previews without writing. `--verbose` shows the full decision trace per hunk. `--ci` returns structured JSON with confidence scores, decision traces, and a `pendingHunks` array for the conflicts the engine couldn't resolve.

That `pendingHunks` array is the bridge to the MCP server (`@gitwand/mcp`). An AI agent — Claude, Cursor, Windsurf — can call `gitwand_resolve_conflicts`, get back the trivially-resolved hunks plus the unresolved ones with full context, and then apply its own reasoning to the remainder via `gitwand_apply_resolution`. GitWand handles the deterministic part. The LLM handles the semantic reasoning. Neither tries to do the other's job.

---

## What was harder than expected

A few things humbled me during this build.

**Edge cases in JSON merging.** The recursive key-by-key approach works well for most configs, but there are pathological cases — arrays of objects where identity is ambiguous, deeply nested structures where one side restructured the hierarchy. The resolver has to know when to give up and fall back to text, and getting that boundary right took more iteration than I expected.

**The `whitespace_only` false positive problem.** Whitespace differences that are *semantically neutral* in most languages (trailing spaces, mixed tabs/spaces) are *semantically significant* in Python. The resolver normalizes aggressively but has to be careful not to flatten indentation that carries meaning.

**macOS Gatekeeper.** GitWand isn't notarized yet (it's on the roadmap). First launch on macOS requires a right-click → Open workaround because Gatekeeper blocks unsigned apps. This creates unnecessary friction for new users and is near the top of the priority list.

**Auto-update.** The mechanism exists but had four silent bugs that were preventing it from ever triggering in practice. Fixing them went into v1.6.3 alongside the worktree and submodule work.

---

## Where things stand

GitWand is at v1.7.0. It covers the full daily Git workflow — changes, history, branches, push/pull, cherry-pick, stash, interactive rebase, amend, split commits by hunks, PR review with inline comments and CI checks — plus the conflict resolution engine, the merge preview, the CLI, the MCP server, and a VS Code extension.

322 tests passing. MIT licensed. Available for macOS, Linux, and Windows.

The repo is at [github.com/devlint/GitWand](https://github.com/devlint/GitWand). If you want just the engine without the desktop app, `npx @gitwand/cli resolve` is the fastest way in.

And if you use `git merge --diff3` (you should: `git config --global merge.conflictstyle diff3`), the engine will automatically use the three-way base for better classification.
