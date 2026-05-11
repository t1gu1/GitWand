//! AI CLI provider Tauri commands (§3.4f migration).
//!
//! Wraps two external CLIs:
//!   - Anthropic's Claude Code (`claude`) — OAuth-via-subscription auth
//!   - OpenAI's Codex (`codex`) — OAuth via ChatGPT or `OPENAI_API_KEY`
//!
//! Both providers expose the same shape of commands:
//!   - `detect_*_cli` — find the binary, query version, ping to test auth
//!   - `*_cli_prompt` — run a one-shot prompt and return the response
//!
//! Plus a Claude-specific `claude_cli_login` that opens the user's native
//! terminal so they can complete the OAuth dance interactively.
//!
//! No PTY. These are one-shot non-interactive prompts; the CLI flush
//! stdout when done and we just collect it.

use crate::git::*;
use crate::types::*;
use std::path::PathBuf;

// ─── Claude binary resolution + env hygiene ──────────────────────────────

/// Apply the API-key env strip to a `std::process::Command` before spawning.
///
/// When the user explicitly picks the "Claude Code CLI" provider in GitWand,
/// they've asked to use their Max/Pro subscription. Stale `ANTHROPIC_API_KEY`
/// or similar env vars in the shell would hijack the call back to API-key
/// auth — strip them so the OAuth session takes precedence.
fn strip_claude_auth_env(cmd: &mut std::process::Command) {
    for var in CLAUDE_AUTH_OVERRIDE_ENV {
        cmd.env_remove(var);
    }
}

/// Resolve the path to the `claude` binary, checking the usual install
/// locations on macOS / Linux / Windows in addition to PATH.
fn resolve_claude_binary() -> Option<String> {
    // 1) Try PATH first via `which` / `where`.
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = hidden_cmd(which_cmd).arg("claude").output() {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            let first = raw.lines().next().unwrap_or("").trim();
            if !first.is_empty() && std::path::Path::new(first).exists() {
                return Some(first.to_string());
            }
        }
    }

    // 2) Fall back to common install locations.
    let home = dirs::home_dir();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = home.as_ref() {
        candidates.push(h.join(".claude/local/claude"));
        candidates.push(h.join(".local/bin/claude"));
        candidates.push(h.join(".npm-global/bin/claude"));
        // Windows npm global
        candidates.push(h.join("AppData/Roaming/npm/claude.cmd"));
        candidates.push(h.join("AppData/Roaming/npm/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.push(PathBuf::from("/usr/bin/claude"));

    for c in candidates {
        if c.exists() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

// ─── Codex binary resolution ─────────────────────────────────────────────

fn resolve_codex_binary() -> Option<String> {
    // 1) PATH first
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = hidden_cmd(which_cmd).arg("codex").output() {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            let first = raw.lines().next().unwrap_or("").trim();
            if !first.is_empty() && std::path::Path::new(first).exists() {
                return Some(first.to_string());
            }
        }
    }

    // 2) Common npm install locations
    let home = dirs::home_dir();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = home.as_ref() {
        candidates.push(h.join(".local/bin/codex"));
        candidates.push(h.join(".npm-global/bin/codex"));
        candidates.push(h.join("AppData/Roaming/npm/codex.cmd"));
        candidates.push(h.join("AppData/Roaming/npm/codex"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));
    candidates.push(PathBuf::from("/usr/bin/codex"));

    for c in candidates {
        if c.exists() {
            return Some(c.to_string_lossy().to_string());
        }
    }
    None
}

// ─── Claude commands ─────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn detect_claude_cli() -> Result<ClaudeCliInfo, String> {
    let binary = match resolve_claude_binary() {
        Some(b) => b,
        None => {
            return Ok(ClaudeCliInfo {
                found: false,
                path: String::new(),
                version: String::new(),
                logged_in: false,
                status: "not_found".to_string(),
                detail: "Binaire `claude` introuvable. Installez-le avec `npm install -g @anthropic-ai/claude-code`."
                    .to_string(),
            });
        }
    };

    // Query version
    let version = hidden_cmd(&binary)
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    // Ping with a tiny prompt to check auth. Timeout is enforced by the
    // caller via the Tauri command; here we just run synchronously with a
    // short output cap. The CLI exits non-zero when auth is missing.
    //
    // We strip API-key env vars here too so the detection reflects the
    // actual OAuth-session state that prompts will use — otherwise a stale
    // `ANTHROPIC_API_KEY` in the shell would mask the real auth status.
    let mut ping_cmd = hidden_cmd(&binary);
    ping_cmd.args(["-p", "ping", "--output-format", "text"]);
    strip_claude_auth_env(&mut ping_cmd);
    let ping = ping_cmd.output();

    match ping {
        Ok(out) if out.status.success() => Ok(ClaudeCliInfo {
            found: true,
            path: binary,
            version,
            logged_in: true,
            status: "ok".to_string(),
            detail: String::new(),
        }),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let combined = if stderr.is_empty() { stdout } else { stderr };
            let lower = combined.to_lowercase();
            let looks_like_auth = lower.contains("login")
                || lower.contains("authenticat")
                || lower.contains("unauthor")
                || lower.contains("api key");
            Ok(ClaudeCliInfo {
                found: true,
                path: binary,
                version,
                logged_in: false,
                status: if looks_like_auth { "not_logged_in" } else { "error" }.to_string(),
                detail: combined,
            })
        }
        Err(e) => Ok(ClaudeCliInfo {
            found: true,
            path: binary,
            version,
            logged_in: false,
            status: "error".to_string(),
            detail: format!("Impossible d'exécuter `claude`: {}", e),
        }),
    }
}

/// Run `claude -p <prompt>` and return stdout.
///
/// The CLI already handles auth via the user's subscription — we just pipe
/// text in and get text back.
#[tauri::command]
pub(crate) fn claude_cli_prompt(
    prompt: String,
    system_prompt: Option<String>,
    cwd: Option<String>,
    output_format: Option<String>,
) -> Result<String, String> {
    let binary = resolve_claude_binary()
        .ok_or_else(|| "Binaire `claude` introuvable".to_string())?;

    // Compose the full prompt: if a system prompt is provided, prepend it
    // as a Markdown-delimited section. `claude -p` doesn't expose a separate
    // system/user channel, so this is the simplest portable shape.
    let full_prompt = match system_prompt {
        Some(sys) if !sys.trim().is_empty() => {
            format!(
                "# System\n{}\n\n# User\n{}",
                sys.trim(),
                prompt.trim()
            )
        }
        _ => prompt,
    };

    let fmt = output_format.unwrap_or_else(|| "text".to_string());

    let mut cmd = hidden_cmd(&binary);
    cmd.args(["-p", &full_prompt, "--output-format", &fmt]);
    strip_claude_auth_env(&mut cmd);
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "Claude CLI a échoué sans message".to_string()
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ─── Codex commands ──────────────────────────────────────────────────────
//
// OpenAI Codex CLI integration — mirrors the Claude Code CLI flow but
// shells out to `codex exec "<prompt>"` instead of `claude -p`. `codex
// exec` is the official non-interactive entry point (the REPL-style
// `codex` without subcommand would hang waiting for user input). No
// `--quiet` flag — it doesn't exist on `codex exec` and adding one
// fails with `unexpected argument '--quiet'`.
//
// Auth: either OAuth via `codex login` (uses ChatGPT subscription) or
// `OPENAI_API_KEY` env var. The CLI surfaces a clear error at first call
// when neither is set, so detection matches the Claude pattern: tiny ping
// prompt that exits 0 when auth works.

#[tauri::command]
pub(crate) fn detect_codex_cli() -> Result<CodexCliInfo, String> {
    let binary = match resolve_codex_binary() {
        Some(b) => b,
        None => {
            return Ok(CodexCliInfo {
                found: false,
                path: String::new(),
                version: String::new(),
                logged_in: false,
                status: "not_found".to_string(),
                detail: "Binaire `codex` introuvable. Installez-le avec `npm install -g @openai/codex`."
                    .to_string(),
            });
        }
    };

    let version = hidden_cmd(&binary)
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    // Lightweight ping. The CLI exits non-zero if auth (OAuth session or
    // OPENAI_API_KEY) is missing, with stderr describing the problem.
    let ping = hidden_cmd(&binary)
        .args(["exec", "ping"])
        .output();

    match ping {
        Ok(out) if out.status.success() => Ok(CodexCliInfo {
            found: true,
            path: binary,
            version,
            logged_in: true,
            status: "ok".to_string(),
            detail: String::new(),
        }),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let combined = if stderr.is_empty() { stdout } else { stderr };
            let lower = combined.to_lowercase();
            let looks_like_auth = lower.contains("login")
                || lower.contains("authenticat")
                || lower.contains("unauthor")
                || lower.contains("api key")
                || lower.contains("openai_api_key");
            Ok(CodexCliInfo {
                found: true,
                path: binary,
                version,
                logged_in: false,
                status: if looks_like_auth {
                    "not_logged_in"
                } else {
                    "error"
                }
                .to_string(),
                detail: combined,
            })
        }
        Err(e) => Ok(CodexCliInfo {
            found: true,
            path: binary,
            version,
            logged_in: false,
            status: "error".to_string(),
            detail: format!("Impossible d'exécuter `codex`: {}", e),
        }),
    }
}

#[tauri::command]
pub(crate) fn codex_cli_prompt(
    prompt: String,
    system_prompt: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let binary = resolve_codex_binary()
        .ok_or_else(|| "Binaire `codex` introuvable".to_string())?;

    // Codex CLI doesn't expose separate system/user channels; prepend the
    // system prompt as a Markdown section, same shape as the Claude flow.
    let full_prompt = match system_prompt {
        Some(sys) if !sys.trim().is_empty() => {
            format!("# System\n{}\n\n# User\n{}", sys.trim(), prompt.trim())
        }
        _ => prompt,
    };

    let mut cmd = hidden_cmd(&binary);
    cmd.args(["exec", &full_prompt]);
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run codex CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(if detail.is_empty() {
            "Codex CLI a échoué sans message".to_string()
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ─── Claude OAuth login (opens a native terminal) ────────────────────────

/// Launch `claude login` in the user's native terminal emulator. We don't
/// embed a PTY because this is a one-shot setup flow: the user validates
/// in their browser and comes back to GitWand.
#[tauri::command]
pub(crate) fn claude_cli_login() -> Result<(), String> {
    let binary = resolve_claude_binary()
        .ok_or_else(|| "Binaire `claude` introuvable. Installez-le d'abord.".to_string())?;

    #[cfg(target_os = "macos")]
    {
        // Open Terminal.app with the login command. `osascript` keeps the
        // window focused so the user sees the OAuth prompt in the browser
        // that Claude Code opens automatically.
        let script = format!(
            "tell application \"Terminal\" to do script \"{} login\"",
            binary.replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // cmd /k keeps the window open after login completes so the user
        // can read any status message.
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("\"{}\" login", binary)])
            .spawn()
            .map_err(|e| format!("Failed to open cmd: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Try the common Linux terminal emulators in order of popularity.
        // Each entry's last slot is where the shell command gets appended.
        let candidates: [&[&str]; 6] = [
            &["gnome-terminal", "--", "sh", "-c"],
            &["konsole", "-e", "sh", "-c"],
            &["xfce4-terminal", "-e"],
            &["kitty", "sh", "-c"],
            &["alacritty", "-e", "sh", "-c"],
            &["x-terminal-emulator", "-e", "sh", "-c"],
        ];
        let inner = format!("{} login; echo; read -p 'Press enter to close...'", binary);
        for args in candidates.iter() {
            let (prog, rest) = args.split_first().unwrap();
            let mut cmd = std::process::Command::new(prog);
            for a in rest.iter() {
                cmd.arg(a);
            }
            cmd.arg(&inner);
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(
            "Aucun terminal compatible trouvé. Ouvrez un terminal et tapez: claude login"
                .to_string(),
        );
    }

    #[allow(unreachable_code)]
    Err("Plateforme non supportée".to_string())
}
