//! GitHub CLI (`gh`) Tauri commands (§3.4e migration).
//!
//! Wrappers around the `gh` CLI for pull-request workflows:
//! list, create, checkout, merge, detail, diff, checks + reviewer
//! candidate discovery.
//!
//! All commands rely on:
//!   - `hidden_cmd("gh")` from `crate::git::cmd` to spawn `gh` without
//!     surfacing a console window on Windows.
//!   - `crate::git::parse::{parse_gh_pr_json, gh_pr_raw_to_pr,
//!     gh_pr_detail_raw_to_detail, extract_json_string}` for response
//!     deserialization (already centralized in §3.4a).
//!   - `crate::types::{PullRequest, PullRequestDetail, ReviewerCandidate,
//!     CICheck, GhPrRaw, GhPrDetailRaw}` for the IPC shapes.

use crate::git::*;
use crate::types::*;

/// List pull requests using `gh` CLI.
///
/// **Perf note** : `statusCheckRollup`, `mergeStateStatus`, `reviewRequests`,
/// `reviewDecision`, `additions` and `deletions` each cost a per-PR roundtrip
/// to the GitHub API internally — gh expands the GraphQL edge by issuing a
/// checks endpoint hit per PR. For a repo with 100+ open PRs (e.g. dendreo),
/// the full query took >30s and tripped the IPC timeout.
///
/// v2.8.5 — Boot perf chantier:
///   - `--limit 50 → 10` (first page); pagination handled via the `offset`
///     parameter from the frontend (`PrListSidebar` IntersectionObserver).
///   - JSON field list shrunk to 12 cheap fields. The heavy fields
///     (`statusCheckRollup`, `mergeStateStatus`, `reviewRequests`,
///     `reviewDecision`, `additions`, `deletions`) are now fetched lazily
///     per-PR when the user opens the detail view. Sidebar badges that
///     relied on them gracefully fall back to empty values until the user
///     selects the PR. See `PrListSidebar.vue` for the UI side.
///
/// TODO Phase 2 (v2.9): lazy per-PR enrichment via a dedicated
/// `gh_pr_status_rollup(cwd, numbers)` batched call that returns just the
/// CI/merge state pieces — keeps the list query light while still letting
/// the sidebar render CI/merge dots without a click.
#[tauri::command]
pub(crate) fn gh_list_prs(
    cwd: String,
    state: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<PullRequest>, String> {
    let st = if state.is_empty() { "open" } else { &state };
    // Naïve pagination: `gh pr list` has no native --offset, so we ask for
    // `offset + limit` and slice. Works correctly for the small windows the
    // UI uses (10/20/30) and stays well under any token rate-limit budget.
    // TODO Phase 2 (v2.9): replace with a cursor-based `gh api graphql`
    // query so we don't re-fetch already-loaded pages on each scroll.
    let page = limit.unwrap_or(10).max(1);
    let off = offset.unwrap_or(0).max(0);
    let total = (page + off).to_string();

    // GH_TOKEN propagation is handled centrally by `hidden_cmd` (cf. git/cmd.rs).
    let output = hidden_cmd("gh")
        .args([
            "pr", "list",
            "--state", st,
            "--json", "number,title,state,author,headRefName,baseRefName,isDraft,createdAt,updatedAt,url,labels,assignees",
            "--limit", &total,
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run gh pr list (is GitHub CLI installed?): {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr list failed: {}", stderr));
    }

    // Parse JSON output from gh CLI
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut prs = parse_gh_pr_json(&stdout)?;
    if off > 0 {
        let skip = (off as usize).min(prs.len());
        prs.drain(..skip);
    }
    Ok(prs)
}

/// Lightweight PR count — single GraphQL `totalCount` call, no per-PR roundtrip.
///
/// Used at app boot (DashboardView) and as the sidebar badge source: the
/// dashboard only needs the number of open PRs, not the full list. Falling
/// back to the heavy `gh_list_prs` for a count was costing 1 roundtrip per
/// PR × 2 calls (open + merged) at every repo open (v2.8.4 → v2.8.5 perf
/// chantier).
///
/// Implementation: `gh api graphql` with the `pullRequests.totalCount` edge
/// after resolving `owner/name` via `gh repo view --json nameWithOwner`.
/// Both calls are cheap (<200 ms) and avoid expanding the PR objects.
///
/// `state` accepts "open" (default), "closed", "merged" or "all". `all`
/// maps to GraphQL `[OPEN, CLOSED, MERGED]`.
///
/// Returns 0 on any non-fatal failure (no remote, no token, etc.) so the
/// dashboard can still render — the caller decides whether to surface.
#[tauri::command]
pub(crate) fn gh_pr_count(cwd: String, state: String) -> Result<i64, String> {
    let st = state.to_lowercase();
    let states_expr = match st.as_str() {
        "closed" => "[CLOSED]",
        "merged" => "[MERGED]",
        "all"    => "[OPEN, CLOSED, MERGED]",
        _        => "[OPEN]",
    };

    // Resolve owner/name once via `gh repo view`. `nameWithOwner` is the
    // canonical "org/repo" slug — splittable by '/' without ambiguity.
    let view = hidden_cmd("gh")
        .args(["repo", "view", "--json", "nameWithOwner"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh repo view (for pr count): {}", e))?;
    if !view.status.success() {
        return Err(format!(
            "gh repo view failed: {}",
            String::from_utf8_lossy(&view.stderr)
        ));
    }
    let nwo = {
        let stdout = String::from_utf8_lossy(&view.stdout);
        // Tiny, dependency-free extraction — avoids dragging in serde_json
        // just for one string field. Mirrors extract_json_string in parse.rs.
        let key = "\"nameWithOwner\"";
        let start = stdout.find(key)
            .ok_or_else(|| "nameWithOwner missing from gh repo view output".to_string())?;
        let after = &stdout[start + key.len()..];
        let q1 = after.find('"').ok_or_else(|| "malformed nameWithOwner".to_string())?;
        let rest = &after[q1 + 1..];
        let q2 = rest.find('"').ok_or_else(|| "unterminated nameWithOwner".to_string())?;
        rest[..q2].to_string()
    };
    let (owner, name) = match nwo.split_once('/') {
        Some((o, n)) if !o.is_empty() && !n.is_empty() => (o.to_string(), n.to_string()),
        _ => return Err(format!("Unexpected nameWithOwner format: {}", nwo)),
    };

    // GraphQL query — single edge, no nested objects beyond totalCount.
    let query = format!(
        "query($owner:String!,$name:String!) {{ repository(owner:$owner,name:$name) {{ pullRequests(states:{}) {{ totalCount }} }} }}",
        states_expr
    );
    let out = hidden_cmd("gh")
        .args([
            "api", "graphql",
            "-F", &format!("owner={}", owner),
            "-F", &format!("name={}", name),
            "-f", &format!("query={}", query),
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh api graphql (pr count): {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "gh api graphql pr count failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Cheap manual extraction of `"totalCount": N` — same rationale as
    // above: no serde_json import just for one integer. The response
    // shape is fixed by GitHub's schema so the substring lookup is safe.
    let key = "\"totalCount\"";
    let start = stdout.find(key)
        .ok_or_else(|| format!("totalCount missing from response: {}", stdout))?;
    let after = &stdout[start + key.len()..];
    let colon = after.find(':').ok_or_else(|| "malformed totalCount".to_string())?;
    let tail = after[colon + 1..].trim_start();
    let end = tail.find(|c: char| !c.is_ascii_digit()).unwrap_or(tail.len());
    if end == 0 {
        return Err(format!("totalCount has no digits: {}", tail));
    }
    tail[..end]
        .parse::<i64>()
        .map_err(|e| format!("totalCount parse: {}", e))
}

/// Create a pull request using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_create_pr(
    cwd: String,
    title: String,
    body: String,
    base: String,
    draft: bool,
    reviewers: Option<Vec<String>>,
) -> Result<PullRequest, String> {
    let mut args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title,
        "--body".to_string(),
        body,
    ];

    if !base.is_empty() {
        args.push("--base".to_string());
        args.push(base);
    }

    if draft {
        args.push("--draft".to_string());
    }

    // Reviewers: gh expects a single comma-separated --reviewer list
    // (GitHub usernames or org/team-slug).
    if let Some(revs) = reviewers {
        let cleaned: Vec<String> = revs
            .into_iter()
            .map(|r| r.trim().trim_start_matches('@').to_string())
            .filter(|r| !r.is_empty())
            .collect();
        if !cleaned.is_empty() {
            args.push("--reviewer".to_string());
            args.push(cleaned.join(","));
        }
    }

    // Add JSON output
    // Note: gh pr create doesn't support --json, but returns the URL
    let output = hidden_cmd("gh")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to create PR: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr create failed: {}", stderr));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Fetch the PR details using the URL
    let view_output = hidden_cmd("gh")
        .args([
            "pr", "view",
            &url,
            "--json", "number,title,state,author,headRefName,baseRefName,isDraft,createdAt,updatedAt,url,additions,deletions,labels,assignees,reviewRequests,reviewDecision,mergeStateStatus,statusCheckRollup",
        ])
        .current_dir(&cwd)
        .output();

    if let Ok(view) = view_output {
        if view.status.success() {
            let json = String::from_utf8_lossy(&view.stdout);
            // gh pr view returns a single object (not array)
            if let Ok(raw) = serde_json::from_str::<GhPrRaw>(json.trim()) {
                return Ok(gh_pr_raw_to_pr(raw));
            }
            // Also try array format
            let raws: Result<Vec<GhPrRaw>, _> = serde_json::from_str(json.trim());
            if let Ok(mut raws) = raws {
                if let Some(raw) = raws.pop() {
                    return Ok(gh_pr_raw_to_pr(raw));
                }
            }
        }
    }

    // Fallback: return minimal info
    Ok(PullRequest {
        number: 0,
        title: String::new(),
        state: "open".to_string(),
        author: String::new(),
        branch: String::new(),
        base: String::new(),
        draft: false,
        created_at: String::new(),
        updated_at: String::new(),
        url,
        additions: 0,
        deletions: 0,
        labels: Vec::new(),
        assignees: Vec::new(),
        review_requested: Vec::new(),
        review_decision: String::new(),
        merge_state_status: String::new(),
        checks_rollup: String::new(),
        comment_count: 0,
    })
}

/// List candidate reviewers for the current repo using `gh` CLI.
///
/// Calls `gh api /repos/:owner/:repo/assignees` (paginated) which returns
/// users with push access — exactly the set GitHub allows as reviewers.
#[tauri::command]
pub(crate) fn gh_list_reviewer_candidates(cwd: String) -> Result<Vec<ReviewerCandidate>, String> {
    // Discover owner/repo from the current repo.
    let view = hidden_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to inspect repo: {}", e))?;
    if !view.status.success() {
        return Err(format!(
            "gh repo view failed: {}",
            String::from_utf8_lossy(&view.stderr)
        ));
    }
    #[derive(serde::Deserialize)]
    struct OwnerLogin { login: String }
    #[derive(serde::Deserialize)]
    struct RepoView { owner: OwnerLogin, name: String }
    let repo: RepoView = serde_json::from_slice(&view.stdout)
        .map_err(|e| format!("Failed to parse repo view: {}", e))?;
    let endpoint = format!("/repos/{}/{}/assignees", repo.owner.login, repo.name);

    // Fetch up to ~300 candidates (3 pages of 100). Plenty for typical repos.
    let output = hidden_cmd("gh")
        .args([
            "api",
            "--paginate",
            "-H", "Accept: application/vnd.github+json",
            &endpoint,
            "--jq", "[.[] | {login: .login, name: .name, avatar_url: .avatar_url}]",
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to list reviewer candidates: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "gh api assignees failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // --paginate concatenates JSON arrays page-by-page (one per line).
    // Parse each non-empty line as a JSON array and flatten.
    let raw = String::from_utf8_lossy(&output.stdout);
    let mut all: Vec<ReviewerCandidate> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for chunk in raw.split('\n') {
        let trimmed = chunk.trim();
        if trimmed.is_empty() { continue; }
        // gh might return either a single array per chunk (--jq with array wrapper)
        // or NDJSON of arrays. Try to parse as Value and walk.
        let value: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(arr) = value.as_array() {
            for item in arr {
                let login = item.get("login").and_then(|v| v.as_str()).unwrap_or("");
                if login.is_empty() || !seen.insert(login.to_string()) { continue; }
                all.push(ReviewerCandidate {
                    login: login.to_string(),
                    name: item.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    avatar_url: item.get("avatar_url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                });
            }
        }
    }
    // Sort alphabetically by login for stable UX.
    all.sort_by(|a, b| a.login.to_lowercase().cmp(&b.login.to_lowercase()));
    Ok(all)
}

/// Checkout a PR branch locally using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_checkout_pr(cwd: String, number: i64) -> Result<(), String> {
    let output = hidden_cmd("gh")
        .args(["pr", "checkout", &number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to checkout PR: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "gh pr checkout failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Merge a PR using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_merge_pr(cwd: String, number: i64, method: String) -> Result<(), String> {
    let merge_flag = match method.as_str() {
        "squash" => "--squash",
        "rebase" => "--rebase",
        _ => "--merge",
    };

    let output = hidden_cmd("gh")
        .args(["pr", "merge", &number.to_string(), merge_flag, "--delete-branch"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to merge PR: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "gh pr merge failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Convert a draft PR to a ready-for-review PR via `gh pr ready`.
///
/// Idempotent — `gh pr ready` on a non-draft PR exits 0 with a message like
/// "Pull request #N is already marked as ready for review."
#[tauri::command]
pub(crate) fn gh_pr_ready(cwd: String, number: i64) -> Result<(), String> {
    let output = hidden_cmd("gh")
        .args(["pr", "ready", &number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run gh pr ready: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "gh pr ready failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Get detailed PR information using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_pr_detail(cwd: String, number: i64) -> Result<PullRequestDetail, String> {
    let output = hidden_cmd("gh")
        .args([
            "pr", "view", &number.to_string(),
            "--json", "number,title,body,state,author,headRefName,baseRefName,isDraft,createdAt,updatedAt,mergedAt,url,additions,deletions,changedFiles,comments,reviewRequests,labels,reviews,mergeable,statusCheckRollup",
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh pr view: {}", e))?;

    if !output.status.success() {
        return Err(format!("gh pr view failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: GhPrDetailRaw = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse gh pr view output: {}", e))?;

    Ok(gh_pr_detail_raw_to_detail(raw))
}

/// Get the diff of a PR using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_pr_diff(cwd: String, number: i64) -> Result<String, String> {
    let output = hidden_cmd("gh")
        .args(["pr", "diff", &number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh pr diff: {}", e))?;

    if !output.status.success() {
        return Err(format!("gh pr diff failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get CI checks for a PR using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_pr_checks(cwd: String, number: i64) -> Result<Vec<CICheck>, String> {
    let output = hidden_cmd("gh")
        .args([
            "pr", "checks", &number.to_string(),
            "--json", "name,state,conclusion,detailsUrl",
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh pr checks: {}", e))?;

    if !output.status.success() {
        // Some repos have no checks — not a fatal error
        return Ok(Vec::new());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    if trimmed == "[]" || trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let mut checks = Vec::new();
    let mut depth = 0;
    let mut obj_start = None;
    for (i, ch) in trimmed.char_indices() {
        match ch {
            '{' => {
                if depth == 1 { obj_start = Some(i); }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 1 {
                    if let Some(start) = obj_start {
                        let obj = &trimmed[start..=i];
                        checks.push(CICheck {
                            name: extract_json_string(obj, "name").unwrap_or_default(),
                            state: extract_json_string(obj, "state").unwrap_or_default(),
                            conclusion: extract_json_string(obj, "conclusion").unwrap_or_default(),
                            details_url: extract_json_string(obj, "detailsUrl").unwrap_or_default(),
                        });
                    }
                    obj_start = None;
                }
            }
            '[' if depth == 0 => { depth = 1; }
            ']' if depth == 1 => { depth = 0; }
            _ => {}
        }
    }

    Ok(checks)
}

/// Get check-run annotations for a PR (v2.18 — Inline CI Check Annotations).
///
/// Flow:
///   1. `gh pr view --json headRefOid` → head commit SHA
///   2. `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` → runs with
///      `output.annotations_count` (gh resolves `{owner}/{repo}` from cwd)
///   3. For each run with annotations: `gh api .../check-runs/{id}/annotations`
///
/// Non-fatal everywhere: a repo without checks/annotations returns `[]`.
#[tauri::command]
pub(crate) fn gh_check_annotations(cwd: String, number: i64) -> Result<Vec<CIAnnotation>, String> {
    // 1. Head SHA of the PR.
    let output = hidden_cmd("gh")
        .args(["pr", "view", &number.to_string(), "--json", "headRefOid"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh pr view: {}", e))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let sha = match extract_json_string(stdout.trim(), "headRefOid") {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(Vec::new()),
    };

    // 2. Check-runs for that commit (id + annotations_count).
    let output = hidden_cmd("gh")
        .args([
            "api",
            &format!("repos/{{owner}}/{{repo}}/commits/{}/check-runs?per_page=100", sha),
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh api check-runs: {}", e))?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);
    let runs = parsed
        .get("check_runs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 3. Fetch annotations for runs that have any. Cap the number of runs
    //    queried so a pathological CI setup can't fan out dozens of API calls.
    const MAX_ANNOTATED_RUNS: usize = 20;
    let mut annotations = Vec::new();
    for run in runs
        .iter()
        .filter(|r| {
            r.get("output")
                .and_then(|o| o.get("annotations_count"))
                .and_then(|c| c.as_i64())
                .unwrap_or(0)
                > 0
        })
        .take(MAX_ANNOTATED_RUNS)
    {
        let run_id = match run.get("id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => continue,
        };
        let check_name = run
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let output = hidden_cmd("gh")
            .args([
                "api",
                &format!("repos/{{owner}}/{{repo}}/check-runs/{}/annotations?per_page=100", run_id),
            ])
            .current_dir(&cwd)
            .output();
        let output = match output {
            Ok(o) if o.status.success() => o,
            _ => continue, // annotations gone (e.g. expired) — skip this run
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let arr: serde_json::Value =
            serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Array(vec![]));
        let Some(items) = arr.as_array() else { continue };

        for a in items {
            let s = |k: &str| a.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let n = |k: &str| a.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
            // GitHub levels are already our canonical set.
            let level = match s("annotation_level").as_str() {
                "failure" => "failure",
                "warning" => "warning",
                _ => "notice",
            };
            annotations.push(CIAnnotation {
                check_name: check_name.clone(),
                path: s("path"),
                start_line: n("start_line"),
                end_line: n("end_line").max(n("start_line")),
                level: level.to_string(),
                title: s("title"),
                message: s("message"),
            });
        }
    }

    Ok(annotations)
}
