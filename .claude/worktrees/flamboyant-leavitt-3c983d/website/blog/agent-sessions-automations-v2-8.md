---
title: "Hooks, workspaces, agent sessions, and automations: what went into GitWand v2.7 and v2.8"
description: "The technical story behind two releases: a Git hooks manager, multi-repo workspaces with a .gitwand-workspace.json format, worktree quick-create, cross-platform AI agent detection with lsof and /proc/cwd, and a daemonless automation scheduler in pure TypeScript."
date: 2026-05-02
head:
  - - meta
    - property: og:title
      content: "Hooks, workspaces, agent sessions, and automations: what went into GitWand v2.7 and v2.8"
  - - meta
    - property: og:description
      content: "The technical story behind two releases: a Git hooks manager, multi-repo workspaces, worktree quick-create, cross-platform AI agent detection, and a daemonless automation scheduler."
  - - meta
    - name: twitter:title
      content: "Hooks, workspaces, agent sessions, and automations: what went into GitWand v2.7 and v2.8"
---

# Hooks, workspaces, agent sessions, and automations: what went into GitWand v2.7 and v2.8

v2.7 and v2.8 shipped close together and share a common thread: they're both about making GitWand useful for the parts of Git work that happen *around* individual commits — managing hooks, juggling multiple repos at once, watching AI agents run on your branches, and letting the app act on your behalf at the right moment.

This post covers the six main features across both releases and the implementation decisions behind each one.

---

## Part 1 — Git hooks manager (v2.7)

### Why it belongs in the UI

Git hooks are shell scripts in `.git/hooks/`. They're the right place to enforce commit message conventions, run a linter before a push, or block a force-push to main. They're also invisible: you can't see what's installed, you can't toggle one off for a quick workaround without deleting it, and creating a new one means looking up the right filename from the man page.

GitWand's Hooks tab in Settings makes all of this point-and-click, using the three-layer pattern (Rust command → dev-server endpoint → typed TypeScript wrapper) that every backend feature in GitWand follows.

### Listing and parsing hooks

The Rust command reads `.git/hooks/` and classifies each file:

```rust
#[tauri::command]
fn git_hook_list(cwd: String) -> Result<Vec<HookEntry>, String> {
    let hooks_dir = Path::new(&cwd).join(".git").join("hooks");

    let Ok(entries) = std::fs::read_dir(&hooks_dir) else {
        return Ok(vec![]);   // no hooks dir → no hooks, not an error
    };

    let mut hooks: Vec<HookEntry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Skip .sample files shipped by git init
            if name.ends_with(".sample") { return None; }

            let enabled = !name.ends_with(".disabled");
            let hook_name = name.trim_end_matches(".disabled").to_string();

            // Read first 512 bytes for preview
            let preview = std::fs::read_to_string(e.path())
                .unwrap_or_default()
                .lines()
                .take(8)
                .collect::<Vec<_>>()
                .join("\n");

            // Warn if not executable
            #[cfg(unix)]
            let executable = {
                use std::os::unix::fs::PermissionsExt;
                e.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
            };
            #[cfg(not(unix))]
            let executable = true;

            Some(HookEntry { name: hook_name, enabled, preview, executable })
        })
        .collect();

    hooks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(hooks)
}
```

The `.disabled` suffix convention is the same one used by tools like Husky and pre-commit — toggling a hook in GitWand is fully compatible with existing tooling.

### Toggle, create, delete

Toggle renames the file:

```rust
#[tauri::command]
fn git_hook_toggle(cwd: String, name: String, enable: bool) -> Result<(), String> {
    let base = Path::new(&cwd).join(".git").join("hooks");
    let (from, to) = if enable {
        (base.join(format!("{name}.disabled")), base.join(&name))
    } else {
        (base.join(&name), base.join(format!("{name}.disabled")))
    };
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}
```

Create writes the script and makes it executable:

```rust
#[tauri::command]
fn git_hook_create(cwd: String, name: String, script: String) -> Result<(), String> {
    let path = Path::new(&cwd).join(".git").join("hooks").join(&name);

    std::fs::write(&path, script).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

Setting `0o755` on create means the hook will actually fire — a common mistake when creating hooks manually is forgetting the `chmod +x`.

---

## Part 2 — Multi-repo workspaces (v2.7)

### The problem with juggling repos

Most teams I know that work on microservices or monorepos-that-aren't-quite-monorepos end up with five terminal tabs open, each in a different repo, doing `git status` in each one to remember where they left off. GitWand had tabs for single repos but no answer for the multi-repo case.

Workspaces are a `.gitwand-workspace.json` file you drop in a directory. It lists repos by path and display name, and GitWand reads it to show a dashboard with each repo's live status.

### The file format

Simple enough to commit if you want your team to share it:

```json
{
  "version": 1,
  "repos": [
    { "name": "API",      "path": "/Users/you/projects/api" },
    { "name": "Frontend", "path": "/Users/you/projects/frontend" },
    { "name": "Shared",   "path": "/Users/you/projects/shared-libs" }
  ]
}
```

### Fetching status for all repos in parallel

The `workspace_status_all` Rust command maps over the repo list, running three `git` invocations per repo — branch, ahead/behind, modified count:

```rust
#[tauri::command]
fn workspace_status_all(repos: Vec<WorkspaceRepo>) -> Vec<WorkspaceRepoStatus> {
    repos.into_iter().map(|repo| {
        let path = &repo.path;

        let branch = std::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(path)
            .output().ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let (ahead, behind) = std::process::Command::new("git")
            .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
            .current_dir(path)
            .output().ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                let parts: Vec<&str> = s.trim().split_whitespace().collect();
                if parts.len() == 2 {
                    Some((parts[0].parse().unwrap_or(0u32),
                          parts[1].parse().unwrap_or(0u32)))
                } else { None }
            })
            .unwrap_or((0, 0));

        let modified = std::process::Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(path)
            .output().ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0);

        WorkspaceRepoStatus {
            name: repo.name, path: repo.path.clone(),
            branch, ahead, behind, modified,
            error: None,
        }
    }).collect()
}
```

The `@{upstream}` shorthand in `rev-list --left-right` resolves to the tracking branch configured for `HEAD`. If no tracking branch is configured (a new local branch), the command fails and `ahead/behind` defaults to `(0, 0)` — no crash, just no data.

Running these sequentially means three `git` processes per repo. For a workspace with ten repos that's thirty subprocesses. I considered parallelising with `rayon` (Rust's data-parallel iterator library, a one-line change: `.into_par_iter()` instead of `.into_iter()`), but held off — the Tauri IPC call already happens on a thread pool, and spawning git processes in parallel inside an already-concurrent handler caused flaky results in testing on macOS. Sequential is slower but predictable; the UI shows a loading state per-row as results arrive via the IPC response.

### Bulk fetch and pull

`workspace_fetch_all` and `workspace_pull_all` run `git fetch --prune` and `git pull --rebase` on each repo and collect per-repo results. They use the same sequential approach for the same reason:

```rust
#[tauri::command]
fn workspace_fetch_all(repos: Vec<WorkspaceRepo>) -> Vec<WorkspaceOpResult> {
    repos.into_iter().map(|repo| {
        let out = std::process::Command::new("git")
            .args(["fetch", "--prune"])
            .current_dir(&repo.path)
            .output();

        match out {
            Ok(o) if o.status.success() => WorkspaceOpResult {
                name: repo.name, success: true, message: None,
            },
            Ok(o) => WorkspaceOpResult {
                name: repo.name, success: false,
                message: Some(String::from_utf8_lossy(&o.stderr).to_string()),
            },
            Err(e) => WorkspaceOpResult {
                name: repo.name, success: false,
                message: Some(e.to_string()),
            },
        }
    }).collect()
}
```

The UI shows per-repo success/failure icons after the operation completes, so you know exactly which repo had authentication trouble without digging through logs.

---

## Part 3 — Worktree quick-create (v2.7)

Worktrees have been in GitWand since v1.6.3, but the creation flow required opening a modal, typing paths, and clicking through a form. That's fine for infrequent use. For the "start a new task" gesture that happens multiple times a day, it's too much friction.

### ⌘⇧N — one shortcut, one text field

`⌘⇧N` (macOS) now opens the Worktrees panel with the quick-create form pre-focused. You type a task name — `fix-login-bug`, `add-dark-mode`, whatever — and press Enter. GitWand does the rest:

- **Path** is derived automatically as a sibling of the main worktree: if your repo is at `/Users/you/projects/myapp`, the worktree goes to `/Users/you/projects/myapp-fix-login-bug`.
- **Branch** is `task/fix-login-bug` by default, created from `HEAD`.
- The worktree is created, the branch is checked out into it, and a new GitWand tab opens on the worktree path.

The path derivation in TypeScript:

```typescript
function deriveWorktreePath(mainPath: string, taskName: string): string {
  const parent = mainPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/')
  const repoName = mainPath.split('/').at(-1) ?? 'repo'
  const slug = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${parent}/${repoName}-${slug}`
}
```

The slug conversion strips non-alphanumeric characters and collapses separators so `Add dark mode!` becomes `add-dark-mode` without surprises.

### Cross-worktree status pills

The worktree list now shows live status per worktree — ahead, behind, modified, clean — using the same `git rev-list --left-right --count` and `git status --porcelain` approach as the workspace status command:

```rust
#[tauri::command]
fn git_worktree_status_all(main_cwd: String) -> Vec<WorktreeStatus> {
    let worktrees = git_worktree_list(main_cwd).unwrap_or_default();

    worktrees.into_iter().map(|wt| {
        // Run git commands in the worktree's own directory
        let (ahead, behind) = rev_list_count(&wt.path);
        let modified = porcelain_count(&wt.path);
        WorktreeStatus { path: wt.path, ahead, behind, modified }
    }).collect()
}
```

Each worktree is an independent Git working tree — you need to run `git` commands inside that directory to get its status, not from the main repo root. This is a subtle point that burns people who try to script multi-worktree status from the main repo root.

### Cleanup assistant

The cleanup panel lists worktrees that have `ahead = 0` — nothing left to push — and aren't the main worktree or locked. The filter runs on the frontend from the status response:

```typescript
const cleanupCandidates = computed(() =>
  worktreeStatuses.value.filter(wt =>
    !wt.isMain && !wt.isLocked && wt.ahead === 0
  )
)
```

Select one or more, confirm, GitWand calls `git worktree remove <path>` on each. It checks for `ahead > 0` one more time in the Rust command before removing, as a safety net against race conditions if the status has changed since the last refresh.

---

## Part 4 — Agent Sessions (v2.8)

### The problem

When Claude Code, Cursor, or Windsurf is running on a repo, something is happening in your working tree. GitWand is right there — it has the file system, the branches, the conflict resolver — but as far as it was concerned, the AI agent was invisible.

The Agent Sessions panel makes the agent visible. At a glance you see which tool is running, on which worktree, what branch it's on, how many files it's modified. One click opens the worktree in a GitWand tab so you can watch the diff evolve in real time.

### Finding agent processes cross-platform

On macOS and Linux, `lsof` can expose any process's working directory:

```bash
lsof -a -d cwd -c claude -F n
```

`-a` = AND all filters, `-d cwd` = CWD file descriptors only, `-c claude` = processes named `claude`, `-F n` = parseable output (field `n` = name). The output pairs `p<pid>` with `n<path>`:

```
p12345
n/Users/you/projects/myapp
```

Parsing this in Rust:

```rust
fn lsof_cwds(cmd_prefix: &str) -> Vec<(u32, PathBuf)> {
    let out = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-c", cmd_prefix, "-F", "n"])
        .output()
        .unwrap_or_else(|_| return_empty_output());

    let text = String::from_utf8_lossy(&out.stdout);
    let mut pid: Option<u32> = None;
    let mut results = Vec::new();

    for line in text.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().ok();
        } else if let Some(n) = line.strip_prefix('n') {
            if let Some(p) = pid.take() {
                results.push((p, PathBuf::from(n)));
            }
        }
    }
    results
}
```

On Linux there's a cheaper alternative: `/proc/<pid>/cwd` is a symlink to the process's working directory. Iterate `/proc/`, filter numeric entries, `read_link` each `cwd`:

```rust
fn proc_cwds(cmd_prefix: &str) -> Vec<(u32, PathBuf)> {
    let Ok(entries) = std::fs::read_dir("/proc") else { return vec![] };
    entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_string_lossy().parse().ok()?;
            let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
            if !comm.trim().starts_with(cmd_prefix) { return None; }
            let cwd = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
            Some((pid, cwd))
        })
        .collect()
}
```

`lsof` is tried first; the `/proc` fallback activates on Linux if `lsof` isn't installed or doesn't match. On Windows the panel shows a "detection unavailable" state for now.

### Correlating CWDs with worktrees

Knowing a process's CWD isn't enough — the agent might be running in a subdirectory. The command fetches all worktrees for the current repo and checks whether each process CWD is inside one:

```rust
let matching_wt = worktrees.iter().find(|wt| {
    cwd.starts_with(&wt.path) || PathBuf::from(&wt.path) == cwd
});
```

`starts_with` handles the monorepo case where the agent is editing a package inside the worktree directory.

### The "configured" state

Worktrees with a `.claude/settings.json`, `.cursor/`, or `.windsurf/` config directory show up as "configured" cards even when no process is running — they're ready to launch. Detecting them is a simple path existence check on each worktree.

---

## Part 5 — The daemonless scheduler (v2.8)

### Why no daemon

The automation features I wanted — auto-resolve on conflict, nightly pull + rebase, release notes on tag push — all fire at specific moments relative to Git events. The obvious implementation is a background daemon. I didn't want one. Daemons need installing, starting, stopping, updating, and debugging. They hold a lock on the repo. They consume resources when the app is closed.

All four tasks run inside the Vue app, on a `setInterval` that fires only while the app is open. The trade-off: tasks don't run with the app closed. For every use case here, that's acceptable.

### The composable

`useScheduler()` accepts task definitions and returns refs the Automations panel can bind to:

```typescript
interface ScheduledTask {
  id: string
  trigger: 'interval' | 'schedule' | 'event'
  intervalMs?: number
  scheduleHour?: number
  scheduleMinute?: number
  enabled: Ref<boolean>
  run: () => Promise<void>
  onLog?: (msg: string) => void
}

export function useScheduler(tasks: ScheduledTask[]) {
  const handles = new Map<string, ReturnType<typeof setInterval>>()

  function startTask(task: ScheduledTask) {
    if (!task.enabled.value || task.trigger !== 'interval') return
    const h = setInterval(async () => {
      if (!task.enabled.value || isOffline.value) return
      try { await task.run() }
      catch (e) { task.onLog?.(`[${task.id}] error: ${e}`) }
    }, task.intervalMs!)
    handles.set(task.id, h)
  }

  tasks.forEach(task => {
    watch(task.enabled, v => v ? startTask(task) : stopTask(task.id))
    startTask(task)
  })

  // Pause when hidden, resume on focus — battery friendly
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) tasks.forEach(t => stopTask(t.id))
    else tasks.forEach(t => startTask(t))
  })

  onUnmounted(() => tasks.forEach(t => stopTask(t.id)))
}
```

### The four tasks

**Auto-resolve on conflict** polls for `MERGE_HEAD` every 5 seconds. The rising-edge detection (`conflicting && !wasConflicting`) means the resolver fires exactly once when a conflict appears, not on every tick while you're still in conflict state.

**Nightly pull + rebase** checks every 60 seconds whether it's the configured `hour:minute` and whether it has already run today. The "run once per day" guard uses a `localStorage` timestamp that survives app restarts:

```typescript
const lastRun = localStorage.getItem('scheduler:nightly-pull:last-run')
const isDue = now.getHours() === settings.automations.nightlyHour
  && now.getMinutes() === settings.automations.nightlyMinute
  && (!lastRun || new Date(lastRun).toDateString() !== now.toDateString())
```

**Release notes on tag** is triggered externally: `App.vue` calls `scheduler.triggerReleaseNotesIfEnabled()` after a push that includes `v*` tags.

**AI commit batch** fires on `visibilitychange` (app goes to background): if there are staged files, it focuses the commit panel so the AI suggestion is ready when you return. It doesn't generate the message automatically — it queues the work so the round-trip to the LLM happens while you're not watching.

### Conflict resolution memory

Alongside the scheduler I added a resolution memory. When the auto-resolver handles a hunk and the user later edits the result, GitWand records the delta: `(file pattern, conflict context hash) → user's correction`. The next time the same pattern appears, the correction is offered as the top candidate.

The memory lives in `.gitwand/resolution-memory.json` in the repo root (gitignored by default). It's project-local by design — resolution patterns are codebase-specific, and committing the file means the whole team benefits.

The memory only activates when the classifier produces `medium` confidence or lower. A `certain` result from the deterministic classifier always wins.

---

## Part 6 — Sidebar UX polish (v2.8)

The sidebar footer had grown into a row of icon-only buttons with no labels. On a wide screen you eventually memorize them; on a laptop at 1200px you hover for the tooltip every time. The fix: labeled buttons in a flex row with `justify-content: space-around`, pinned to the bottom with `margin-top: auto` on the footer container. The navigation tabs also got a pass to remove items that already live in the header toolbar.

---

## What's next

v2.9 is early planning. Two themes: a **Launchpad** view building on the v2.7 workspace infrastructure to add CI status and PR queues per repo; and **GitLab MR support**, the most-requested feature by far from teams on self-hosted GitLab.

The resolution memory from v2.8 is also the foundation for something longer-term: if you record corrections at the hunk level, you can eventually use them to tune the LLM fallback threshold per-project — a repo where the model gets it right 95% of the time can run at a lower `minPostMergeScore` than one with unusual code patterns. That's v3.0 territory, but the data is being collected now.

GitWand v2.8.0 is [available on GitHub](https://github.com/devlint/GitWand/releases/latest). The npm packages (`@gitwand/cli`, `@gitwand/mcp`) are on the registry at `2.8.0`.
