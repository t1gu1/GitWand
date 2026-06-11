//! Shared curl transport helpers for the forge command modules.

use crate::git::hidden_cmd;
use std::io::Write;

/// Build curl `--config -` file contents for an `Authorization` header,
/// keeping the credential off the process argv.
///
/// `scheme` is e.g. `"Bearer"` or `"Basic"`, `credential` is the pre-encoded
/// token or base64 value. Callers that need Basic auth should base64-encode
/// `"user:pass"` before passing it here.
pub(crate) fn auth_header_config(scheme: &str, credential: &str) -> String {
    format!("header = \"Authorization: {} {}\"\n", scheme, credential)
}

/// Build a Bearer-token curl config-file string.
pub(crate) fn bearer_config(tok: &str) -> String {
    auth_header_config("Bearer", tok)
}

/// Spawn `curl` with `args`, feeding `stdin_config` to its stdin when
/// provided (used with `--config -` so secrets stay off argv).
pub(crate) fn run_curl(
    args: &[String],
    stdin_config: Option<&str>,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;
    let mut cmd = hidden_cmd("curl");
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(match stdin_config {
            Some(_) => Stdio::piped(),
            None    => Stdio::null(),
        });
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("curl not found or failed to spawn: {}", e))?;
    if let Some(cfg) = stdin_config {
        // Config is tiny; curl drains stdin before producing output, so a
        // synchronous write here can't deadlock against the stdout pipe.
        child
            .stdin
            .take()
            .ok_or_else(|| "failed to open curl stdin".to_string())?
            .write_all(cfg.as_bytes())
            .map_err(|e| format!("failed to write curl config: {}", e))?;
    }
    child
        .wait_with_output()
        .map_err(|e| format!("curl failed: {}", e))
}

/// Execute a curl request and return `(http_status, body_text)`.
///
/// Appends `-w "\n__GW_HTTP_STATUS__%{http_code}"` so the HTTP status is
/// extracted from the output without a second request. `auth_config`, when
/// present, is fed to curl via `--config -` (stdin) so secrets stay off argv.
/// `extra_headers` carries forge-specific static headers (e.g. `User-Agent`,
/// API-version headers). `accept` is the MIME type for the `Accept` header.
pub(crate) fn curl_with_status(
    method: &str,
    url: &str,
    auth_config: Option<&str>,
    body_json: Option<&str>,
    extra_headers: &[&str],
    accept: &str,
) -> Result<(i32, String), String> {
    const MARKER: &str = "\n__GW_HTTP_STATUS__";
    let mut args: Vec<String> = vec![
        "-s".to_string(),
        "-X".to_string(), method.to_string(),
        "-H".to_string(), format!("Accept: {}", accept),
    ];
    for h in extra_headers {
        args.push("-H".to_string());
        args.push(h.to_string());
    }
    if auth_config.is_some() {
        args.push("--config".to_string());
        args.push("-".to_string());
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

    let output = run_curl(&args, auth_config)?;
    // Consume the Vec<u8> in-place — zero copy on the valid-UTF-8 fast path.
    let combined = String::from_utf8(output.stdout)
        .map_err(|e| format!("curl returned invalid UTF-8: {}", e))?;
    let (body, status) = match combined.rsplit_once(MARKER) {
        Some((b, s)) => (b.to_string(), s.trim().parse::<i32>().unwrap_or(0)),
        None => (combined, 0),
    };
    Ok((status, body))
}
