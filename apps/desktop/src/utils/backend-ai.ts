// backend-ai.ts — Claude Code CLI and Codex CLI wrappers.
// Extracted from backend.ts as part of the v2.11 backend split to keep module size manageable.
// Consumers should import directly from this file instead of backend.ts for these symbols.

import { isTauri, tauriInvoke, devFetch, DEV_SERVER, IPC_TIMEOUT } from "./backend-core";

// ─── Claude Code CLI wrapper ─────────────────────────────
//
// Thin wrappers around the Rust/dev-server commands that shell out to the
// user's locally-installed `claude` binary (official Claude Code CLI).
// This is how we piggyback on the user's Max/Pro subscription without
// implementing OAuth ourselves — same trick as Solo / SoloTerm.

export interface ClaudeCliInfo {
  /** True when the `claude` binary was found on disk. */
  found: boolean;
  /** Absolute path to the binary, or "" if not found. */
  path: string;
  /** Raw `claude --version` output. */
  version: string;
  /** True if a ping prompt answered without an auth error. */
  logged_in: boolean;
  /** Machine-readable status: "ok" | "not_found" | "not_logged_in" | "error". */
  status: "ok" | "not_found" | "not_logged_in" | "error" | string;
  /** Optional error detail line. */
  detail: string;
}

/**
 * Detect whether the Claude Code CLI is installed and authenticated.
 * Safe to call on app boot — returns `found: false` instead of throwing
 * when the binary is missing.
 */
export async function detectClaudeCli(): Promise<ClaudeCliInfo> {
  if (isTauri()) {
    return tauriInvoke<ClaudeCliInfo>("detect_claude_cli");
  }
  try {
    const res = await devFetch(`${DEV_SERVER}/api/claude-cli-detect`);
    if (res.ok) return (await res.json()) as ClaudeCliInfo;
  } catch {
    // Dev server unavailable
  }
  return {
    found: false,
    path: "",
    version: "",
    logged_in: false,
    status: "not_found",
    detail: "",
  };
}

/**
 * Run a prompt through the local Claude Code CLI.
 *
 * @param prompt User prompt (main content).
 * @param systemPrompt Optional system-level instructions (prepended as a
 *                     `# System` section since `claude -p` has no separate
 *                     system channel).
 * @param cwd Optional working directory for the CLI process.
 * @param outputFormat "text" (default) or "json".
 * @returns Raw stdout from the CLI.
 */
export async function claudeCliPrompt(
  prompt: string,
  systemPrompt?: string,
  cwd?: string,
  outputFormat: "text" | "json" = "text",
): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>("claude_cli_prompt", {
      prompt,
      systemPrompt,
      cwd,
      outputFormat,
    }, IPC_TIMEOUT.NONE);
  }
  const res = await devFetch(`${DEV_SERVER}/api/claude-cli-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, systemPrompt, cwd, outputFormat }),
  });
  if (!res.ok) {
    let msg = `claude CLI error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return await res.text();
}

// ─── Codex CLI provider (v2.0) ─────────────────────────────
// Mirrors the Claude CLI shape — same struct, different binary. Codex CLI
// uses `codex exec "<prompt>"` for non-interactive runs and authenticates
// via OAuth (`codex login`) or `OPENAI_API_KEY`.

export interface CodexCliInfo {
  found: boolean;
  path: string;
  version: string;
  logged_in: boolean;
  status: "ok" | "not_found" | "not_logged_in" | "error" | string;
  detail: string;
}

/**
 * Detect whether the OpenAI Codex CLI is installed and authenticated.
 * Safe to call on app boot.
 */
export async function detectCodexCli(): Promise<CodexCliInfo> {
  if (isTauri()) {
    return tauriInvoke<CodexCliInfo>("detect_codex_cli");
  }
  try {
    const res = await devFetch(`${DEV_SERVER}/api/codex-cli-detect`);
    if (res.ok) return (await res.json()) as CodexCliInfo;
  } catch {
    // Dev server unavailable
  }
  return {
    found: false,
    path: "",
    version: "",
    logged_in: false,
    status: "not_found",
    detail: "",
  };
}

/**
 * Run a prompt through the local Codex CLI (`codex exec`).
 */
export async function codexCliPrompt(
  prompt: string,
  systemPrompt?: string,
  cwd?: string,
): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>("codex_cli_prompt", {
      prompt,
      systemPrompt,
      cwd,
    }, IPC_TIMEOUT.NONE);
  }
  const res = await devFetch(`${DEV_SERVER}/api/codex-cli-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, systemPrompt, cwd }),
  });
  if (!res.ok) {
    let msg = `codex CLI error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return await res.text();
}

/**
 * Open the native terminal with `claude login` so the user can complete
 * the OAuth-style setup. Not a PTY integration — just a one-shot bootstrap.
 */
export async function claudeCliLogin(): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("claude_cli_login");
    return;
  }
  const res = await devFetch(`${DEV_SERVER}/api/claude-cli-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    let msg = `claude login failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
}
