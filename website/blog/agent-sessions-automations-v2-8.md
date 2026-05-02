---
title: "Agent Sessions and scheduled automations: what went into GitWand v2.8.0"
description: "How I built cross-platform AI agent detection using lsof and /proc/cwd, a daemonless automation scheduler in pure TypeScript, and why conflict resolution memory changes the LLM fallback equation."
date: 2026-05-02
head:
  - - meta
    - property: og:title
      content: "Agent Sessions and scheduled automations: what went into GitWand v2.8.0"
  - - meta
    - property: og:description
      content: "How I built cross-platform AI agent detection using lsof and /proc/cwd, a daemonless automation scheduler in pure TypeScript, and why conflict resolution memory changes the LLM fallback equation."
  - - meta
    - name: twitter:title
      content: "Agent Sessions and scheduled automations: what went into GitWand v2.8.0"
---

# Agent Sessions and scheduled automations: what went into GitWand v2.8.0

GitWand v2.8.0 ships two things that started as features on a roadmap and ended up being more interesting to build than I expected: an **Agent Sessions panel** that answers "what is my AI agent actually doing right now?", and a **daemonless automation scheduler** that lets GitWand act on your behalf at the right moment without running anything in the background when you're not using it.

Both sound simple. Neither was.

---

## Part 1 — Agent Sessions

### The problem

When you run Claude Code, Cursor, or Windsurf on a repo, something is happening in your working tree. Files are changing. The AI might have checked out a branch, created a worktree, started a merge. GitWand is right there — it can see the file system, it knows your branches, it has the conflict resolver — but as far as it was concerned, the AI agent was invisible.

The Agent Sessions panel makes the agent visible. At a glance you can see which tool is running, on which worktree, what branch it's on, how many files it's modified, whether it's ahead or behind main. One click opens the worktree in a GitWand tab so you can watch the diff evolve in real time.

### Finding agent processes cross-platform

The first challenge is detecting which processes are Claude Code, Cursor, or Windsurf, and correlating their working directory with a repo worktree.

On macOS and Linux, `lsof` can tell you the current working directory of any process:

```bash
lsof -a -d cwd -c claude -F n
```

The `-a` flag means "AND" (all filters must match), `-d cwd` restricts to file descriptor type `cwd`, `-c claude` filters by command name prefix, and `-F n` outputs in parseable format (field `n` = name). The output looks like:

```
p12345
n/Users/you/projects/myapp
p12346
n/Users/you/projects/other-repo
```

Pairs of `p<pid>` followed by `n<path>`. Parsing this in Rust:

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

On Linux there's a cheaper alternative: `/proc/<pid>/cwd` is a symlink to the process's working directory. You can iterate `/proc/`, filter numeric entries, and `read_link` each `cwd`:

```rust
fn proc_cwds(cmd_prefix: &str) -> Vec<(u32, PathBuf)> {
    let Ok(entries) = std::fs::read_dir("/proc") else { return vec![] };

    entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_string_lossy().parse().ok()?;
            // Check command name from /proc/<pid>/comm
            let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
            if !comm.trim().starts_with(cmd_prefix) { return None; }
            let cwd = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
            Some((pid, cwd))
        })
        .collect()
}
```

The `lsof` path is tried first; if it fails (not installed, or the tool is called with a name that `lsof -c` doesn't match), the Linux `/proc` fallback kicks in. On Windows, the story is more complex — for now, the panel shows a "detection unavailable" state on Windows and falls back to manual entry.

### Correlating working directories with worktrees

Knowing a process's working directory isn't enough. Claude Code might be running in `/Users/you/projects/myapp` while your main repo is also at `/Users/you/projects/myapp` — they match. But if it's in a worktree at `/Users/you/projects/myapp-feature`, you need to correlate that path with the worktree list.

The Tauri command fetches the process CWDs and then calls `git worktree list --porcelain` on each candidate path to see which ones are Git repos with a shared `gitdir`:

```rust
#[tauri::command]
fn agent_session_list(repo_path: String) -> Vec<AgentSession> {
    let tools: &[(&str, &str)] = &[
        ("claude",  "Claude Code"),
        ("cursor",  "Cursor"),
        ("windsurf","Windsurf"),
        ("code",    "VS Code"),  // catches VS Code terminal sessions
    ];

    // Load the current repo's worktrees once
    let worktrees = git_worktree_list(repo_path.clone())
        .unwrap_or_default();

    let mut sessions: Vec<AgentSession> = Vec::new();

    for (cmd, label) in tools {
        let cwds = lsof_cwds(cmd)
            .into_iter()
            .chain(proc_cwds(cmd));  // chain fallback

        for (pid, cwd) in cwds {
            // Does this cwd fall inside a known worktree?
            let matching_wt = worktrees.iter().find(|wt| {
                cwd.starts_with(&wt.path) || PathBuf::from(&wt.path) == cwd
            });

            let Some(wt) = matching_wt else { continue };

            let session = AgentSession {
                pid,
                tool: label.to_string(),
                worktree_path: wt.path.clone(),
                branch: wt.branch.clone(),
                // ahead/behind/modified fetched lazily
                active: true,
                ..Default::default()
            };
            sessions.push(session);
        }
    }

    // Sort: active first
    sessions.sort_by(|a, b| b.active.cmp(&a.active));
    sessions
}
```

The `starts_with` check handles the case where the tool is running in a subdirectory of the worktree — which is the common case when the agent is editing a specific package inside a monorepo.

### The "configured" state

Not every useful session is a live process. GitWand also picks up worktrees that have `.claude/settings.json`, a `.cursor/` directory, or a `.windsurf/` configuration — signs that an agent is configured there even if it's not currently running. These show up as "configured" cards in the panel (grey dot instead of the animated green pulse), so you can launch a session on them directly from GitWand.

Detecting these is simpler — just check for the config file on each worktree path:

```rust
fn detect_configured_agents(wt_path: &str) -> Vec<String> {
    let checks: &[(&str, &str)] = &[
        (".claude/settings.json", "Claude Code"),
        (".cursor/",              "Cursor"),
        (".windsurf/",            "Windsurf"),
    ];
    checks.iter()
        .filter(|(rel, _)| Path::new(wt_path).join(rel).exists())
        .map(|(_, name)| name.to_string())
        .collect()
}
```

### Launching a session from GitWand

The launch button runs `claude .` (or the equivalent for other tools) in the selected worktree path:

```rust
#[tauri::command]
fn agent_session_launch(worktree_path: String, tool: String) -> Result<(), String> {
    let cmd = match tool.as_str() {
        "Claude Code" => "claude",
        "Cursor"      => "cursor",
        "Windsurf"    => "windsurf",
        _             => return Err(format!("Unknown tool: {tool}")),
    };

    std::process::Command::new(cmd)
        .arg(".")
        .current_dir(&worktree_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {cmd}: {e}"))
}
```

`spawn()` instead of `output()` — we don't wait for the process to finish, we just fire and forget. Tauri will keep running; the agent tool opens in a separate process.

---

## Part 2 — The scheduler

### Why no daemon

The automation features I wanted — auto-resolve on conflict, nightly pull + rebase, release notes on tag push — all run at specific moments relative to Git events. The obvious implementation is a background daemon: a small Node.js or Rust process that polls Git state and fires hooks.

I didn't want a daemon. Daemons need to be installed, started, stopped, updated, and debugged. They hold a lock on the repo directory. They consume resources when the app isn't open. They're a whole separate thing to maintain.

Instead, all four automation tasks run inside the Vue app, on a `setInterval` that only fires while the app is open. The trade-off: tasks don't run while the app is closed. For the use cases I care about, that's fine — if you're running a nightly pull at 03:00 and the app is closed, you weren't going to see the result anyway.

### The composable

`useScheduler()` is a pure TypeScript composable. It takes task definitions and returns refs that the Automations panel can bind to:

```typescript
interface ScheduledTask {
  id: string
  label: string
  description: string
  trigger: 'interval' | 'event' | 'schedule'
  intervalMs?: number          // for 'interval' tasks
  scheduleHour?: number        // for 'schedule' tasks (HH:MM)
  scheduleMinute?: number
  enabled: Ref<boolean>
  run: () => Promise<void>
  onLog?: (msg: string) => void
}

export function useScheduler(tasks: ScheduledTask[]) {
  const handles = new Map<string, ReturnType<typeof setInterval>>()

  function startTask(task: ScheduledTask) {
    if (!task.enabled.value) return
    if (task.trigger === 'interval' && task.intervalMs) {
      const h = setInterval(async () => {
        if (!task.enabled.value) return
        if (isOffline.value) return           // global offline guard
        try { await task.run() }
        catch (e) { task.onLog?.(`[${task.id}] error: ${e}`) }
      }, task.intervalMs)
      handles.set(task.id, h)
    }
  }

  function stopTask(id: string) {
    const h = handles.get(id)
    if (h) { clearInterval(h); handles.delete(id) }
  }

  // Restart when enabled toggles
  tasks.forEach(task => {
    watch(task.enabled, (v) => v ? startTask(task) : stopTask(task.id))
    startTask(task)
  })

  // Pause everything when the tab is hidden, resume on visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      tasks.forEach(t => stopTask(t.id))
    } else {
      tasks.forEach(t => startTask(t))
    }
  })

  onUnmounted(() => tasks.forEach(t => stopTask(t.id)))

  return { startTask, stopTask }
}
```

The `visibilitychange` pause is important for battery life — there's no reason to run the conflict-detection poll every 5 seconds while the app is minimized.

### The four tasks

**Auto-resolve on conflict** is the one I use daily. It polls for a `MERGE_HEAD` file every 5 seconds. `MERGE_HEAD` appears when a merge is in progress (i.e., `git merge` ran and produced conflicts). When it appears for the first time (rising edge), the resolver fires automatically:

```typescript
let wasConflicting = false

const autoResolveTask: ScheduledTask = {
  id: 'auto-resolve',
  trigger: 'interval',
  intervalMs: 5_000,
  enabled: settings.value.automations.autoResolve,
  run: async () => {
    const conflicting = await backend.hasMergeHead(repoPath.value)
    if (conflicting && !wasConflicting) {
      const result = await resolveConflicts(repoPath.value)
      onLog(`Auto-resolve: ${result.resolved} resolved, ${result.pending} pending`)
    }
    wasConflicting = conflicting
  }
}
```

The rising-edge detection (`conflicting && !wasConflicting`) means the resolver fires exactly once when a conflict appears, not on every poll tick while you're still in conflict state.

**Nightly pull + rebase** checks the schedule every 60 seconds. "Should I run now?" is answered by comparing the current wall-clock time against the configured `hour:minute` and a `localStorage` last-run timestamp:

```typescript
run: async () => {
  const now = new Date()
  const lastRun = localStorage.getItem('scheduler:nightly-pull:last-run')
  const lastDate = lastRun ? new Date(lastRun) : null

  const isDue = now.getHours() === settings.value.automations.nightlyHour
    && now.getMinutes() === settings.value.automations.nightlyMinute
    && (!lastDate || lastDate.toDateString() !== now.toDateString())

  if (!isDue) return

  localStorage.setItem('scheduler:nightly-pull:last-run', now.toISOString())
  await backend.pullAndRebase(repoPath.value)
  onLog(`Nightly pull+rebase completed at ${now.toLocaleTimeString()}`)
}
```

Using `localStorage` for the last-run timestamp means the guard survives app restarts. If the app was closed when the schedule fired, the task won't run as a "catch-up" on the next open — which is the right behavior for a rebase that might have conflicts.

**Release notes on tag** is triggered externally. After a push that includes `v*` tags, `App.vue` calls `scheduler.triggerReleaseNotesIfEnabled()`. The task generates a CHANGELOG entry using the AI provider configured in Settings:

```typescript
export async function generateReleaseNotes(tag: string, commits: Commit[]): Promise<string> {
  const prompt = buildReleaseNotesPrompt(tag, commits)
  return await callAiProvider(prompt, { maxTokens: 800 })
}
```

The `callAiProvider` function routes to Claude Code CLI, Claude API, or OpenAI-compatible depending on what's configured. If AI is off in Settings, the task's toggle is automatically disabled in the UI.

**AI commit batch** fires on `visibilitychange` (app goes to background) and on `beforeunload`:

```typescript
document.addEventListener('visibilitychange', async () => {
  if (document.hidden && aiCommitBatchEnabled.value) {
    const staged = await backend.getStagedFiles(repoPath.value)
    if (staged.length > 0) {
      // Focus the commit panel — the AI suggestion will be ready when you return
      emit('focusCommitPanel')
    }
  }
})
```

This one is opt-in and AI-dependent. It doesn't generate the message automatically — it just brings the commit panel to focus with a pending AI request, so by the time you switch back to the app, the suggestion is there.

### Conflict resolution memory

One thing I added alongside the scheduler was a simple conflict resolution memory. When the auto-resolver handles a hunk and the user later edits the result, GitWand records the delta: `(file pattern, conflict context hash) → user's correction`. The next time the same pattern appears in the same codebase, the correction is offered as the top candidate.

The memory is stored in `.gitwand/resolution-memory.json` in the repo root (gitignored by default). It's intentionally not a global store — resolution patterns are project-specific, and keeping it in the repo means the whole team benefits if they commit it.

This doesn't change the deterministic classifier's behavior. It's an overlay: if the classifier has a `certain` result, that wins. The memory only activates when the classifier produces `medium` or lower, or when the hunk goes to manual review.

---

## Part 3 — Sidebar UX polish

v2.8 also had a handful of UX fixes that don't fit neatly into either feature above, but were blocking daily use.

The sidebar footer was an afterthought that had grown into a cluster of icon-only buttons with no labels. On a wide screen, you'd eventually memorize them. On a laptop at 1200px, you'd hover to see the tooltip every time. The fix was straightforward: labeled buttons in a flex row with `justify-content: space-around`, pinned to the bottom of the sidebar via `margin-top: auto` on the footer container.

The navigation tabs also got simplified — a round of removed items that didn't belong in the sidebar at all (they're already in the header toolbar) and a visual pass to make the active state unambiguous at a glance.

---

## What's next

v2.9 is in early planning. The two themes I'm most interested in: a **Launchpad** view that builds on the workspace infrastructure from v2.7 to give a proper multi-repo dashboard with CI status and PR queues; and **GitLab MR support**, which is the most-requested feature by a wide margin from teams using self-hosted GitLab.

The conflict resolution memory I mentioned above is also a foundation for something more interesting: if you can record corrections at the hunk level, you can eventually use them to fine-tune the LLM fallback's threshold per-project. A project where the LLM gets it right 95% of the time can run at a lower `minPostMergeScore` than a project where the code patterns are unusual. That's a v2.9 or v3.0 idea, but the data is being collected now.

GitWand v2.8.0 is [available on GitHub](https://github.com/devlint/GitWand/releases/latest). The npm packages (`@gitwand/cli`, `@gitwand/mcp`) are on the registry at `2.8.0`.
