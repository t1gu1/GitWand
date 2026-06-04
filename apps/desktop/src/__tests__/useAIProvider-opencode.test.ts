/**
 * v2.17 — opencode provider + per-provider model picker.
 *
 * Covers the two pieces the feature introduces in `useAIProvider`:
 *
 *   1. `modelForProvider` / `listModelsForProvider` — the model-selection
 *      helpers backing the Settings second select. CLI agents are model-
 *      scoped via `aiModelByProvider`; opencode enumerates dynamically,
 *      Claude Code advertises curated aliases, Codex falls back to free text.
 *
 *   2. Provider dispatch in `rawPrompt()` — the opencode-cli case must route
 *      to `opencodeCliPrompt`, and all three CLI agents must forward the
 *      per-provider model string to their respective backend wrapper.
 *
 * We mock `../utils/backend` so no Tauri / dev-server call is made and assert
 * on the exact arguments each CLI wrapper receives.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the backend CLI wrappers ─────────────────────────────
const claudeCliPrompt = vi.fn(async () => "ok-claude");
const codexCliPrompt = vi.fn(async () => "ok-codex");
const opencodeCliPrompt = vi.fn(async () => "ok-opencode");
const listOpencodeModels = vi.fn(async () => ["anthropic/claude-x", "openai/gpt-y"]);
// useAIProvider runs `detectClaudeCli()` once at module load — keep the
// auto-fallback disabled so it never hijacks the explicit provider.
const detectClaudeCli = vi.fn(async () => ({
  found: false,
  path: "",
  version: "",
  logged_in: false,
  status: "not_found",
  detail: "",
}));

vi.mock("../utils/backend", () => ({
  claudeCliPrompt: (...a: unknown[]) => claudeCliPrompt(...(a as [])),
  codexCliPrompt: (...a: unknown[]) => codexCliPrompt(...(a as [])),
  opencodeCliPrompt: (...a: unknown[]) => opencodeCliPrompt(...(a as [])),
  listOpencodeModels: () => listOpencodeModels(),
  detectClaudeCli: () => detectClaudeCli(),
}));

import {
  useAIProvider,
  modelForProvider,
  listModelsForProvider,
  CLAUDE_CODE_MODELS,
  type AISettings,
} from "../composables/useAIProvider";

function setSettings(partial: Record<string, unknown>) {
  localStorage.setItem(
    "gitwand-settings",
    JSON.stringify({ aiEnabled: true, ...partial }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("modelForProvider", () => {
  const s = {
    aiModelByProvider: {
      "opencode-cli": "anthropic/claude-x",
      "codex-cli": "",
    },
  } as unknown as AISettings;

  it("returns the per-provider model for CLI agents", () => {
    expect(modelForProvider(s, "opencode-cli")).toBe("anthropic/claude-x");
  });

  it("treats an empty per-provider model as 'use CLI default'", () => {
    expect(modelForProvider(s, "codex-cli")).toBeUndefined();
  });

  it("returns undefined for non-CLI providers", () => {
    expect(modelForProvider(s, "claude")).toBeUndefined();
    expect(modelForProvider(s, "ollama")).toBeUndefined();
  });

  it("returns undefined when no model is stored for the CLI agent", () => {
    expect(
      modelForProvider({ aiModelByProvider: {} } as unknown as AISettings, "claude-code-cli"),
    ).toBeUndefined();
  });
});

describe("listModelsForProvider", () => {
  it("advertises curated aliases for Claude Code", async () => {
    expect(await listModelsForProvider("claude-code-cli")).toEqual(CLAUDE_CODE_MODELS);
  });

  it("returns an empty list (free-text fallback) for Codex", async () => {
    expect(await listModelsForProvider("codex-cli")).toEqual([]);
  });

  it("enumerates opencode models dynamically", async () => {
    const models = await listModelsForProvider("opencode-cli");
    expect(models).toEqual(["anthropic/claude-x", "openai/gpt-y"]);
    expect(listOpencodeModels).toHaveBeenCalledTimes(1);
  });
});

describe("rawPrompt provider dispatch", () => {
  it("routes opencode-cli to opencodeCliPrompt with the selected model", async () => {
    setSettings({
      aiProvider: "opencode-cli",
      aiModelByProvider: { "opencode-cli": "anthropic/claude-x" },
    });
    const { rawPrompt } = useAIProvider();
    const out = await rawPrompt("sys", "user");
    expect(out).toBe("ok-opencode");
    expect(opencodeCliPrompt).toHaveBeenCalledWith("user", "sys", undefined, "anthropic/claude-x");
  });

  it("forwards the per-provider model to Codex", async () => {
    setSettings({
      aiProvider: "codex-cli",
      aiModelByProvider: { "codex-cli": "gpt-5-codex" },
    });
    await useAIProvider().rawPrompt("sys", "user");
    expect(codexCliPrompt).toHaveBeenCalledWith("user", "sys", undefined, "gpt-5-codex");
  });

  it("forwards the per-provider model to Claude Code", async () => {
    setSettings({
      aiProvider: "claude-code-cli",
      aiModelByProvider: { "claude-code-cli": "opus" },
    });
    await useAIProvider().rawPrompt("sys", "user");
    expect(claudeCliPrompt).toHaveBeenCalledWith("user", "sys", undefined, "text", "opus");
  });

  it("passes undefined when no model is configured (CLI default)", async () => {
    setSettings({ aiProvider: "opencode-cli", aiModelByProvider: {} });
    await useAIProvider().rawPrompt("s", "u");
    expect(opencodeCliPrompt).toHaveBeenCalledWith("u", "s", undefined, undefined);
  });
});
