use std::collections::HashMap;
use std::path::Path;
use crate::git::cmd::git_cmd;
use crate::types::{
    DiffHunk, DiffLine, FileLogEntry, FolderDiffNode, GhIssueRaw, GhPrDetailRaw, GhPrRaw, Issue,
    MonorepoPackage, PullRequest, PullRequestDetail, RawFileChange, ShortlogEntry,
};

pub(crate) fn parse_diff_hunks(stdout: &str) -> (Vec<DiffHunk>, Option<String>) {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line_no = 0i32;
    let mut new_line_no = 0i32;
    let mut detected_status: Option<String> = None;

    for line in stdout.lines() {
        if line.starts_with("new file mode") {
            detected_status = Some("added".to_string());
            continue;
        }

        if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            let header = line.to_string();
            let parts: Vec<&str> = line.split_whitespace().collect();
            let mut old_start = 0;
            let mut old_count = 1;
            let mut new_start = 0;
            let mut new_count = 1;

            if parts.len() >= 3 {
                let old_range = parts[1].strip_prefix('-').unwrap_or("0");
                let new_range = parts[2].strip_prefix('+').unwrap_or("0");

                if let Some(comma_idx) = old_range.find(',') {
                    old_start = old_range[..comma_idx].parse().unwrap_or(0);
                    old_count = old_range[comma_idx + 1..].parse().unwrap_or(1);
                } else {
                    old_start = old_range.parse().unwrap_or(0);
                }

                if let Some(comma_idx) = new_range.find(',') {
                    new_start = new_range[..comma_idx].parse().unwrap_or(0);
                    new_count = new_range[comma_idx + 1..].parse().unwrap_or(1);
                } else {
                    new_start = new_range.parse().unwrap_or(0);
                }
            }

            old_line_no = old_start;
            new_line_no = new_start;

            current_hunk = Some(DiffHunk {
                header,
                old_start,
                old_count,
                new_start,
                new_count,
                lines: Vec::new(),
            });
        } else if let Some(ref mut hunk) = current_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                hunk.lines.push(DiffLine {
                    r#type: "add".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: None,
                    new_line_no: Some(new_line_no),
                });
                new_line_no += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                hunk.lines.push(DiffLine {
                    r#type: "delete".to_string(),
                    content: line[1..].to_string(),
                    old_line_no: Some(old_line_no),
                    new_line_no: None,
                });
                old_line_no += 1;
            } else if line.starts_with(' ') {
                let content = line[1..].to_string();
                hunk.lines.push(DiffLine {
                    r#type: "context".to_string(),
                    content,
                    old_line_no: Some(old_line_no),
                    new_line_no: Some(new_line_no),
                });
                old_line_no += 1;
                new_line_no += 1;
            }
        }
    }

    if let Some(hunk) = current_hunk.take() {
        hunks.push(hunk);
    }

    (hunks, detected_status)
}

pub(crate) fn parse_name_status_z(s: &str) -> Vec<(String, String, Option<String>)> {
    let tokens: Vec<&str> = s.split('\0').filter(|t| !t.is_empty()).collect();
    let mut result: Vec<(String, String, Option<String>)> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let status_full = tokens[i];
        let letter = status_full.chars().next().unwrap_or('M').to_ascii_uppercase();
        if letter == 'R' || letter == 'C' {
            if i + 2 < tokens.len() {
                let old = tokens[i + 1].to_string();
                let new_path = tokens[i + 2].to_string();
                result.push((new_path, letter.to_string(), Some(old)));
                i += 3;
            } else {
                break;
            }
        } else {
            if i + 1 < tokens.len() {
                let new_path = tokens[i + 1].to_string();
                result.push((new_path, letter.to_string(), None));
                i += 2;
            } else {
                break;
            }
        }
    }
    result
}

pub(crate) fn parse_numstat_z(s: &str) -> HashMap<String, (u32, u32, bool)> {
    let tokens: Vec<&str> = s.split('\0').collect();
    let mut result: HashMap<String, (u32, u32, bool)> = HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        let head = tokens[i];
        if head.is_empty() {
            i += 1;
            continue;
        }
        let parts: Vec<&str> = head.splitn(3, '\t').collect();
        if parts.len() < 2 {
            i += 1;
            continue;
        }
        let adds_str = parts[0];
        let dels_str = parts[1];
        let binary = adds_str == "-" && dels_str == "-";
        let additions: u32 = if binary { 0 } else { adds_str.parse().unwrap_or(0) };
        let deletions: u32 = if binary { 0 } else { dels_str.parse().unwrap_or(0) };
        let path_part = if parts.len() >= 3 { parts[2] } else { "" };
        if path_part.is_empty() {
            let mut j = i + 1;
            let mut collected: Vec<&str> = Vec::new();
            while j < tokens.len() && collected.len() < 2 {
                if !tokens[j].is_empty() {
                    collected.push(tokens[j]);
                }
                j += 1;
            }
            if collected.len() == 2 {
                result.insert(collected[1].to_string(), (additions, deletions, binary));
                i = j;
            } else {
                break;
            }
        } else {
            result.insert(path_part.to_string(), (additions, deletions, binary));
            i += 1;
        }
    }
    result
}

pub(crate) fn folder_diff_args(ref_a: &str, ref_b: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let a = ref_a.trim();
    let b = ref_b.trim();
    if a.is_empty() && b.is_empty() {
        args.push("HEAD".to_string());
    } else if b.is_empty() {
        args.push(a.to_string());
    } else {
        args.push(a.to_string());
        args.push(b.to_string());
    }
    args
}

pub(crate) fn sort_node(node: &mut FolderDiffNode) {
    node.children.sort_by(|a, b| {
        let a_is_folder = a.kind == "folder";
        let b_is_folder = b.kind == "folder";
        match (a_is_folder, b_is_folder) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    for c in node.children.iter_mut() {
        sort_node(c);
    }
}

pub(crate) fn insert_segments(
    node: &mut FolderDiffNode,
    segments: &[&str],
    depth: usize,
    total_segments: usize,
    path_so_far: &str,
    change: &RawFileChange,
) {
    node.files_changed = node.files_changed.saturating_add(1);
    node.additions = node.additions.saturating_add(change.additions);
    node.deletions = node.deletions.saturating_add(change.deletions);

    if segments.is_empty() {
        if depth > 0 {
            node.status = Some(change.status.clone());
            node.old_path = change.old_path.clone();
            node.binary = change.binary;
            node.files_changed = 1;
        }
        return;
    }

    let seg = segments[0];
    let remaining = &segments[1..];
    let is_last_seg = remaining.is_empty();

    let full_path = if path_so_far.is_empty() {
        seg.to_string()
    } else {
        format!("{}/{}", path_so_far, seg)
    };

    let idx = match node.children.iter().position(|c| c.name == seg) {
        Some(i) => i,
        None => {
            node.children.push(FolderDiffNode {
                path: full_path.clone(),
                name: seg.to_string(),
                kind: if is_last_seg { "file".to_string() } else { "folder".to_string() },
                status: None,
                old_path: None,
                files_changed: 0,
                additions: 0,
                deletions: 0,
                binary: false,
                children: Vec::new(),
            });
            node.children.len() - 1
        }
    };

    let _ = total_segments;
    insert_segments(
        &mut node.children[idx],
        remaining,
        depth + 1,
        total_segments,
        &full_path,
        change,
    );
}

pub(crate) fn insert_change(root: &mut FolderDiffNode, change: &RawFileChange) {
    let segments: Vec<&str> = change.new_path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return;
    }
    let total = segments.len();
    insert_segments(root, &segments, 0, total, "", change);
}

pub(crate) fn parse_file_log_output(raw: &str) -> Vec<FileLogEntry> {
    let sep = "---END---";
    let mut entries = Vec::new();
    for block in raw.split(sep) {
        let trimmed = block.trim();
        if trimmed.is_empty() { continue; }
        let parts: Vec<&str> = trimmed.splitn(6, '\n').collect();
        if parts.len() < 5 { continue; }
        entries.push(FileLogEntry {
            hash_full: parts[0].trim().to_string(),
            hash: parts[1].trim().to_string(),
            author: parts[2].trim().to_string(),
            date: parts[3].trim().to_string(),
            message: parts[4].trim().to_string(),
            body: parts.get(5).map(|s| s.trim().to_string()).unwrap_or_default(),
        });
    }
    entries
}

pub(crate) fn gh_pr_detail_raw_to_detail(r: GhPrDetailRaw) -> PullRequestDetail {
    let comments = r.comments.len() as i64;
    let review_comments = r.reviews.len() as i64;
    let labels: Vec<String> = r.labels.into_iter().map(|l| l.name).collect();
    let reviewers: Vec<String> = r.review_requests
        .into_iter()
        .filter_map(|rr| rr.requested_reviewer?.login)
        .collect();
    let checks_status = {
        let mut has_failure = false;
        let mut has_pending = false;
        for c in &r.status_check_rollup {
            match c.conclusion.as_deref() {
                Some("FAILURE" | "ERROR") => has_failure = true,
                Some("PENDING" | "QUEUED" | "IN_PROGRESS") => has_pending = true,
                _ => {}
            }
        }
        if has_failure { "failure".to_string() }
        else if has_pending { "pending".to_string() }
        else if !r.status_check_rollup.is_empty() { "success".to_string() }
        else { "unknown".to_string() }
    };
    PullRequestDetail {
        number: r.number,
        title: r.title,
        body: r.body,
        state: r.state,
        author: r.author.login.unwrap_or_default(),
        branch: r.head_ref_name,
        base: r.base_ref_name,
        draft: r.is_draft,
        created_at: r.created_at,
        updated_at: r.updated_at,
        merged_at: r.merged_at.unwrap_or_default(),
        url: r.url,
        additions: r.additions,
        deletions: r.deletions,
        changed_files: r.changed_files,
        comments,
        review_comments,
        labels,
        reviewers,
        mergeable: r.mergeable.unwrap_or_default(),
        checks_status,
    }
}

pub(crate) fn parse_gh_pr_json(json: &str) -> Result<Vec<PullRequest>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(Vec::new());
    }
    // Two-pass tolerant parse: parse to Vec<Value> first so a single
    // malformed PR (e.g. null `author` for a deleted user or a GitHub App
    // that doesn't expose `.login`) doesn't drop the entire list.
    let values: Vec<serde_json::Value> = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse gh pr list output: {}", e))?;
    let mut out = Vec::with_capacity(values.len());
    for v in values {
        match serde_json::from_value::<GhPrRaw>(v.clone()) {
            Ok(raw) => out.push(gh_pr_raw_to_pr(raw)),
            Err(e) => {
                let number = v.get("number").and_then(|n| n.as_i64()).unwrap_or(-1);
                eprintln!(
                    "[parse_gh_pr_json] skipping PR #{}: {}",
                    number, e
                );
            }
        }
    }
    Ok(out)
}

pub(crate) fn gh_pr_raw_to_pr(r: GhPrRaw) -> PullRequest {
    let review_requested = r.review_requests
        .into_iter()
        .filter_map(|rr| rr.requested_reviewer?.login)
        .collect();
    let checks_rollup = r.status_check_rollup
        .into_iter()
        .filter_map(|c| c.conclusion)
        .next()
        .unwrap_or_default();
    let comment_count = r.comments.len() as i64;
    let author = r
        .author
        .and_then(|a| a.login)
        .unwrap_or_default();
    PullRequest {
        number: r.number,
        title: r.title,
        state: r.state,
        author,
        branch: r.head_ref_name,
        base: r.base_ref_name,
        draft: r.is_draft,
        created_at: r.created_at,
        updated_at: r.updated_at,
        url: r.url,
        additions: r.additions,
        deletions: r.deletions,
        labels: r.labels.into_iter().map(|l| l.name).collect(),
        assignees: r
            .assignees
            .into_iter()
            .filter_map(|a| a.login)
            .collect(),
        review_requested,
        review_decision: r.review_decision.unwrap_or_default(),
        merge_state_status: r.merge_state_status.unwrap_or_default(),
        checks_rollup,
        comment_count,
    }
}

pub(crate) fn parse_remote_owner_repo(url: &str) -> (String, String) {
    if let Some(colon_pos) = url.find(':') {
        if url.starts_with("git@") {
            let path = &url[colon_pos + 1..];
            let clean = path.trim_end_matches(".git");
            let parts: Vec<&str> = clean.splitn(2, '/').collect();
            if parts.len() == 2 {
                return (parts[0].to_string(), parts[1].to_string());
            }
        }
    }
    if let Some(host_end) = url.find("://") {
        let path = &url[host_end + 3..];
        if let Some(slash_pos) = path.find('/') {
            let clean = path[slash_pos + 1..].trim_end_matches(".git");
            let parts: Vec<&str> = clean.splitn(2, '/').collect();
            if parts.len() == 2 {
                return (parts[0].to_string(), parts[1].to_string());
            }
        }
    }
    (String::new(), String::new())
}

pub(crate) fn parse_gh_issue_json(json: &str) -> Result<Vec<Issue>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(Vec::new());
    }
    let raws: Vec<GhIssueRaw> = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse gh issue list output: {}", e))?;
    Ok(raws.into_iter().map(|r| Issue {
        number: r.number,
        title: r.title,
        state: r.state,
        author: r.author.login,
        assignees: r.assignees.into_iter().map(|a| a.login).collect(),
        labels: r.labels.into_iter().map(|l| l.name).collect(),
        url: r.url,
        created_at: r.created_at,
        updated_at: r.updated_at,
        milestone: r.milestone.map(|m| m.title).unwrap_or_default(),
    }).collect())
}

pub(crate) fn parse_shortlog_line(line: &str) -> Option<ShortlogEntry> {
    let trimmed = line.trim_start();
    let (count_str, rest) = trimmed.split_once('\t')?;
    let count = count_str.trim().parse::<u32>().ok()?;
    let rest = rest.trim();
    let lt = rest.rfind('<')?;
    let gt = rest.rfind('>')?;
    if gt <= lt {
        return None;
    }
    let name = rest[..lt].trim().to_string();
    let email = rest[lt + 1..gt].to_string();
    Some(ShortlogEntry { name, email, count })
}

#[allow(dead_code)]
pub(crate) fn parse_wip_status(output: &str) -> (u32, u32, u32) {
    let mut staged = 0u32;
    let mut unstaged = 0u32;
    let mut untracked = 0u32;
    for line in output.lines() {
        if line.len() < 2 {
            continue;
        }
        let x = &line[0..1];
        let y = &line[1..2];
        if x == "?" && y == "?" {
            untracked += 1;
        } else {
            if x != " " && x != "?" && x != "!" {
                staged += 1;
            }
            if y != " " && y != "?" && y != "!" {
                unstaged += 1;
            }
        }
    }
    (staged, unstaged, untracked)
}

pub(crate) fn find_json_key_value_start(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{}\"", key);
    let key_pos = json.find(&search)?;
    let after_key = &json[key_pos + search.len()..];
    let colon_pos = after_key.find(':')?;
    let value_start = after_key[colon_pos + 1..].trim_start();

    if !value_start.starts_with('{') {
        return None;
    }

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape_next = false;
    let mut end = 0usize;

    for (i, c) in value_start.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        match c {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    end = i + 1;
                    break;
                }
            }
            _ => {}
        }
    }

    if end > 0 {
        Some(value_start[..end].to_string())
    } else {
        None
    }
}

pub(crate) fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let pos = json.find(&needle)?;
    let rest = &json[pos + needle.len()..];
    let colon = rest.find(':')?;
    let after_colon = rest[colon + 1..].trim_start();
    if !after_colon.starts_with('"') {
        return None;
    }
    let value_start = 1;
    let value_end = after_colon[value_start..].find('"')?;
    Some(after_colon[value_start..value_start + value_end].to_string())
}

pub(crate) fn guess_mime_from_ext(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

pub(crate) fn repo_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    if trimmed.is_empty() {
        return None;
    }
    let last = trimmed.rsplit(['/', ':']).next()?;
    if last.is_empty() {
        None
    } else {
        Some(last.to_string())
    }
}

pub(crate) fn find_workspace_packages(cwd: &str, config_content: &str, manager: &str) -> Vec<MonorepoPackage> {
    let mut globs: Vec<String> = Vec::new();

    if manager == "pnpm" {
        for line in config_content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("- ") {
                let pattern = trimmed[2..].trim().trim_matches('\'').trim_matches('"');
                globs.push(pattern.to_string());
            }
        }
    } else {
        if let Some(start) = config_content.find("\"workspaces\"") {
            let rest = &config_content[start..];
            if let Some(arr_start) = rest.find('[') {
                if let Some(arr_end) = rest[arr_start..].find(']') {
                    let arr = &rest[arr_start + 1..arr_start + arr_end];
                    for item in arr.split(',') {
                        let pattern = item.trim().trim_matches('"').trim_matches('\'');
                        if !pattern.is_empty() {
                            globs.push(pattern.to_string());
                        }
                    }
                }
            }
        }
    }

    let cwd_path = std::path::Path::new(cwd);
    let mut packages = Vec::new();

    for pattern in &globs {
        let base_pattern = pattern.replace("/*", "").replace("/**", "");
        let base_dir = cwd_path.join(&base_pattern);
        if base_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&base_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let pkg_json_path = path.join("package.json");
                    if pkg_json_path.exists() {
                        if let Ok(pkg_content) = std::fs::read_to_string(&pkg_json_path) {
                            let name = extract_json_string(&pkg_content, "name")
                                .unwrap_or_else(|| entry.file_name().to_string_lossy().to_string());
                            let version = extract_json_string(&pkg_content, "version")
                                .unwrap_or_else(|| "0.0.0".to_string());
                            let rel_path = path.strip_prefix(cwd_path)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_else(|_| path.to_string_lossy().to_string());
                            packages.push(MonorepoPackage { name, path: rel_path, version });
                        }
                    }
                }
            }
        }
    }

    packages.sort_by(|a, b| a.name.cmp(&b.name));
    packages
}

pub(crate) fn read_git_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

pub(crate) fn read_git_u32(path: &Path) -> u32 {
    read_git_file(path).and_then(|s| s.parse().ok()).unwrap_or(0)
}

pub(crate) fn has_unresolved_conflicts(cwd: &str) -> bool {
    git_cmd()
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| matches!(l.get(..2), Some("UU" | "AA" | "UD" | "DU" | "AU" | "UA")))
        })
        .unwrap_or(false)
}
