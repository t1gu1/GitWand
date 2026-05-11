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

/// List open pull requests using `gh` CLI.
#[tauri::command]
pub(crate) fn gh_list_prs(cwd: String, state: String) -> Result<Vec<PullRequest>, String> {
    let st = if state.is_empty() { "open" } else { &state };
    let output = hidden_cmd("gh")
        .args([
            "pr", "list",
            "--state", st,
            "--json", "number,title,state,author,headRefName,baseRefName,isDraft,createdAt,updatedAt,url,additions,deletions,labels,assignees,reviewRequests,reviewDecision,mergeStateStatus,statusCheckRollup",
            "--limit", "300",
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
    parse_gh_pr_json(&stdout)
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
