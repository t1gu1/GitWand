---
title: "Contributing to open source with a fork: a GitWand walkthrough"
description: "The fork → clone → upstream → PR workflow, step by step. How GitWand's triangular-workflow badge surfaces the right information at the right time — something GitHub Desktop still doesn't do."
date: 2026-04-23
---

# Contributing to open source with a fork: a GitWand walkthrough

The standard way to contribute to a project you don't own is the **fork workflow**: you create your own copy of the repository on GitHub, work on it, and open a Pull Request back to the original. It's also called a **triangular workflow** because your code moves across three points — the original repo, your fork, and your local clone — and the fetch and push directions don't always go to the same place.

Most Git GUIs handle this badly. GitHub Desktop, for example, makes no distinction between your fork and the upstream: it shows one `origin` and one `ahead/behind` counter. That counter is accurate for your fork but useless for telling you how far behind the original project you are. GitWand does it differently.

---

## The workflow

### 1. Fork on GitHub

Find the repository you want to contribute to and click **Fork** on GitHub. This creates `github.com/YOUR-USER/PROJECT` — a full copy you control.

### 2. Clone your fork locally

```bash
git clone https://github.com/YOUR-USER/PROJECT.git
cd PROJECT
```

At this point you have one remote: `origin`, pointing at your fork.

### 3. Add the original repository as `upstream`

```bash
git remote add upstream https://github.com/ORIGINAL-OWNER/PROJECT.git
git fetch upstream
```

Now you have two remotes:
- `origin` — your fork (you push here)
- `upstream` — the original repo (you pull/fetch from here)

In a standard (non-fork) clone, the fetch remote and the push remote are the same. Here they're different. That's the triangular workflow.

### 4. Open GitWand

Open GitWand on your local clone. If GitWand detects that your push remote (`@{push}`) differs from your upstream tracking branch (`@{upstream}`), it automatically shows a **fork badge** in the sync button:

> **↑ 3 fork**

This means you have 3 commits on your local branch that haven't been pushed to your fork yet. The main `ahead/behind` counter still shows your distance from the upstream (the original project), so you always know both things at once.

### 5. Keep your fork up to date

Before starting work, sync with the original:

```bash
git fetch upstream
git rebase upstream/main   # or git merge upstream/main
```

Then push to your fork to keep it current too:

```bash
git push origin main
```

In GitWand, after `git fetch upstream`, the `behind` counter in the header shows how many commits the original project has that you don't. After the rebase, it drops to 0.

### 6. Create a feature branch

Don't work directly on `main`. Create a branch:

```bash
git checkout -b feat/my-contribution
```

Or right-click any commit in GitWand's Log → **Create branch here**. Make your changes, commit them.

### 7. Push to your fork

```bash
git push origin feat/my-contribution
```

The fork badge updates: `↑ N fork` tells you how many commits are waiting to be pushed to your fork. Once you push, the badge disappears.

### 8. Open a Pull Request

Go to GitHub. There's usually a banner prompting you to open a PR from your recently-pushed branch. Fill in the description, point the base branch at the original repository's `main`, and submit.

---

## What GitWand shows that other clients don't

| | GitHub Desktop | GitWand |
|---|---|---|
| Push remote | `origin` (your fork) | `origin` (your fork) |
| Fetch tracking | `origin/main` | `upstream/main` |
| Ahead/behind counter | ahead/behind of your fork | **ahead/behind of the original project** |
| Fork-specific badge | ❌ | ✅ **"↑N fork"** when commits haven't reached the fork yet |

The key difference: in GitHub Desktop, `ahead 3` might mean "3 commits ahead of my own fork" — which isn't useful. In GitWand, `ahead 3` means "3 commits ahead of the upstream project I'm trying to contribute to", and the separate fork badge tells you the push-to-fork status independently.

---

## Commit trailers for open source

Many projects require a **Signed-off-by** trailer on every commit. The Linux kernel, for example, uses the Developer Certificate of Origin (DCO): by signing off, you certify that you have the right to submit the code under the project's license.

In GitWand's commit panel, expand **Certification & revue** to reveal:

- **Certifié par moi** (`Signed-off-by`) — pre-filled with your name and email from `git config`. One checkbox to add it to every commit.
- **Relu par** (`Reviewed-by`) — free text for the reviewer's name.

These are appended as a proper git trailer block after the commit body, matching the format git tools and forges expect.

---

## Setting up triangular workflow in git config

If you always want your branches to track `upstream` but push to `origin`, add this to your global git config:

```ini
[branch]
    autoSetupMerge = always
[push]
    default = current
```

Then when you create a new branch and push it, git automatically pushes to `origin/branch-name` while tracking `upstream/main` for the behind counter. GitWand will pick up the resulting triangular configuration automatically.

---

## In summary

Fork-based contribution is how most open source work gets done, and it's one of the workflows where the gap between a terminal and a good GUI is largest. The combination of an accurate `behind` counter (relative to the real upstream), a fork-specific push badge, and one-click trailer injection makes the full loop — fork, work, certify, push, PR — something you can do without switching to the terminal at all.
