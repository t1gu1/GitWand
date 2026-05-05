---
title: "Worktrees, submodules, and a broken auto-updater: what went into GitWand v1.6.3"
description: "How I added Git worktree and submodule management to a Tauri desktop app, and fixed four silent bugs that were keeping auto-update from ever working."
date: 2026-04-20
---

# Worktrees, submodules, and a broken auto-updater: what went into GitWand v1.6.3

GitWand v1.6.3 shipped three things at once: a Git worktrees panel, a submodules panel, and a working auto-updater. The first two are features. The third one was supposed to already work.

This article is about how all three were built, and why fixing the updater turned out to involve four independent bugs that were collectively conspiring to fail silently.

---

## Part 1 — Worktrees

### The feature in one sentence

A Git worktree lets you check out a second branch into a separate directory, without touching your current working tree. You can have `main` open in one folder and `feature/billing` open in another, both from the same repository, both editable simultaneously.

Most Git clients ignore this entirely. GitWand's tab model made it trivially cheap to support.

### Why tabs made this nearly free

GitWand organizes work around **tabs**, where each tab is just a directory path. When you open a repo at `/Users/you/projects/myapp`, the entire UI — commit history, staged files, branch list, diff viewer — is scoped to that path. Switching tabs switches paths.

A Git worktree is exactly that: a path. When you run `git worktree add ../myapp-billing billing`, Git creates a new directory at `../myapp-billing` with `billing` checked out. Opening that worktree as a tab in GitWand requires zero new infrastructure — you just call the existing `openTab(path)` function.

The UI work was all in the management layer: listing, creating, and removing worktrees.

### Parsing `git worktree list --porcelain`

The Rust backend calls `git worktree list --porcelain` and parses the output into typed structs:

```rust
#[derive(serde::Serialize, Clone)]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_main: bool,
    pub is_locked: bool,
    pub is_bare: bool,
}
```

The porcelain format is one block per worktree, separated by blank lines:

```
worktree /Users/you/projects/myapp
HEAD abc1234def5678...
branch refs/heads/main

worktree /Users/you/projects/myapp-billing
HEAD 789fed654cba...
branch refs/heads/billing
```

Parsing it is straightforward — iterate lines, match prefixes, flush each block when you hit a blank line:

```rust
#[tauri::command]
pub fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let out = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut current = WorktreeEntry::default();

    for line in stdout.lines() {
        if line.is_empty() {
            if !current.path.is_empty() {
                entries.push(current.clone());
                current = WorktreeEntry::default();
            }
        } else if let Some(p) = line.strip_prefix("worktree ") {
            current.path = p.to_string();
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            current.head = h.to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            current.branch = b.trim_start_matches("refs/heads/").to_string();
        } else if line == "bare" {
            current.is_bare = true;
        } else if line == "locked" {
            current.is_locked = true;
        }
    }
    if !current.path.is_empty() {
        entries.push(current);
    }

    // Mark the first entry as main (git always lists main worktree first)
    if let Some(first) = entries.first_mut() {
        first.is_main = true;
    }

    Ok(entries)
}
```

### Creating worktrees with a conditional branch flag

`git worktree add` takes two forms: checkout an existing branch, or create a new one with `-b`:

```bash
git worktree add /path/to/dir existing-branch
git worktree add /path/to/dir -b new-branch base-branch
```

The Rust implementation uses a `cmd.arg()` chain instead of building a `Vec<&str>`, because building a vector of string references with conditional elements creates lifetime problems when the owned `String` you're borrowing from might be dropped:

```rust
#[tauri::command]
pub fn git_worktree_add(
    cwd: String,
    path: String,
    branch: String,
    new_branch: Option<String>,
) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(&cwd).arg("worktree").arg("add").arg(&path);

    if let Some(ref nb) = new_branch {
        cmd.arg("-b").arg(nb).arg(&branch);
    } else {
        cmd.arg(&branch);
    }

    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}
```

The `cmd.arg()` chain avoids the lifetime issue entirely because each call takes `&self` and returns `&mut Command` — the arguments are owned by the `Command`, not by the surrounding scope.

### The per-branch shortcut in the branch popover

The most useful entry point isn't the Worktrees panel header — it's a small button next to each branch in the branch list. You hover over `feature/billing`, click the ⧉ icon, and the Worktrees panel opens with that branch pre-selected in the creation form.

In `AppHeader.vue`, each branch row gets an extra button:

```vue
<button
  class="btn btn-xs btn-icon worktree-btn"
  :title="t('worktree.openInWorktreeTabTooltip')"
  @click.stop="emit('openWorktrees', branch.name); closeBranchPopover();"
>
  ⧉
</button>
```

The `@click.stop` is important — without it, the click propagates to the branch row and switches branches, which is not what you want.

In `App.vue`, the event handler stores the suggested branch and opens the panel:

```typescript
function onOpenWorktrees(branch?: string) {
  pendingWorktreeBranch.value = branch;
  showWorktrees.value = true;
}
```

`WorktreeManager` receives `suggestedBranch` as a prop and, on mount, pre-fills the form and opens it:

```typescript
onMounted(() => {
  loadWorktrees();
  if (props.suggestedBranch) {
    formBranch.value = props.suggestedBranch;
    showForm.value = true;
  }
});
```

The prop is cleared when the panel closes, so re-opening the panel without a suggestion starts with a blank form.

---

## Part 2 — Submodules

### The data sources

Submodule management reads from two places: `.gitmodules` for static configuration, and `git submodule status` for live state.

`.gitmodules` is a Git config file:

```ini
[submodule "libs/protobuf"]
    path = libs/protobuf
    url = https://github.com/protocolbuffers/protobuf.git
    branch = main
```

Parsing it with `git config --file .gitmodules --list` gives flat key=value output:

```
submodule.libs/protobuf.path=libs/protobuf
submodule.libs/protobuf.url=https://github.com/protocolbuffers/protobuf.git
submodule.libs/protobuf.branch=main
```

`git submodule status` gives live state per submodule:

```
 abc1234 libs/protobuf (v3.21.0)        ← clean, space prefix
-def5678 libs/other                     ← uninitialized, dash prefix
+ghi9012 libs/modified (v1.0.0-1-g...)  ← modified, plus prefix
```

The prefix character is the status: space = clean, `-` = uninitialized, `+` = modified/out of sync.

The Rust command merges both:

```rust
#[tauri::command]
pub fn git_submodule_list(cwd: String) -> Result<Vec<SubmoduleEntry>, String> {
    // 1. Parse .gitmodules for URL and branch
    let cfg_out = Command::new("git")
        .args(["config", "--file", ".gitmodules", "--list"])
        .current_dir(&cwd)
        .output();

    let mut map: std::collections::HashMap<String, SubmoduleEntry> = HashMap::new();

    if let Ok(cfg) = cfg_out {
        for line in String::from_utf8_lossy(&cfg.stdout).lines() {
            if let Some((key, val)) = line.split_once('=') {
                // key format: submodule.<name>.<field>
                let parts: Vec<&str> = key.splitn(3, '.').collect();
                if parts.len() == 3 {
                    let name = parts[1];
                    let field = parts[2];
                    let entry = map.entry(name.to_string()).or_default();
                    match field {
                        "path" => entry.path = val.to_string(),
                        "url"  => entry.url  = val.to_string(),
                        "branch" => entry.branch = Some(val.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

    // 2. Overlay live status from `git submodule status`
    let status_out = Command::new("git")
        .args(["submodule", "status"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    for line in String::from_utf8_lossy(&status_out.stdout).lines() {
        if line.len() < 42 { continue; }
        let prefix = &line[..1];
        let sha    = &line[1..41];
        let rest   = line[42..].split_whitespace().next().unwrap_or("").to_string();

        let status = match prefix {
            "-" => "uninitialized",
            "+" => "modified",
            _   => "clean",
        };

        if let Some(entry) = map.values_mut().find(|e| e.path == rest) {
            entry.sha    = sha.to_string();
            entry.status = status.to_string();
        }
    }

    Ok(map.into_values().collect())
}
```

### The uninitialized warning

When a repository has submodules that haven't been initialized yet — a common state after a fresh clone without `--recursive` — the panel shows a clickable warning banner:

```vue
<div
  v-if="uninitializedCount > 0"
  class="sm-warning"
  @click="initUpdateAll"
>
  {{ t('submodule.warningUninitialized', { count: uninitializedCount }) }}
</div>
```

`uninitializedCount` is a computed property:

```typescript
const uninitializedCount = computed(
  () => submodules.value.filter(s => s.status === 'uninitialized').length
);
```

Clicking the banner calls `git submodule update --init --recursive`, which initializes and populates all uninitialized submodules in one shot.

---

## Part 3 — The broken auto-updater

This is the part I should have caught earlier.

GitWand ships with `tauri-plugin-updater`, which is supposed to check for new releases on startup and prompt the user to install them. The code looked correct. The CI pipeline had a workflow. Users were never getting update prompts. Nobody noticed because there were no error messages — the entire update flow was wrapped in an empty `catch {}`.

When I finally unwrapped it, I found four separate problems.

### Bug 1: missing artifact creation

Tauri's updater requires signed archives (`.tar.gz` for macOS/Linux, `.zip` for Windows) alongside a `latest.json` manifest containing their signatures. This is configured with `createUpdaterArtifacts` in `tauri.conf.json`:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

This key was missing. Tauri was building the app, but not creating the artifacts the updater needs to download.

### Bug 2: wrong endpoint format

The endpoint was set to a dynamic URL template:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://devlint.github.io/GitWand/update/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

That format works with CrabNebula Cloud, which runs a server that does version comparison and returns the right artifact per-target. GitWand uses GitHub Pages — a static file host. There's no server doing version logic. The URL would 404 for every request because the files don't exist at that path structure.

The correct approach for a static host is a single `latest.json` at a fixed URL. Tauri fetches it, compares its `version` field against the running app's version, and handles the comparison client-side:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://devlint.github.io/GitWand/update/latest.json"
      ]
    }
  }
}
```

### Bug 3: missing capability permissions

Tauri v2 uses a capability system where each plugin's APIs must be explicitly declared before they can be called. Three permissions were missing from `capabilities/default.json`:

```json
{
  "permissions": [
    "updater:default",
    "process:default",
    "process:allow-restart"
  ]
}
```

Without `updater:default`, the check call fails. Without `process:allow-restart`, the app can't restart to apply the update even if the download succeeds.

### Bug 4: the release workflow published empty signatures

The GitHub Actions release workflow was generating a `latest.json` manifest by hand:

```yaml
- name: Create update manifest
  run: |
    cat > update.json << EOF
    {
      "version": "${{ github.ref_name }}",
      "platforms": {
        "darwin-aarch64": { "signature": "", "url": "..." },
        "darwin-x86_64":  { "signature": "", "url": "..." }
      }
    }
    EOF
```

Empty strings for signatures. Tauri's updater verifies signatures before installing — if the signature field is empty, the verification fails and the update is rejected.

The actual signatures are generated by `tauri-action` during the build and embedded in a `latest.json` artifact that gets attached to the GitHub release. The fix was to download that file and publish it to GitHub Pages, instead of generating a fake one:

```yaml
- name: Download update manifest from release
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    gh release download ${{ github.ref_name }} \
      --pattern "latest.json" \
      --output update.json \
      --repo ${{ github.repository }}
    mkdir -p website/public/update
    cp update.json website/public/update/latest.json
```

### Why all four had to be fixed together

None of the four bugs would have been visible in isolation, because each one caused the flow to fail before it could reach the next step:

1. No artifacts → nothing to download, update check returns "no update"
2. Wrong endpoint → 404 before the manifest is even read
3. Missing permissions → API call throws before reaching the endpoint
4. Empty signatures → update rejected after download, but never reached because of 1-3

And all of them were silently swallowed by the empty `catch {}`. The fix was to fix all four root causes rather than just making the error visible.

---

## Wrapping up

The worktrees and submodules features were genuinely straightforward — the hardest part of the worktrees implementation was the Rust lifetime issue with the `Vec<&str>` approach, which a `cmd.arg()` chain solved cleanly. The submodule status parsing was a matter of reading the right man pages.

The auto-updater was the opposite: the code looked fine, the configuration was plausible, and every individual bug was subtle. The lesson is that silent failure in infrastructure code is worth a dedicated debugging pass before shipping — not just checking that the code compiles, but verifying that the actual mechanism works end to end.

v1.6.3 is [available on GitHub](https://github.com/devlint/GitWand/releases/latest). The MCP package and CLI are on npm as `@gitwand/mcp` and `@gitwand/cli`.
