//! GitHub REST/OAuth Tauri commands — tokenless PR workflow.
//!
//! ## Why this exists
//!
//! The historical GitHub integration (`gh.rs`, `ops.rs`) shells out to the
//! `gh` CLI. That requires the user to install and `gh auth login` from a
//! terminal — a friction point for non-CLI users. This module adds a second,
//! self-contained auth path:
//!
//!   1. **OAuth device flow** (`github_device_start` / `github_device_poll`):
//!      "Sign in with GitHub" from Settings → Accounts. The resulting token is
//!      stored in the OS keychain under `service = "gitwand:github"`,
//!      `account = "oauth"`.
//!   2. **REST API calls** via `curl` (mirrors `bitbucket.rs`): when a keychain
//!      token is present, the `gh_*` commands route here instead of spawning
//!      `gh`, so the `gh` binary is no longer required.
//!
//! ## Routing rule (see `settings_github_token`)
//!
//! REST is used **only** when an explicit Settings token exists in the keychain.
//! The ambient `GH_TOKEN` / `GITHUB_TOKEN` env vars (auto-populated from
//! `gh auth token` on macOS, see `shell_env.rs`) keep driving the `gh` CLI path
//! exactly as before — we never silently change behaviour for existing `gh`
//! users. Token in keychain ⇒ REST; otherwise ⇒ `gh`.
//!
//! ## Scope
//!
//! Core PR workflow only: current-user, list, count, detail, diff, checks,
//! files, create, merge, checkout, ready. Comments / reviews / reviewer
//! candidates / intelligence keep the `gh` path (or degrade gracefully).
//!
//! ## Security note
//!
//! The token is injected via the `Authorization` header in `curl` process
//! arguments — same exposure profile as `bitbucket.rs` (acceptable for now;
//! harden via `curl --config -` stdin piping in a follow-up). The token is
//! never logged or included in error messages.

use crate::git::{git_cmd, hidden_cmd};
use crate::types::*;

// ─── Constants ──────────────────────────────────────────────────────────────

/// Keychain service for the Settings-managed GitHub token.
pub(crate) const GH_SERVICE: &str = "gitwand:github";
/// Keychain account key — fixed, since the REST helpers resolve the token
/// without knowing the login up front.
pub(crate) const GH_ACCOUNT: &str = "oauth";

/// GitHub OAuth App client_id (public, not a secret — safe to ship).
///
/// **Must be replaced** with a real client_id from a registered GitHub OAuth
/// App that has *device flow* enabled
/// (github.com/settings/developers → New OAuth App → "Enable Device Flow").
///
/// Resolution order:
///   1. `GITWAND_GH_CLIENT_ID` at **runtime** (env var of the running app) —
///      lets `GITWAND_GH_CLIENT_ID=… pnpm tauri dev` work without fighting
///      cargo's build cache.
///   2. `GITWAND_GH_CLIENT_ID` baked in at **build time** (release builds).
///   3. Placeholder — surfaces a clear "not configured" error.
fn client_id() -> String {
    if let Ok(v) = std::env::var("GITWAND_GH_CLIENT_ID") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return v;
        }
    }
    option_env!("GITWAND_GH_CLIENT_ID")
        // GitWand's registered GitHub OAuth App (device flow enabled). Public
        // client_id — not a secret, safe to ship.
        .unwrap_or("Ov23licwiCpPiRPRodWN")
        .to_string()
}

const API_BASE: &str = "https://api.github.com";

// ─── Token resolution ───────────────────────────────────────────────────────

/// Read the Settings-managed GitHub token from the OS keychain.
///
/// Returns `Some(token)` only when the user has explicitly signed in via
/// Settings > Accounts. Ambient env tokens are intentionally ignored here so
/// existing `gh` users are unaffected (see module docs).
pub(crate) fn settings_github_token() -> Option<String> {
    let entry = keyring::Entry::new(GH_SERVICE, GH_ACCOUNT).ok()?;
    let tok = entry.get_password().ok()?;
    let tok = tok.trim().to_string();
    if tok.is_empty() { None } else { Some(tok) }
}

// ─── Owner/repo resolution ──────────────────────────────────────────────────

/// Parse `(owner, repo)` from `git remote get-url origin` in `cwd`.
///
/// Handles HTTPS and SSH GitHub remote URL formats.
fn owner_repo(cwd: &str) -> Result<(String, String), String> {
    let output = hidden_cmd("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git remote get-url: {}", e))?;
    if !output.status.success() {
        return Err("No 'origin' remote found in this repo.".to_string());
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    let path = if url.starts_with("git@") || url.contains("@github.com:") {
        // git@github.com:owner/repo.git → owner/repo
        url.splitn(2, ':')
            .nth(1)
            .unwrap_or("")
            .trim_end_matches(".git")
            .to_string()
    } else {
        // https://github.com/owner/repo.git → owner/repo
        url.trim_end_matches('/')
            .trim_end_matches(".git")
            .splitn(2, "github.com/")
            .nth(1)
            .unwrap_or("")
            .to_string()
    };

    let mut parts = path.splitn(2, '/');
    let owner = parts.next().unwrap_or("").to_string();
    let repo = parts.next().unwrap_or("").to_string();
    if owner.is_empty() || repo.is_empty() {
        return Err(format!("Could not parse GitHub owner/repo from remote URL: {}", url));
    }
    Ok((owner, repo))
}

/// Current branch name (`git rev-parse --abbrev-ref HEAD`).
fn current_branch(cwd: &str) -> Result<String, String> {
    let output = hidden_cmd("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git rev-parse: {}", e))?;
    if !output.status.success() {
        return Err("Could not determine current branch.".to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ─── HTTP transport (curl) ──────────────────────────────────────────────────

/// Run a `curl` request and return `(http_status, body_text)`.
///
/// `accept` selects the representation (`application/vnd.github+json` for JSON,
/// `application/vnd.github.v3.diff` for raw diffs). The token, when present,
/// is sent as a Bearer credential.
fn curl_raw(
    method: &str,
    url: &str,
    token: Option<&str>,
    body_json: Option<&str>,
    accept: &str,
) -> Result<(i32, String), String> {
    // `-w` appends the HTTP status on its own marker line so we can split it
    // off the body without a second request.
    const MARKER: &str = "\n__GW_HTTP_STATUS__";
    let mut args: Vec<String> = vec![
        "-s".to_string(),
        "-X".to_string(), method.to_string(),
        "-H".to_string(), format!("Accept: {}", accept),
        "-H".to_string(), "User-Agent: GitWand".to_string(),
        "-H".to_string(), "X-GitHub-Api-Version: 2022-11-28".to_string(),
    ];
    if let Some(tok) = token {
        args.push("-H".to_string());
        args.push(format!("Authorization: Bearer {}", tok));
    }
    if let Some(b) = body_json {
        args.push("-H".to_string());
        args.push("Content-Type: application/json".to_string());
        args.push("-d".to_string());
        args.push(b.to_string());
    }
    args.push("-w".to_string());
    args.push(format!("{}%{{http_code}}", MARKER));
    args.push(url.to_string());

    let output = hidden_cmd("curl")
        .args(&args)
        .output()
        .map_err(|e| format!("curl not found or failed to spawn: {}", e))?;

    let combined = String::from_utf8_lossy(&output.stdout).to_string();
    let (body, status) = match combined.rsplit_once(MARKER) {
        Some((b, s)) => (b.to_string(), s.trim().parse::<i32>().unwrap_or(0)),
        None => (combined, 0),
    };
    Ok((status, body))
}

/// Perform a GitHub JSON API call. Maps HTTP ≥ 400 to a user-facing error,
/// preferring GitHub's `message` field.
fn api_json(
    method: &str,
    url: &str,
    token: &str,
    body_json: Option<&str>,
) -> Result<serde_json::Value, String> {
    let (status, body) = curl_raw(method, url, Some(token), body_json, "application/vnd.github+json")?;
    if status >= 400 {
        let msg = serde_json::from_str::<serde_json::Value>(body.trim())
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(format!("GitHub API error ({}): {}", status, msg));
    }
    if body.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(body.trim())
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))
}

// ─── JSON field helpers ─────────────────────────────────────────────────────

fn js(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn ji(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

fn jb(v: &serde_json::Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// `obj[outer][inner]` as a string.
fn jnested(v: &serde_json::Value, outer: &str, inner: &str) -> String {
    v.get(outer).and_then(|o| o.get(inner)).and_then(|s| s.as_str()).unwrap_or("").to_string()
}

/// Collect `[{ key: "..." }]` string fields into a Vec.
fn jlogins(v: &serde_json::Value, arr_key: &str, field: &str) -> Vec<String> {
    v.get(arr_key)
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|u| u.get(field).and_then(|s| s.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

// ─── Mapping ────────────────────────────────────────────────────────────────

/// Map a GitHub REST pull-request object to `PullRequest`.
fn json_to_pr(pr: &serde_json::Value) -> PullRequest {
    let merged = pr.get("merged_at").map(|m| !m.is_null()).unwrap_or(false);
    let state = if merged { "merged".to_string() } else { js(pr, "state") };
    let review_requested = jlogins(pr, "requested_reviewers", "login");
    // REST has no review-decision field (that's GraphQL). Use the requested
    // reviewers as a cheap proxy: GitHub removes a reviewer from this list once
    // they approve, so a non-empty list ⇒ still waiting on review. Lets the PR
    // sidebar flag the PR (yellow dot) without a per-PR roundtrip.
    let review_decision = if !review_requested.is_empty() {
        "REVIEW_REQUIRED".to_string()
    } else {
        String::new()
    };
    PullRequest {
        number: ji(pr, "number"),
        title: js(pr, "title"),
        state,
        author: jnested(pr, "user", "login"),
        branch: jnested(pr, "head", "ref"),
        base: jnested(pr, "base", "ref"),
        draft: jb(pr, "draft"),
        created_at: js(pr, "created_at"),
        updated_at: js(pr, "updated_at"),
        url: js(pr, "html_url"),
        additions: ji(pr, "additions"),
        deletions: ji(pr, "deletions"),
        labels: jlogins(pr, "labels", "name"),
        assignees: jlogins(pr, "assignees", "login"),
        review_requested,
        review_decision,
        merge_state_status: js(pr, "mergeable_state").to_uppercase(),
        checks_rollup: String::new(),
        comment_count: ji(pr, "comments"),
    }
}

/// Map a GitHub REST pull-request object to `PullRequestDetail`.
fn json_to_detail(pr: &serde_json::Value) -> PullRequestDetail {
    let merged_at = pr.get("merged_at").and_then(|m| m.as_str()).unwrap_or("").to_string();
    let merged = !merged_at.is_empty();
    let state = if merged { "merged".to_string() } else { js(pr, "state") };
    // GitHub `mergeable`: true / false / null (still computing).
    let mergeable = match pr.get("mergeable").and_then(|m| m.as_bool()) {
        Some(true) => "MERGEABLE".to_string(),
        Some(false) => "CONFLICTING".to_string(),
        None => "UNKNOWN".to_string(),
    };
    PullRequestDetail {
        number: ji(pr, "number"),
        title: js(pr, "title"),
        body: js(pr, "body"),
        state,
        author: jnested(pr, "user", "login"),
        branch: jnested(pr, "head", "ref"),
        base: jnested(pr, "base", "ref"),
        draft: jb(pr, "draft"),
        created_at: js(pr, "created_at"),
        updated_at: js(pr, "updated_at"),
        merged_at,
        url: js(pr, "html_url"),
        additions: ji(pr, "additions"),
        deletions: ji(pr, "deletions"),
        changed_files: ji(pr, "changed_files"),
        comments: ji(pr, "comments"),
        review_comments: ji(pr, "review_comments"),
        labels: jlogins(pr, "labels", "name"),
        reviewers: jlogins(pr, "requested_reviewers", "login"),
        mergeable,
        checks_status: String::new(),
    }
}

// ─── REST PR workflow ───────────────────────────────────────────────────────

pub(crate) fn rest_current_user(token: &str) -> Result<String, String> {
    let v = api_json("GET", &format!("{}/user", API_BASE), token, None)?;
    let login = v.get("login").and_then(|l| l.as_str()).unwrap_or("").to_string();
    if login.is_empty() {
        return Err("GitHub returned an empty login for this token.".to_string());
    }
    Ok(login)
}

pub(crate) fn rest_list_prs(
    cwd: &str,
    state: &str,
    limit: i64,
    offset: i64,
    token: &str,
) -> Result<Vec<PullRequest>, String> {
    let (owner, repo) = owner_repo(cwd)?;
    let origin = format!("{}/{}", owner, repo);
    let page = limit.max(1);
    let off = offset.max(0);
    // Naïve pagination identical to gh_list_prs: fetch offset+limit, then slice.
    let per_page = (page + off).clamp(1, 100);
    // "merged" is not a native GitHub pulls state — fetch closed and filter.
    let api_state = match state {
        "closed" => "closed",
        "merged" => "closed",
        "all" => "all",
        _ => "open",
    };

    // PRs that live in origin.
    let mut raw: Vec<serde_json::Value> = api_json(
        "GET",
        &format!(
            "{}/repos/{}/pulls?state={}&per_page={}&page=1&sort=updated&direction=desc",
            API_BASE, origin, api_state, per_page
        ),
        token,
        None,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();

    // When origin is a fork, also surface the PRs you opened on the upstream
    // repo (head repo == your fork) — these never appear in origin's pulls.
    if let Some(parent) = upstream_parent(cwd, token) {
        if let Ok(up) = api_json(
            "GET",
            &format!(
                "{}/repos/{}/pulls?state={}&per_page={}&page=1&sort=updated&direction=desc",
                API_BASE, parent, api_state, per_page
            ),
            token,
            None,
        ) {
            for pr in up.as_array().cloned().unwrap_or_default() {
                let head_repo = pr
                    .get("head")
                    .and_then(|h| h.get("repo"))
                    .and_then(|r| r.get("full_name"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if head_repo.eq_ignore_ascii_case(&origin) {
                    raw.push(pr);
                }
            }
        }
    }

    // Newest-first — updated_at is ISO-8601, so lexicographic compare works.
    raw.sort_by(|a, b| js(b, "updated_at").cmp(&js(a, "updated_at")));

    let mut prs: Vec<PullRequest> = raw
        .iter()
        .filter(|pr| {
            if state == "merged" {
                pr.get("merged_at").map(|m| !m.is_null()).unwrap_or(false)
            } else {
                true
            }
        })
        .map(json_to_pr)
        .collect();
    if off > 0 {
        let skip = (off as usize).min(prs.len());
        prs.drain(..skip);
    }
    prs.truncate(page as usize);

    // The list endpoint omits additions/deletions (only the per-PR detail has
    // them). Fill +/- locally: refresh remote-tracking branches once on the
    // first page (a single incremental fetch), then numstat per PR. Fork/deleted
    // head branches not present in origin simply leave the stats at 0.
    if !prs.is_empty() {
        if off == 0 {
            let _ = git_cmd().args(["fetch", "origin"]).current_dir(cwd).output();
        }
        for pr in &mut prs {
            let (adds, dels) = diff_numstat(cwd, &pr.branch, &pr.base);
            pr.additions = adds;
            pr.deletions = dels;
        }
        // The REST list carries no CI status. Fetch the status-check rollup for
        // the listed PRs in a single batched GraphQL call so the sidebar can
        // flag in-progress / failing CI (yellow dot).
        let nums: Vec<i64> = prs.iter().map(|p| p.number).collect();
        let rollups = rest_status_rollups(cwd, &nums, token);
        for pr in &mut prs {
            if let Some(state) = rollups.get(&pr.number) {
                pr.checks_rollup = state.clone();
            }
        }
    }
    Ok(prs)
}

/// Batched status-check rollup for a set of PR numbers via one GraphQL request.
/// Returns `number → rollup state` (e.g. SUCCESS / PENDING / FAILURE). Best
/// effort: any failure yields an empty map (no dot, never an error).
fn rest_status_rollups(
    cwd: &str,
    numbers: &[i64],
    token: &str,
) -> std::collections::HashMap<i64, String> {
    let mut map = std::collections::HashMap::new();
    if numbers.is_empty() {
        return map;
    }
    let (owner, repo) = match owner_repo(cwd) {
        Ok(x) => x,
        Err(_) => return map,
    };
    // One aliased field per PR: pr<NUM>: pullRequest(number: NUM) { … }.
    let mut fields = String::new();
    for n in numbers {
        fields.push_str(&format!(
            "pr{0}: pullRequest(number: {0}) {{ commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state }} }} }} }} }} ",
            n
        ));
    }
    let query = format!(
        "query {{ repository(owner: \"{}\", name: \"{}\") {{ {} }} }}",
        owner, repo, fields
    );
    let payload = serde_json::json!({ "query": query });
    let v = match api_json("POST", &format!("{}/graphql", API_BASE), token, Some(&payload.to_string())) {
        Ok(v) => v,
        Err(_) => return map,
    };
    let Some(obj) = v.get("data").and_then(|d| d.get("repository")) else {
        return map;
    };
    for n in numbers {
        let state = obj
            .get(format!("pr{}", n))
            .and_then(|p| p.get("commits"))
            .and_then(|c| c.get("nodes"))
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .and_then(|node| node.get("commit"))
            .and_then(|c| c.get("statusCheckRollup"))
            .and_then(|r| r.get("state"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        if !state.is_empty() {
            map.insert(*n, state.to_uppercase());
        }
    }
    map
}

/// `git diff --numstat origin/base...origin/head` → (additions, deletions).
/// Returns zeros when the refs aren't available locally.
fn diff_numstat(cwd: &str, head: &str, base: &str) -> (i64, i64) {
    if head.is_empty() || base.is_empty() {
        return (0, 0);
    }
    let range = format!("origin/{}...origin/{}", base, head);
    let out = match hidden_cmd("git")
        .args(["diff", "--numstat", &range])
        .current_dir(cwd)
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return (0, 0),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let (mut adds, mut dels) = (0i64, 0i64);
    for line in text.lines() {
        let mut cols = line.split('\t');
        adds += cols.next().unwrap_or("").parse::<i64>().unwrap_or(0);
        dels += cols.next().unwrap_or("").parse::<i64>().unwrap_or(0);
    }
    (adds, dels)
}

/// Fetch a PR object, trying `origin` first and falling back to the upstream
/// parent (for fork → upstream PRs that don't live in origin). Returns the
/// `owner/repo` the PR actually lives in alongside its JSON, so callers issue
/// follow-up requests against the right repo.
fn get_pr_json(cwd: &str, number: i64, token: &str) -> Result<(String, serde_json::Value), String> {
    let (owner, repo) = owner_repo(cwd)?;
    let origin = format!("{}/{}", owner, repo);
    let (st, body) = curl_raw(
        "GET",
        &format!("{}/repos/{}/pulls/{}", API_BASE, origin, number),
        Some(token),
        None,
        "application/vnd.github+json",
    )?;
    if st < 400 {
        let v = serde_json::from_str(body.trim()).map_err(|e| format!("parse PR: {}", e))?;
        return Ok((origin, v));
    }
    if st == 404 {
        if let Some(parent) = upstream_parent(cwd, token) {
            let (st2, body2) = curl_raw(
                "GET",
                &format!("{}/repos/{}/pulls/{}", API_BASE, parent, number),
                Some(token),
                None,
                "application/vnd.github+json",
            )?;
            if st2 < 400 {
                let v = serde_json::from_str(body2.trim()).map_err(|e| format!("parse PR: {}", e))?;
                return Ok((parent, v));
            }
        }
    }
    Err(format!("GitHub API error ({}) fetching PR #{}", st, number))
}

pub(crate) fn rest_pr_count(cwd: &str, state: &str, token: &str) -> Result<i64, String> {
    let (owner, repo) = owner_repo(cwd)?;
    let qualifier = match state.to_lowercase().as_str() {
        "closed" => "+state:closed",
        "merged" => "+is:merged",
        "all" => "",
        _ => "+state:open",
    };
    // /search/issues returns total_count without expanding every item.
    let url = format!(
        "{}/search/issues?q=repo:{}/{}+type:pr{}&per_page=1",
        API_BASE, owner, repo, qualifier
    );
    let v = api_json("GET", &url, token, None)?;
    Ok(v.get("total_count").and_then(|c| c.as_i64()).unwrap_or(0))
}

pub(crate) fn rest_pr_detail(cwd: &str, number: i64, token: &str) -> Result<PullRequestDetail, String> {
    let (_repo, v) = get_pr_json(cwd, number, token)?;
    Ok(json_to_detail(&v))
}

pub(crate) fn rest_pr_diff(cwd: &str, number: i64, token: &str) -> Result<String, String> {
    // Resolve which repo the PR lives in (origin or upstream parent), then fetch
    // its diff from there.
    let (repo, _pr) = get_pr_json(cwd, number, token)?;
    let url = format!("{}/repos/{}/pulls/{}", API_BASE, repo, number);
    let (status, body) = curl_raw("GET", &url, Some(token), None, "application/vnd.github.v3.diff")?;
    if status >= 400 {
        return Err(format!("GitHub diff failed (HTTP {})", status));
    }
    Ok(body)
}

pub(crate) fn rest_pr_checks(cwd: &str, number: i64, token: &str) -> Result<Vec<CICheck>, String> {
    // Resolve repo + head SHA, then list check-runs for that commit.
    let (repo, pr) = get_pr_json(cwd, number, token)?;
    let sha = jnested(&pr, "head", "sha");
    if sha.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!("{}/repos/{}/commits/{}/check-runs", API_BASE, repo, sha);
    let v = match api_json("GET", &url, token, None) {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()), // no checks configured — not fatal
    };
    let runs = v.get("check_runs").and_then(|r| r.as_array()).cloned().unwrap_or_default();
    let checks = runs
        .iter()
        .map(|run| CICheck {
            name: js(run, "name"),
            state: js(run, "status"),
            conclusion: js(run, "conclusion"),
            details_url: js(run, "html_url"),
        })
        .collect();
    Ok(checks)
}

pub(crate) fn rest_pr_files(cwd: &str, number: i64, token: &str) -> Result<Vec<String>, String> {
    let (repo, _pr) = get_pr_json(cwd, number, token)?;
    let url = format!("{}/repos/{}/pulls/{}/files?per_page=100", API_BASE, repo, number);
    let v = api_json("GET", &url, token, None)?;
    let files = v
        .as_array()
        .map(|arr| arr.iter().map(|f| js(f, "filename")).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    Ok(files)
}

/// Resolve the current repo's fork relationship (REST).
pub(crate) fn rest_fork_info(cwd: &str, token: &str) -> Result<ForkInfo, String> {
    let (owner, repo) = owner_repo(cwd)?;
    let origin = format!("{}/{}", owner, repo);
    let info = api_json("GET", &format!("{}/repos/{}/{}", API_BASE, owner, repo), token, None)?;
    let is_fork = info.get("fork").and_then(|f| f.as_bool()).unwrap_or(false);
    let parent = info
        .get("parent")
        .and_then(|p| p.get("full_name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    Ok(ForkInfo { is_fork, origin, parent })
}

/// The upstream parent `owner/repo` when the current repo is a fork, else None.
/// Centralizes the `is_fork && !parent.is_empty()` guard shared by the PR list
/// and the origin→upstream PR fallback.
fn upstream_parent(cwd: &str, token: &str) -> Option<String> {
    let fi = rest_fork_info(cwd, token).ok()?;
    (fi.is_fork && !fi.parent.is_empty()).then_some(fi.parent)
}

pub(crate) fn rest_create_pr(
    cwd: &str,
    title: String,
    body: String,
    base: String,
    base_repo: Option<String>,
    draft: bool,
    reviewers: Option<Vec<String>>,
    token: &str,
) -> Result<PullRequest, String> {
    let (owner, repo) = owner_repo(cwd)?;
    let head_branch = current_branch(cwd)?;
    let origin = format!("{}/{}", owner, repo);

    // Target repo: caller-supplied (cross-fork) or origin. A cross-fork PR must
    // qualify the head ref as "fork-owner:branch".
    let target = match base_repo {
        Some(r) if !r.trim().is_empty() => r.trim().to_string(),
        _ => origin.clone(),
    };
    let is_cross = target != origin;
    let head = if is_cross {
        format!("{}:{}", owner, head_branch)
    } else {
        head_branch
    };

    // Resolve base from the *target* repo's default branch when left empty.
    let base = if base.is_empty() {
        let repo_info = api_json("GET", &format!("{}/repos/{}", API_BASE, target), token, None)?;
        let default = js(&repo_info, "default_branch");
        if default.is_empty() { "main".to_string() } else { default }
    } else {
        base
    };

    let payload = serde_json::json!({
        "title": title,
        "head": head,
        "base": base,
        "body": body,
        "draft": draft,
    });
    let url = format!("{}/repos/{}/pulls", API_BASE, target);
    let created = api_json("POST", &url, token, Some(&payload.to_string()))?;
    let number = ji(&created, "number");

    // Best-effort reviewer request — never fail PR creation if this errors.
    if let Some(revs) = reviewers {
        let cleaned: Vec<String> = revs
            .into_iter()
            .map(|r| r.trim().trim_start_matches('@').to_string())
            .filter(|r| !r.is_empty())
            .collect();
        if !cleaned.is_empty() && number > 0 {
            let rev_payload = serde_json::json!({ "reviewers": cleaned });
            let rev_url = format!(
                "{}/repos/{}/pulls/{}/requested_reviewers",
                API_BASE, target, number
            );
            let _ = api_json("POST", &rev_url, token, Some(&rev_payload.to_string()));
        }
    }

    Ok(json_to_pr(&created))
}

pub(crate) fn rest_merge_pr(cwd: &str, number: i64, method: &str, token: &str) -> Result<(), String> {
    let merge_method = match method {
        "squash" => "squash",
        "rebase" => "rebase",
        _ => "merge",
    };
    // Resolve the repo (origin or upstream) + head branch for cleanup.
    let (repo, pr) = get_pr_json(cwd, number, token)?;
    let branch = jnested(&pr, "head", "ref");

    let payload = serde_json::json!({ "merge_method": merge_method });
    let url = format!("{}/repos/{}/pulls/{}/merge", API_BASE, repo, number);
    api_json("PUT", &url, token, Some(&payload.to_string()))?;

    // Best-effort branch deletion (mirrors `gh pr merge --delete-branch`).
    if !branch.is_empty() {
        let ref_url = format!("{}/repos/{}/git/refs/heads/{}", API_BASE, repo, branch);
        let _ = api_json("DELETE", &ref_url, token, None);
    }
    Ok(())
}

pub(crate) fn rest_pr_ready(cwd: &str, number: i64, token: &str) -> Result<(), String> {
    // Draft→ready is GraphQL-only; resolve the PR node_id first (origin or upstream).
    let (_repo, pr) = get_pr_json(cwd, number, token)?;
    let node_id = js(&pr, "node_id");
    if node_id.is_empty() {
        return Err("Could not resolve PR node_id for ready conversion.".to_string());
    }
    let query = format!(
        "mutation {{ markPullRequestReadyForReview(input: {{ pullRequestId: \"{}\" }}) {{ pullRequest {{ isDraft }} }} }}",
        node_id
    );
    let payload = serde_json::json!({ "query": query });
    let v = api_json("POST", &format!("{}/graphql", API_BASE), token, Some(&payload.to_string()))?;
    if let Some(errors) = v.get("errors").and_then(|e| e.as_array()) {
        if !errors.is_empty() {
            let msg = errors[0].get("message").and_then(|m| m.as_str()).unwrap_or("GraphQL error");
            return Err(format!("Mark-ready failed: {}", msg));
        }
    }
    Ok(())
}

pub(crate) fn rest_checkout_pr(cwd: &str, number: i64) -> Result<(), String> {
    // Local git fetch of the PR head ref — token not needed (git uses its own
    // credential helper). Works for same-repo and fork PRs alike.
    let local = format!("pr-{}", number);
    let refspec = format!("pull/{}/head:{}", number, local);
    let fetch = git_cmd()
        .args(["fetch", "origin", &refspec])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git fetch failed: {}", e))?;
    if !fetch.status.success() {
        return Err(format!(
            "git fetch pull/{}/head failed: {}",
            number,
            String::from_utf8_lossy(&fetch.stderr).trim()
        ));
    }
    let checkout = git_cmd()
        .args(["checkout", &local])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git checkout failed: {}", e))?;
    if !checkout.status.success() {
        return Err(format!(
            "git checkout {} failed: {}",
            local,
            String::from_utf8_lossy(&checkout.stderr).trim()
        ));
    }
    Ok(())
}

// ─── OAuth device flow ──────────────────────────────────────────────────────

/// Begin the OAuth device flow. Returns the user code + verification URL the
/// frontend shows, plus the `device_code` used for polling.
#[tauri::command]
pub(crate) fn github_device_start() -> Result<GithubDeviceCode, String> {
    let cid = client_id();
    if cid.starts_with("REPLACE_WITH") {
        return Err(
            "GitHub login is not configured: missing OAuth App client_id. \
             Set GITWAND_GH_CLIENT_ID at build time or update github_api.rs."
                .to_string(),
        );
    }
    // GitHub's OAuth endpoints accept a JSON body when Content-Type is JSON
    // (which `curl_raw` sets whenever a body is present).
    let body = serde_json::json!({ "client_id": cid, "scope": "repo" });
    let (status, text) = curl_raw(
        "POST",
        "https://github.com/login/device/code",
        None,
        Some(&body.to_string()),
        "application/json",
    )?;
    if status >= 400 {
        return Err(format!("GitHub device-code request failed (HTTP {})", status));
    }
    let v: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse device-code response: {}", e))?;
    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        return Err(format!("GitHub device-code error: {}", err));
    }
    Ok(GithubDeviceCode {
        device_code: js(&v, "device_code"),
        user_code: js(&v, "user_code"),
        verification_uri: js(&v, "verification_uri"),
        verification_uri_complete: js(&v, "verification_uri_complete"),
        expires_in: ji(&v, "expires_in"),
        interval: ji(&v, "interval").max(5),
    })
}

/// Poll once for the OAuth access token.
///
/// `status` is one of: `"pending"` (keep polling), `"slow_down"` (back off),
/// `"success"` (token stored, `login` populated), or `"error"`.
/// On success the token is persisted to the OS keychain so the REST path can
/// pick it up; the secret is never returned to the frontend.
#[tauri::command]
pub(crate) fn github_device_poll(device_code: String) -> Result<GithubDevicePoll, String> {
    let cid = client_id();
    let body = serde_json::json!({
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    });
    let (status, text) = curl_raw(
        "POST",
        "https://github.com/login/oauth/access_token",
        None,
        Some(&body.to_string()),
        "application/json",
    )?;
    if status >= 400 {
        return Err(format!("GitHub token poll failed (HTTP {})", status));
    }
    let v: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        let kind = match err {
            "authorization_pending" => "pending",
            "slow_down" => "slow_down",
            _ => "error",
        };
        return Ok(GithubDevicePoll {
            status: kind.to_string(),
            login: String::new(),
            error: if kind == "error" { err.to_string() } else { String::new() },
        });
    }

    let token = js(&v, "access_token");
    if token.is_empty() {
        return Ok(GithubDevicePoll {
            status: "pending".to_string(),
            login: String::new(),
            error: String::new(),
        });
    }

    // Persist to keychain so the REST path activates.
    let entry = keyring::Entry::new(GH_SERVICE, GH_ACCOUNT)
        .map_err(|e| format!("keyring init failed: {}", e))?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store GitHub token: {}", e))?;

    // Resolve the login for display (non-fatal if it fails).
    let login = rest_current_user(&token).unwrap_or_default();
    Ok(GithubDevicePoll {
        status: "success".to_string(),
        login,
        error: String::new(),
    })
}

/// Whether a Settings-managed GitHub token is currently stored.
#[tauri::command]
pub(crate) fn github_token_present() -> Result<bool, String> {
    Ok(settings_github_token().is_some())
}
