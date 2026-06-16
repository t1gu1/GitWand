---
title: "Sign in with GitHub & Azure DevOps, and open cross-fork PRs: GitWand v2.19"
description: "v2.19 takes the PR workflow off the gh CLI. OAuth device-flow sign-in for GitHub and Azure DevOps with tokens in the OS keychain, Azure DevOps as a first-class forge backed by the REST API, cross-fork pull requests that target the upstream parent, and a backend performance pass — async commands, a stale-while-revalidate PR cache, and a libgit2 status fast-path."
date: 2026-06-16
head:
  - - meta
    - property: og:title
      content: "Sign in with GitHub & Azure DevOps, and open cross-fork PRs: GitWand v2.19"
  - - meta
    - property: og:description
      content: "OAuth device-flow sign-in for GitHub and Azure DevOps (tokens in the OS keychain, no gh CLI), Azure DevOps as a first-class forge, cross-fork pull requests against upstream, and a backend performance pass."
  - - meta
    - name: twitter:title
      content: "Sign in with GitHub & Azure DevOps, and open cross-fork PRs: GitWand v2.19"
---

# Sign in with GitHub & Azure DevOps: GitWand v2.19

`@gitwand/desktop@2.19.0` is about access. Until now, GitWand's GitHub PR workflow leaned on the `gh` CLI: you installed it, ran `gh auth login`, and GitWand shelled out to it for every PR action. That works, but it's a setup step — and it left two forges (Azure DevOps) and one workflow (contributing from a fork) out in the cold.

v2.19 fixes all three. You can now sign in to GitHub **and** Azure DevOps directly from Settings → Accounts with an OAuth device flow, no CLI required. Azure DevOps becomes a first-class forge. And if your `origin` is a fork, you can open a pull request straight against the upstream parent. Plus a round of backend performance work that makes switching repos and PRs feel instant.

This was contributed largely by [t1gu1](https://github.com/t1gu1) — opened, fittingly, as a cross-fork PR from his own fork using the very feature it adds.

---

## Sign in with GitHub — no `gh` CLI

Settings → Accounts now has a **"Sign in with GitHub"** button. Click it and GitWand starts the [OAuth device authorization grant](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow): it shows you a short code, you approve it once in your browser, and GitWand receives an access token.

That token is stored in the **OS keychain** (Keychain on macOS, the Credential Manager on Windows, the Secret Service on Linux) — never written to disk in plaintext, and never exposed to the app's frontend. The Rust backend reads it when it needs to make an API call and nowhere else.

Once a token is present, the entire GitHub PR workflow — list, count, detail, diff, checks, files, create, merge, checkout, mark-ready — routes through a **tokenless REST path** that talks to the GitHub REST API directly. No `gh` process is spawned. If you'd rather keep using `gh`, nothing changes: when no Settings token is configured, GitWand falls back to the CLI exactly as before, including the ambient `GH_TOKEN` / `GITHUB_TOKEN` environment path.

---

## Azure DevOps, as a first-class forge

GitWand already spoke GitHub, GitLab and Bitbucket. v2.19 adds **Azure DevOps Services** (`dev.azure.com` and the legacy `*.visualstudio.com`).

Sign-in uses the same device-flow UX, this time against **Microsoft Entra ID**. Azure DevOps is a first-party Entra resource, so GitWand requests the narrow `user_impersonation` delegated scope (rather than `.default`) plus `offline_access` — which means a standard user can self-consent in most tenants, and a refresh token is available so your session **auto-renews** instead of expiring an hour after sign-in.

Remotes pointing at `dev.azure.com` / `*.visualstudio.com` are auto-detected and routed to a new `AzureProvider` backed by the Azure DevOps REST API (api-version 7.1). What's wired:

- **PR lifecycle** — list, count, detail, diff, files, create, merge, checkout, and draft → ready
- **Comments** — threaded PR comments
- **CI checks** — branch-policy evaluations (build validation, required reviewers), so the merge-readiness chip reflects real build **and** approval state
- **Reviews** — reviewer votes surfaced as review state

Azure has no unified-patch endpoint, so diffs, file lists and change stats are computed from local git. A few things degrade gracefully for now: comment edit/delete, line-anchored comment creation, reviewer pickers, and submitting reviews aren't wired yet — they simply do nothing rather than erroring.

---

## Cross-fork pull requests

This is the one that unblocks open-source contribution. If you've cloned your own fork, your `origin` isn't the repository you want the PR to land in — the upstream parent is. v2.19 makes that explicit:

- **Target-repository selector** — when GitWand detects that `origin` is a fork (via a new `gh_fork_info` command, or the REST equivalent), the PR create view shows a selector: open against the upstream parent, or against your own fork. It **defaults to upstream**, the way most contributions flow. On the REST path the head branch is qualified as `fork-owner:branch`; on the `gh` path it passes `--repo`.
- **Fork PRs in the list** — on the REST (token) path, the PR list for a fork now also includes the PRs you opened on the *upstream* repo, merged and sorted alongside your origin's own. Their detail, diff, checks and merge all resolve transparently to the upstream repository.

If you've ever had to leave GitWand, open the GitHub web UI, and manually pick the base repo to file a contribution — that round-trip is gone.

---

## A faster app under load

Riding along with the forge work is a backend performance pass aimed at the moments GitWand felt sluggish — switching repos, opening a PR, refreshing a list:

- **Async commands** — the PR-workflow Tauri commands are now `async`, with their blocking git and network calls offloaded to background threads. The UI thread is no longer held hostage while a `git fetch` or an API round-trip completes.
- **Stale-while-revalidate PR cache** — PR lists and details are persisted to disk and served instantly from cache on open, then revalidated in the background. You see your PRs immediately; fresh data swaps in when it arrives.
- **libgit2 `git_status` fast-path** — status reads now have an in-process libgit2 path that avoids spawning a CLI process, cutting IPC and process-spawn overhead on a hot path.

---

## A note for enterprises

Because the headline audience for Azure DevOps is companies, two org-policy gates are worth calling out — they're not bugs, but in locked-down tenants an admin has to flip a switch once:

- **GitHub** — if the org that owns the repo has third-party OAuth App restrictions enabled, an owner must approve the GitWand OAuth app (Org → Settings → Third-party Access). Personal repos and unrestricted orgs work out of the box.
- **Azure DevOps / Entra ID** — if the tenant disables user consent for third-party apps, a tenant admin must grant admin consent for the GitWand Entra app once. We request the narrow `user_impersonation` scope precisely so that, wherever the tenant allows it, a standard user can self-consent without involving an admin at all.

After that one-time approval, everyone signs in normally.

---

## Upgrading

Desktop auto-update will offer v2.19.0, or grab it from [GitHub Releases](https://github.com/devlint/GitWand/releases). Nothing to migrate: your existing `gh` / `glab` setups keep working, and the new OAuth sign-in is purely additive — opt in from Settings → Accounts whenever you want to drop the CLI dependency.
