---
title: Changelog — GitWand
description: Release history for GitWand — the native Git client with AI conflict resolution. Follow new features, fixes, and improvements across every version.
---

# Changelog

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

## v1.10.0 — April 2026

### In-app update modal

GitWand no longer hands off to the native OS update dialog. A new modal surfaces directly in the app when an update is available. It shows a version badge, the full release notes for the incoming version rendered from markdown (bold, inline code, bullet lists), and a real-time download progress bar with a percentage counter. Dismiss it and keep working — the update applies on next relaunch.

### Fixes

- Blame diff algorithm selector: fixed a type cast error that prevented saving the setting in `SettingsPanel`
- `CommitLog`: resolved an emit overload that could cause a type error when selecting commits
- `blameAlgo` select binding and `currentGitUser` initialisation: fixed two TS errors that surfaced in strict mode
- macOS: fixed a base64 compatibility issue with binary data returned from the Rust backend

---

## v1.9.0 — April 2026

### Commit context menu — 12 actions

Right-click any commit in the log to get a full action menu: checkout, reset (soft / mixed / hard) with mode hints, revert, create a new branch from that commit, tag it (with AI suggestion), cherry-pick it to the current branch, open it on GitHub/GitLab, and copy the short or full SHA.

### Tags manager

A dedicated Tags panel lists all local and remote tags with their target commit, date, and type (annotated vs lightweight). Push a single tag or all at once, delete locally and optionally from remote with a single confirmation. A new **AI Suggest** button reads the commits since the last tag and proposes the next semantic version with a one-line description.

### Trailers (Signed-off-by / Reviewed-by)

The commit panel now has a collapsible **Certification & review** section. Add a `Signed-off-by` line with one click — pre-filled from your Git identity — and a `Reviewed-by` line for co-review attribution. Each field has a `?` button with a plain-language explanation of what the trailer means.

### Conventional Commits prefix picker

A row of chips above the commit message input lets you pick a prefix (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`) with one click. The selected prefix is prepended to the message automatically and persisted until you change it.

### Advanced file history

The File History panel gains two major features on the **Log** tab:

- **Pickaxe search** — filter the file's history to commits that added or removed a given string (`-S` exact match) or a regex (`-G`).
- **Line-range history** — click the clock icon on any blame block to view only the commits that touched those specific lines (`git log -L`).

On the **Blame** tab, a new inline `<select>` lets you switch the diff algorithm between `histogram` (default, best results), `patience`, and `myers` without leaving the view.

### Fork & triangular workflow

The sync button now shows an `↑N fork` badge when your push remote differs from your upstream (triangular / fork workflow). The badge reflects the number of commits you're ahead of your fork remote, keeping origin pushes and upstream pulls clearly separated.

### Post-merge branch cleanup

After a successful merge, GitWand offers to delete the merged branch in the same modal. A checkbox lets you also delete the corresponding remote branch in one step — no separate trip to the branch list.

### macOS code signing & notarization

GitWand is now signed with an Apple Developer ID certificate and notarized by Apple. Gatekeeper no longer blocks the app on first launch, and the repeated macOS permission dialogs in development mode are gone.

---

## v1.8.0 — April 2026

Design system & modal foundations, image diff, folder tree diff, worktrees, submodules, commit split by hunks, MCP server on official registry.

[Full history on GitHub →](https://github.com/devlint/GitWand/releases)
