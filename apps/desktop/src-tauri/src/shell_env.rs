//! macOS login-shell environment preload at app startup.
//!
//! ## Why this exists
//!
//! On macOS, GUI apps launched from Finder/Dock/Spotlight inherit a minimal
//! environment from `launchd`:
//!   - `PATH=/usr/bin:/bin:/usr/sbin:/sbin`
//!   - `HOME`, `USER`, `TMPDIR`
//!   - **Nothing from `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, etc.**
//!
//! This breaks subprocess like `gh`, `claude`, `codex`, `pnpm`, `node` for
//! users whose tooling depends on shell-rc-set variables: `SSH_AUTH_SOCK`,
//! `XDG_CONFIG_HOME`, `LANG`/`LC_ALL`, `GH_TOKEN`/`GITHUB_TOKEN`, custom
//! `PATH` prefixes (asdf, mise, nvm), and `nix-darwin` exports.
//!
//! Symptom in v2.8.x: `gh pr list` from Tauri hangs ≥30s while the same
//! command runs in ~1s from the user's terminal. Root cause: `gh`'s
//! credential resolution chain falls back to the macOS keychain when other
//! auth paths (env-var token, gh-config token) are unavailable, and the
//! keychain prompt fired from a launchd-spawned subprocess often hangs
//! silently or retries indefinitely without surfacing a UI dialog.
//!
//! This is the same pattern VS Code, Sublime Text, IntelliJ, and most
//! macOS-savvy GUI dev tools handle via "shell environment detection".
//!
//! ## What this module does
//!
//! Spawn `$SHELL -l -c env` once at startup (bounded by a 3s timeout),
//! parse its output, and propagate everything-not-already-set into the
//! current process env. Subsequent subprocess (`Command::new`) inherit
//! the enriched env automatically.
//!
//! - `PATH` is **not** overwritten — `hidden_cmd` in `git/cmd.rs` does its
//!   own PATH enrichment with the Homebrew prefixes for predictability;
//!   we don't want shell-rc PATH changes to defeat that.
//! - `PWD`, `OLDPWD`, `SHLVL`, `_` are skipped — these are shell-local
//!   and meaningless once propagated.
//! - On Linux/Windows this is a no-op. Linux distros launch GUI apps with
//!   the full session env most of the time; Windows installs always have
//!   the user env (HKCU\Environment).

#[cfg(target_os = "macos")]
pub(crate) fn init_login_shell_env() {
    use std::sync::mpsc;
    use std::time::Duration;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Spawn the shell read on a separate thread so we can bound it with a
    // recv_timeout. A misbehaving rc file that hangs forever shouldn't
    // freeze app startup — we just skip the enrichment and continue.
    let (tx, rx) = mpsc::channel();
    let shell_for_thread = shell.clone();
    std::thread::spawn(move || {
        let output = std::process::Command::new(&shell_for_thread)
            .args(["-l", "-c", "env"])
            .output();
        let _ = tx.send(output);
    });

    let output = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            eprintln!("[gitwand] login shell `{}` failed to spawn: {}", shell, e);
            return;
        }
        Err(_) => {
            eprintln!(
                "[gitwand] login shell `{} -l -c env` timed out (3s) — \
                 continuing with minimal launchd env",
                shell
            );
            return;
        }
    };

    if !output.status.success() {
        eprintln!(
            "[gitwand] `{} -l -c env` exit non-zero: {}",
            shell,
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return;
    }

    let env_str = String::from_utf8_lossy(&output.stdout);
    let mut imported = 0usize;
    let mut skipped_existing = 0usize;

    for line in env_str.lines() {
        let Some((key, value)) = line.split_once('=') else {
            // Skip lines that aren't KEY=VALUE (multi-line values are rare
            // in `env` output but possible — we conservatively skip).
            continue;
        };
        if key.is_empty() || key.contains('\0') {
            continue;
        }
        // Shell-local noise that should not be propagated.
        if matches!(key, "PWD" | "OLDPWD" | "SHLVL" | "_" | "SHELL") {
            continue;
        }
        // PATH is owned by `hidden_cmd` — don't let the shell rc override
        // the Homebrew enrichment logic.
        if key == "PATH" {
            continue;
        }
        // Don't overwrite anything launchd already set (HOME, USER, TMPDIR).
        if std::env::var(key).is_ok() {
            skipped_existing += 1;
            continue;
        }
        std::env::set_var(key, value);
        imported += 1;
    }

    eprintln!(
        "[gitwand] login shell env: imported {} vars, skipped {} already-set",
        imported, skipped_existing
    );

    // ─── GH_TOKEN extraction ─────────────────────────────────────
    //
    // Even with the full shell env, `gh` subprocess from a signed Tauri
    // app may hang on macOS keychain access: the keychain ACL treats
    // GitWand.app as a different application than iTerm/Terminal, and
    // the `security` helper (called by gh to retrieve the token) silently
    // waits for an authorization dialog that never gets focus.
    //
    // Workaround: run `gh auth token` once from a login shell (where the
    // keychain ACL works because the shell has been granted access
    // historically), capture the token, and inject as `GH_TOKEN` env var.
    // gh subprocess from Tauri then bypasses the keychain entirely.
    //
    // No-op if GH_TOKEN is already set (user explicitly exported it) or
    // if gh isn't installed / not authenticated. Failure is silent —
    // gh subprocess will still try keychain and fail cleanly, but we
    // don't want to fail app startup on this.
    if std::env::var("GH_TOKEN").is_err() && std::env::var("GITHUB_TOKEN").is_err() {
        extract_gh_token(&shell);
    }
}

/// Spawn `$SHELL -l -c "gh auth token"` and propagate the result as `GH_TOKEN`.
/// Bounded by a 3s timeout. Silent on any failure path.
#[cfg(target_os = "macos")]
fn extract_gh_token(shell: &str) {
    use std::sync::mpsc;
    use std::time::Duration;

    let (tx, rx) = mpsc::channel();
    let shell_for_thread = shell.to_string();
    std::thread::spawn(move || {
        let output = std::process::Command::new(&shell_for_thread)
            .args(["-l", "-c", "gh auth token 2>/dev/null"])
            .output();
        let _ = tx.send(output);
    });

    let output = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(o)) => o,
        Ok(Err(_)) | Err(_) => {
            eprintln!("[gitwand] gh auth token preload skipped (timeout or spawn error)");
            return;
        }
    };

    if !output.status.success() {
        // gh not installed, not authenticated, or some other issue —
        // no log noise, gh subprocess will surface its own error later.
        return;
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() || !token.starts_with("gh") {
        // Sanity check: gh tokens start with `gho_`, `ghp_`, `ghs_`, etc.
        // If the output isn't a token (auth error, weird shell init), skip.
        return;
    }

    std::env::set_var("GH_TOKEN", &token);
    eprintln!("[gitwand] GH_TOKEN preloaded from login shell (length={})", token.len());
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn init_login_shell_env() {
    // Linux/Windows: launchers (Gnome/KDE session manager, explorer.exe,
    // the systemd user instance, etc.) typically already provide the full
    // user env. No preload needed.
}
