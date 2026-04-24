# Changelog

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
