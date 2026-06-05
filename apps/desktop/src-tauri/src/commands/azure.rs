//! Azure DevOps REST / Entra ID OAuth Tauri commands.
//!
//! ## Why this exists
//!
//! Mirrors `github_api.rs` for Azure DevOps Services (dev.azure.com /
//! *.visualstudio.com). GitWand had no Azure forge before; this module adds a
//! self-contained auth + PR workflow path so users can sign in and drive PRs
//! without any CLI.
//!
//!   1. **Entra ID device flow** (`azure_device_start` / `azure_device_poll`):
//!      "Sign in with Azure" from Settings → Accounts. Microsoft's identity
//!      platform exposes the OAuth 2.0 device authorization grant, which maps
//!      1-for-1 onto the existing GitHub device-flow UI. The resulting access
//!      token is stored in the OS keychain under `service = "gitwand:azure"`,
//!      `account = "oauth"`.
//!   2. **REST API calls** via `curl` (Bearer token) against the Azure DevOps
//!      `_apis/git` endpoints (api-version 7.1).
//!
//! ## Auth resource / scope
//!
//! Azure DevOps is a first-party Entra resource (app id
//! `499b84ac-1321-427f-aa17-267ca6975798`). We request `.default` on it plus
//! `offline_access` so a refresh token is available for follow-up work.
//!
//! ## Security note
//!
//! The token is injected via the `Authorization` header in `curl` process
//! arguments — same exposure profile as `github_api.rs` / `bitbucket.rs`. The
//! token is never logged or returned to the frontend.

use crate::git::{git_cmd, hidden_cmd};
use crate::types::*;

// ─── Constants ──────────────────────────────────────────────────────────────

/// Keychain service for the Settings-managed Azure token.
pub(crate) const AZ_SERVICE: &str = "gitwand:azure";
/// Keychain account key — fixed, resolved without knowing the login up front.
pub(crate) const AZ_ACCOUNT: &str = "oauth";
/// Keychain account key for the Entra refresh token (used to renew the access
/// token, which expires ~1h after sign-in).
const AZ_ACCOUNT_REFRESH: &str = "oauth-refresh";

/// Azure DevOps first-party resource app id — the audience our access token
/// targets. Stable, public, documented by Microsoft.
const AZURE_DEVOPS_RESOURCE: &str = "499b84ac-1321-427f-aa17-267ca6975798";

/// Azure DevOps REST api-version pinned across this module.
const API_VERSION: &str = "7.1";

/// Entra ID OAuth endpoints. `organizations` admits any work/school tenant
/// (the common case for Azure DevOps) while excluding personal MSAs, which
/// cannot hold Azure DevOps identities anyway.
const DEVICECODE_URL: &str =
    "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";

/// Entra ID public-client application id (device-flow enabled).
///
/// Resolution order mirrors `github_api.rs::client_id`:
///   1. `GITWAND_AZURE_CLIENT_ID` at runtime (env of the running app).
///   2. `GITWAND_AZURE_CLIENT_ID` baked in at build time.
///   3. Fallback default (see below).
///
/// **TEMPORARY default** — the well-known Azure CLI public client id
/// (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`). It is a Microsoft first-party
/// public client with device flow enabled, so it works out of the box without
/// registering our own app. This is a stop-gap: it is *not* GitWand's app, the
/// consent screen reads "Microsoft Azure CLI", and Microsoft may restrict its
/// reuse at any time. Replace with a dedicated GitWand Entra app registration
/// (Azure Portal → App registrations → "Allow public client flows" = Yes) and
/// supply its id via `GITWAND_AZURE_CLIENT_ID` before shipping.
fn client_id() -> String {
    if let Ok(v) = std::env::var("GITWAND_AZURE_CLIENT_ID") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return v;
        }
    }
    option_env!("GITWAND_AZURE_CLIENT_ID")
        .unwrap_or("04b07795-8ddb-461a-bbee-02f9e1bf7b46")
        .to_string()
}

// ─── Token resolution ───────────────────────────────────────────────────────

/// Read a value from the keychain under `AZ_SERVICE` / `account`.
fn read_secret(account: &str) -> Option<String> {
    let entry = keyring::Entry::new(AZ_SERVICE, account).ok()?;
    let v = entry.get_password().ok()?;
    let v = v.trim().to_string();
    if v.is_empty() { None } else { Some(v) }
}

/// Store a value in the keychain under `AZ_SERVICE` / `account`.
fn write_secret(account: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(AZ_SERVICE, account)
        .map_err(|e| format!("keyring init failed: {}", e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to store Azure token: {}", e))
}

/// Read the Settings-managed Azure access token from the OS keychain.
pub(crate) fn settings_azure_token() -> Option<String> {
    read_secret(AZ_ACCOUNT)
}

/// Read the stored Entra refresh token.
fn settings_azure_refresh() -> Option<String> {
    read_secret(AZ_ACCOUNT_REFRESH)
}

/// Persist the access token (and refresh token, when the grant returns one).
fn store_tokens(access: &str, refresh: &str) -> Result<(), String> {
    write_secret(AZ_ACCOUNT, access)?;
    if !refresh.is_empty() {
        write_secret(AZ_ACCOUNT_REFRESH, refresh)?;
    }
    Ok(())
}

/// Exchange the stored refresh token for a fresh access token (Entra rotates the
/// refresh token, so persist the new one too). Returns the new access token.
///
/// Entra access tokens live ~1h; without this, the PR workflow breaks an hour
/// after sign-in and Azure DevOps starts returning an HTML sign-in page.
fn refresh_access_token() -> Result<String, String> {
    let refresh = settings_azure_refresh().ok_or_else(|| {
        "Azure session expired. Open Settings → Accounts and sign in with Azure again."
            .to_string()
    })?;
    let cid = client_id();
    let scope = format!("{}/.default offline_access", AZURE_DEVOPS_RESOURCE);
    let (_status, text) = curl_form(
        TOKEN_URL,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", &cid),
            ("refresh_token", &refresh),
            ("scope", &scope),
        ],
    )?;
    let v: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;
    let access = js(&v, "access_token");
    if access.is_empty() {
        return Err(
            "Azure session expired. Open Settings → Accounts and sign in with Azure again."
                .to_string(),
        );
    }
    // Entra refresh-token rotation: store whatever new refresh token it returns.
    let _ = store_tokens(&access, &js(&v, "refresh_token"));
    Ok(access)
}

// ─── org/project/repo resolution ────────────────────────────────────────────

/// Identifies an Azure DevOps repository: organization, project, repo.
struct AzureRepo {
    org: String,
    project: String,
    repo: String,
}

impl AzureRepo {
    /// Base URL for the git REST surface of this repo.
    fn api_base(&self) -> String {
        format!(
            "https://dev.azure.com/{}/{}/_apis/git/repositories/{}",
            urlenc(&self.org),
            urlenc(&self.project),
            urlenc(&self.repo),
        )
    }
}

/// Minimal percent-encoding for path segments (space + a few reserved chars).
/// Azure org/project names allow spaces; the rest of the chars we care about
/// are alphanumerics, `-`, `_`, `.`.
fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Parse `(org, project, repo)` from `git remote get-url origin`.
///
/// Handles the common Azure DevOps remote URL shapes:
///   - `https://dev.azure.com/{org}/{project}/_git/{repo}`
///   - `https://{org}@dev.azure.com/{org}/{project}/_git/{repo}`
///   - `https://{org}.visualstudio.com/{project}/_git/{repo}`
///   - `https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}`
///   - `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`
fn azure_repo(cwd: &str) -> Result<AzureRepo, String> {
    let output = hidden_cmd("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git remote get-url: {}", e))?;
    if !output.status.success() {
        return Err("No 'origin' remote found in this repo.".to_string());
    }
    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_azure_remote(&url)
        .ok_or_else(|| format!("Could not parse an Azure DevOps repo from remote URL: {}", url))
}

fn parse_azure_remote(url: &str) -> Option<AzureRepo> {
    // SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    if let Some(rest) = url.split_once("ssh.dev.azure.com:").map(|(_, r)| r) {
        let rest = rest.trim_start_matches("v3/").trim_end_matches(".git");
        let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();
        if parts.len() >= 3 {
            return Some(AzureRepo {
                org: parts[0].to_string(),
                project: parts[1].to_string(),
                repo: parts[2..].join("/"),
            });
        }
        return None;
    }

    // HTTPS — strip scheme + any `user@` userinfo.
    let after_scheme = url.splitn(2, "://").nth(1).unwrap_or(url);
    let after_userinfo = after_scheme.splitn(2, '@').last().unwrap_or(after_scheme);
    let (host, path) = after_userinfo.split_once('/')?;
    let path = path.trim_end_matches('/').trim_end_matches(".git");

    // dev.azure.com/{org}/{project}/_git/{repo}
    if host.eq_ignore_ascii_case("dev.azure.com") {
        let (left, repo) = path.split_once("/_git/")?;
        let segs: Vec<&str> = left.split('/').filter(|s| !s.is_empty()).collect();
        if segs.len() >= 2 {
            return Some(AzureRepo {
                org: segs[0].to_string(),
                project: segs[1..].join("/"),
                repo: repo.to_string(),
            });
        }
        return None;
    }

    // {org}.visualstudio.com[/DefaultCollection]/{project}/_git/{repo}
    if let Some(org) = host.strip_suffix(".visualstudio.com") {
        let (left, repo) = path.split_once("/_git/")?;
        let segs: Vec<&str> = left
            .split('/')
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("DefaultCollection"))
            .collect();
        if !segs.is_empty() {
            return Some(AzureRepo {
                org: org.to_string(),
                project: segs.join("/"),
                repo: repo.to_string(),
            });
        }
    }
    None
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
fn curl_raw(
    method: &str,
    url: &str,
    token: Option<&str>,
    body_json: Option<&str>,
) -> Result<(i32, String), String> {
    const MARKER: &str = "\n__GW_HTTP_STATUS__";
    let mut args: Vec<String> = vec![
        "-s".to_string(),
        "-X".to_string(), method.to_string(),
        "-H".to_string(), "Accept: application/json".to_string(),
        "-H".to_string(), "User-Agent: GitWand".to_string(),
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

/// Form-encoded POST (Entra token/devicecode endpoints expect this), returns
/// `(status, body)`.
fn curl_form(url: &str, fields: &[(&str, &str)]) -> Result<(i32, String), String> {
    const MARKER: &str = "\n__GW_HTTP_STATUS__";
    let mut args: Vec<String> = vec![
        "-s".to_string(),
        "-X".to_string(), "POST".to_string(),
        "-H".to_string(), "Accept: application/json".to_string(),
        "-H".to_string(), "User-Agent: GitWand".to_string(),
    ];
    for (k, v) in fields {
        args.push("--data-urlencode".to_string());
        args.push(format!("{}={}", k, v));
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

/// Whether a response means "the access token is no longer accepted".
///
/// Azure DevOps does not always answer 401: when an OAuth token is expired or
/// rejected it frequently replies **HTTP 200 with an HTML sign-in page**. So we
/// also treat a non-JSON HTML body as an auth failure.
fn auth_failed(status: i32, body: &str) -> bool {
    if status == 401 || status == 203 {
        return true;
    }
    let t = body.trim_start();
    t.starts_with("<!DOCTYPE") || t.starts_with("<html") || t.starts_with("<HTML")
}

/// Turn a raw `(status, body)` into JSON or a user-facing error.
fn finalize_json(status: i32, body: &str) -> Result<serde_json::Value, String> {
    if status >= 400 {
        let msg = serde_json::from_str::<serde_json::Value>(body.trim())
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(format!("Azure DevOps API error ({}): {}", status, msg));
    }
    if body.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(body.trim())
        .map_err(|e| format!("Failed to parse Azure DevOps response: {}", e))
}

/// Perform an authenticated Azure DevOps JSON API call.
///
/// Resolves the access token from the keychain; on an auth failure it refreshes
/// the token once (via the stored refresh token) and retries. A persistent
/// failure surfaces a clear "sign in again" error rather than a JSON parse error.
fn az_json(
    method: &str,
    url: &str,
    body_json: Option<&str>,
) -> Result<serde_json::Value, String> {
    let token = settings_azure_token().ok_or_else(|| {
        "Not signed in to Azure DevOps. Open Settings → Accounts and sign in with Azure."
            .to_string()
    })?;
    let (status, body) = curl_raw(method, url, Some(&token), body_json)?;
    if !auth_failed(status, &body) {
        return finalize_json(status, &body);
    }
    // Token rejected/expired → refresh once and retry.
    let fresh = refresh_access_token()?;
    let (status2, body2) = curl_raw(method, url, Some(&fresh), body_json)?;
    if auth_failed(status2, &body2) {
        return Err(
            "Azure session expired. Open Settings → Accounts and sign in with Azure again."
                .to_string(),
        );
    }
    finalize_json(status2, &body2)
}

/// Append the pinned `api-version` query parameter to a URL.
fn with_api_version(url: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{}{}api-version={}", url, sep, API_VERSION)
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

fn jnested(v: &serde_json::Value, outer: &str, inner: &str) -> String {
    v.get(outer).and_then(|o| o.get(inner)).and_then(|s| s.as_str()).unwrap_or("").to_string()
}

/// Strip the `refs/heads/` prefix from an Azure ref name.
fn short_ref(full: &str) -> String {
    full.strip_prefix("refs/heads/").unwrap_or(full).to_string()
}

/// Map Azure PR `status` to GitWand's vocabulary.
fn map_status(status: &str) -> String {
    match status {
        "completed" => "merged".to_string(),
        "abandoned" => "closed".to_string(),
        _ => "open".to_string(), // "active"
    }
}

/// Web URL for a PR (Azure REST omits a ready-made one in list responses).
fn pr_web_url(r: &AzureRepo, id: i64) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_git/{}/pullrequest/{}",
        urlenc(&r.org), urlenc(&r.project), urlenc(&r.repo), id
    )
}

// ─── Mapping ────────────────────────────────────────────────────────────────

fn json_to_pr(r: &AzureRepo, pr: &serde_json::Value) -> PullRequest {
    let id = ji(pr, "pullRequestId");
    PullRequest {
        number: id,
        title: js(pr, "title"),
        state: map_status(&js(pr, "status")),
        author: jnested(pr, "createdBy", "displayName"),
        branch: short_ref(&js(pr, "sourceRefName")),
        base: short_ref(&js(pr, "targetRefName")),
        draft: jb(pr, "isDraft"),
        created_at: js(pr, "creationDate"),
        updated_at: js(pr, "creationDate"),
        url: pr_web_url(r, id),
        additions: 0,
        deletions: 0,
        labels: Vec::new(),
        assignees: Vec::new(),
        review_requested: Vec::new(),
        review_decision: String::new(),
        merge_state_status: js(pr, "mergeStatus").to_uppercase(),
        checks_rollup: String::new(),
        comment_count: 0,
    }
}

fn json_to_detail(r: &AzureRepo, pr: &serde_json::Value) -> PullRequestDetail {
    let id = ji(pr, "pullRequestId");
    let status = js(pr, "status");
    let merged_at = if status == "completed" { js(pr, "closedDate") } else { String::new() };
    // Azure `mergeStatus`: succeeded / conflicts / queued / …
    let mergeable = match js(pr, "mergeStatus").as_str() {
        "succeeded" => "MERGEABLE".to_string(),
        "conflicts" => "CONFLICTING".to_string(),
        _ => "UNKNOWN".to_string(),
    };
    PullRequestDetail {
        number: id,
        title: js(pr, "title"),
        body: js(pr, "description"),
        state: map_status(&status),
        author: jnested(pr, "createdBy", "displayName"),
        branch: short_ref(&js(pr, "sourceRefName")),
        base: short_ref(&js(pr, "targetRefName")),
        draft: jb(pr, "isDraft"),
        created_at: js(pr, "creationDate"),
        updated_at: js(pr, "creationDate"),
        merged_at,
        url: pr_web_url(r, id),
        additions: 0,
        deletions: 0,
        changed_files: 0,
        comments: 0,
        review_comments: 0,
        labels: Vec::new(),
        reviewers: pr
            .get("reviewers")
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().map(|u| js(u, "displayName")).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default(),
        mergeable,
        checks_status: String::new(),
    }
}

// ─── REST PR workflow ───────────────────────────────────────────────────────

fn rest_current_user() -> Result<String, String> {
    let url = with_api_version("https://app.vssps.visualstudio.com/_apis/profile/profiles/me");
    let v = az_json("GET", &url, None)?;
    let name = js(&v, "displayName");
    let name = if name.is_empty() { js(&v, "emailAddress") } else { name };
    if name.is_empty() {
        return Err("Azure DevOps returned an empty profile for this token.".to_string());
    }
    Ok(name)
}

/// Resolve the display name for an explicit token (used right after sign-in,
/// before the token is fully wired into the keychain-backed `az_json` path).
fn rest_current_user_with(token: &str) -> Result<String, String> {
    let url = with_api_version("https://app.vssps.visualstudio.com/_apis/profile/profiles/me");
    let (status, body) = curl_raw("GET", &url, Some(token), None)?;
    let v = finalize_json(status, &body)?;
    let name = js(&v, "displayName");
    let name = if name.is_empty() { js(&v, "emailAddress") } else { name };
    Ok(name)
}

fn search_status(state: &str) -> &'static str {
    match state {
        "closed" => "abandoned",
        "merged" => "completed",
        "all" => "all",
        _ => "active",
    }
}

fn rest_list_prs(cwd: &str, state: &str, limit: i64, offset: i64) -> Result<Vec<PullRequest>, String> {
    let r = azure_repo(cwd)?;
    let top = (limit + offset).clamp(1, 100);
    let url = with_api_version(&format!(
        "{}/pullrequests?searchCriteria.status={}&$top={}",
        r.api_base(), search_status(state), top
    ));
    let v = az_json("GET", &url, None)?;
    let mut prs: Vec<PullRequest> = v
        .get("value")
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().map(|pr| json_to_pr(&r, pr)).collect())
        .unwrap_or_default();
    if offset > 0 {
        let skip = (offset as usize).min(prs.len());
        prs.drain(..skip);
    }
    prs.truncate(limit.max(1) as usize);
    Ok(prs)
}

fn rest_pr_count(cwd: &str, state: &str) -> Result<i64, String> {
    let r = azure_repo(cwd)?;
    let url = with_api_version(&format!(
        "{}/pullrequests?searchCriteria.status={}&$top=1000",
        r.api_base(), search_status(state)
    ));
    let v = az_json("GET", &url, None)?;
    Ok(v.get("count").and_then(|c| c.as_i64()).unwrap_or_else(|| {
        v.get("value").and_then(|a| a.as_array()).map(|a| a.len() as i64).unwrap_or(0)
    }))
}

/// Fetch a single PR object together with its repo descriptor.
fn get_pr_json(cwd: &str, number: i64) -> Result<(AzureRepo, serde_json::Value), String> {
    let r = azure_repo(cwd)?;
    let url = with_api_version(&format!("{}/pullrequests/{}", r.api_base(), number));
    let v = az_json("GET", &url, None)?;
    Ok((r, v))
}

fn rest_pr_detail(cwd: &str, number: i64) -> Result<PullRequestDetail, String> {
    let (r, v) = get_pr_json(cwd, number)?;
    Ok(json_to_detail(&r, &v))
}

/// Diff is produced locally: fetch both PR branches from origin and diff the
/// merge base. Azure DevOps has no single unified-patch endpoint.
fn fetch_pr_branches(cwd: &str, source: &str, target: &str) -> Result<(), String> {
    let out = git_cmd()
        .args(["fetch", "origin", source, target])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git fetch failed: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "git fetch {}/{} failed: {}",
            source, target, String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

fn rest_pr_diff(cwd: &str, number: i64) -> Result<String, String> {
    let (_r, pr) = get_pr_json(cwd, number)?;
    let source = short_ref(&js(&pr, "sourceRefName"));
    let target = short_ref(&js(&pr, "targetRefName"));
    fetch_pr_branches(cwd, &source, &target)?;
    let range = format!("origin/{}...origin/{}", target, source);
    let out = git_cmd()
        .args(["diff", &range])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;
    if !out.status.success() {
        return Err(format!("git diff failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn rest_pr_files(cwd: &str, number: i64) -> Result<Vec<String>, String> {
    let (_r, pr) = get_pr_json(cwd, number)?;
    let source = short_ref(&js(&pr, "sourceRefName"));
    let target = short_ref(&js(&pr, "targetRefName"));
    fetch_pr_branches(cwd, &source, &target)?;
    let range = format!("origin/{}...origin/{}", target, source);
    let out = git_cmd()
        .args(["diff", "--name-only", &range])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git diff --name-only failed: {}", e))?;
    if !out.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

fn rest_create_pr(
    cwd: &str,
    title: String,
    body: String,
    base: String,
    draft: bool,
) -> Result<PullRequest, String> {
    let r = azure_repo(cwd)?;
    let head_branch = current_branch(cwd)?;
    let base = if base.is_empty() { "main".to_string() } else { base };
    let payload = serde_json::json!({
        "sourceRefName": format!("refs/heads/{}", head_branch),
        "targetRefName": format!("refs/heads/{}", base),
        "title": title,
        "description": body,
        "isDraft": draft,
    });
    let url = with_api_version(&format!("{}/pullrequests", r.api_base()));
    let created = az_json("POST", &url, Some(&payload.to_string()))?;
    Ok(json_to_pr(&r, &created))
}

fn rest_merge_pr(cwd: &str, number: i64, method: &str) -> Result<(), String> {
    let (r, pr) = get_pr_json(cwd, number)?;
    let merge_strategy = match method {
        "squash" => "squash",
        "rebase" => "rebase",
        _ => "noFastForward",
    };
    let commit_id = pr
        .get("lastMergeSourceCommit")
        .and_then(|c| c.get("commitId"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let payload = serde_json::json!({
        "status": "completed",
        "lastMergeSourceCommit": { "commitId": commit_id },
        "completionOptions": {
            "mergeStrategy": merge_strategy,
            "deleteSourceBranch": true,
        },
    });
    let url = with_api_version(&format!("{}/pullrequests/{}", r.api_base(), number));
    az_json("PATCH", &url, Some(&payload.to_string()))?;
    Ok(())
}

fn rest_pr_ready(cwd: &str, number: i64) -> Result<(), String> {
    let r = azure_repo(cwd)?;
    let payload = serde_json::json!({ "isDraft": false });
    let url = with_api_version(&format!("{}/pullrequests/{}", r.api_base(), number));
    az_json("PATCH", &url, Some(&payload.to_string()))?;
    Ok(())
}

fn rest_checkout_pr(cwd: &str, number: i64) -> Result<(), String> {
    let (_r, pr) = get_pr_json(cwd, number)?;
    let source = short_ref(&js(&pr, "sourceRefName"));
    let fetch = git_cmd()
        .args(["fetch", "origin", &source])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git fetch failed: {}", e))?;
    if !fetch.status.success() {
        return Err(format!(
            "git fetch {} failed: {}",
            source, String::from_utf8_lossy(&fetch.stderr).trim()
        ));
    }
    let checkout = git_cmd()
        .args(["checkout", &source])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git checkout failed: {}", e))?;
    if !checkout.status.success() {
        return Err(format!(
            "git checkout {} failed: {}",
            source, String::from_utf8_lossy(&checkout.stderr).trim()
        ));
    }
    Ok(())
}

// ─── Tauri commands — PR workflow ───────────────────────────────────────────

#[tauri::command]
pub(crate) fn az_current_user() -> Result<String, String> {
    rest_current_user()
}

#[tauri::command]
pub(crate) fn az_list_prs(cwd: String, state: String, limit: i64, offset: i64) -> Result<Vec<PullRequest>, String> {
    rest_list_prs(&cwd, &state, limit, offset)
}

#[tauri::command]
pub(crate) fn az_pr_count(cwd: String, state: String) -> Result<i64, String> {
    rest_pr_count(&cwd, &state)
}

#[tauri::command]
pub(crate) fn az_pr_detail(cwd: String, number: i64) -> Result<PullRequestDetail, String> {
    rest_pr_detail(&cwd, number)
}

#[tauri::command]
pub(crate) fn az_pr_diff(cwd: String, number: i64) -> Result<String, String> {
    rest_pr_diff(&cwd, number)
}

#[tauri::command]
pub(crate) fn az_pr_files(cwd: String, number: i64) -> Result<Vec<String>, String> {
    rest_pr_files(&cwd, number)
}

#[tauri::command]
pub(crate) fn az_create_pr(
    cwd: String,
    title: String,
    body: String,
    base: Option<String>,
    draft: Option<bool>,
) -> Result<PullRequest, String> {
    rest_create_pr(&cwd, title, body, base.unwrap_or_default(), draft.unwrap_or(false))
}

#[tauri::command]
pub(crate) fn az_merge_pr(cwd: String, number: i64, method: Option<String>) -> Result<(), String> {
    rest_merge_pr(&cwd, number, &method.unwrap_or_else(|| "merge".to_string()))
}

#[tauri::command]
pub(crate) fn az_pr_ready(cwd: String, number: i64) -> Result<(), String> {
    rest_pr_ready(&cwd, number)
}

#[tauri::command]
pub(crate) fn az_checkout_pr(cwd: String, number: i64) -> Result<(), String> {
    rest_checkout_pr(&cwd, number)
}

// ─── Entra ID device flow ───────────────────────────────────────────────────

/// Begin the Entra ID device authorization grant.
#[tauri::command]
pub(crate) fn azure_device_start() -> Result<GithubDeviceCode, String> {
    let cid = client_id();
    if cid.starts_with("REPLACE_WITH") {
        return Err(
            "Azure login is not configured: missing Entra ID client_id. \
             Set GITWAND_AZURE_CLIENT_ID at build time or update azure.rs."
                .to_string(),
        );
    }
    let scope = format!("{}/.default offline_access", AZURE_DEVOPS_RESOURCE);
    let (status, text) = curl_form(DEVICECODE_URL, &[("client_id", &cid), ("scope", &scope)])?;
    if status >= 400 {
        let msg = serde_json::from_str::<serde_json::Value>(text.trim())
            .ok()
            .and_then(|v| v.get("error_description").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| format!("HTTP {}", status));
        return Err(format!("Azure device-code request failed: {}", msg));
    }
    let v: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse device-code response: {}", e))?;
    Ok(GithubDeviceCode {
        device_code: js(&v, "device_code"),
        user_code: js(&v, "user_code"),
        verification_uri: js(&v, "verification_uri"),
        // Entra returns `verification_uri_complete` only with some configs.
        verification_uri_complete: js(&v, "verification_uri_complete"),
        expires_in: ji(&v, "expires_in"),
        interval: ji(&v, "interval").max(5),
    })
}

/// Poll once for the Entra access token. On success the token is stored in the
/// OS keychain; the secret never reaches the frontend.
#[tauri::command]
pub(crate) fn azure_device_poll(device_code: String) -> Result<GithubDevicePoll, String> {
    let cid = client_id();
    let (status, text) = curl_form(
        TOKEN_URL,
        &[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", &cid),
            ("device_code", &device_code),
        ],
    )?;
    let v: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        let kind = match err {
            "authorization_pending" => "pending",
            "slow_down" => "slow_down",
            _ => "error",
        };
        let detail = js(&v, "error_description");
        return Ok(GithubDevicePoll {
            status: kind.to_string(),
            login: String::new(),
            error: if kind == "error" {
                if detail.is_empty() { err.to_string() } else { detail }
            } else {
                String::new()
            },
        });
    }
    if status >= 400 {
        return Err(format!("Azure token poll failed (HTTP {})", status));
    }

    let token = js(&v, "access_token");
    if token.is_empty() {
        return Ok(GithubDevicePoll {
            status: "pending".to_string(),
            login: String::new(),
            error: String::new(),
        });
    }

    // Persist access + refresh tokens so the PR workflow survives the ~1h
    // access-token lifetime (refreshed transparently by `az_json`).
    store_tokens(&token, &js(&v, "refresh_token"))?;

    let login = rest_current_user_with(&token).unwrap_or_default();
    Ok(GithubDevicePoll {
        status: "success".to_string(),
        login,
        error: String::new(),
    })
}

/// Whether a Settings-managed Azure token is currently stored.
#[tauri::command]
pub(crate) fn azure_token_present() -> Result<bool, String> {
    Ok(settings_azure_token().is_some())
}
