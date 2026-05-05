---
title: AI Integrations — GitWand
description: Connect GitWand to Claude Code CLI, the Anthropic API, OpenAI-compatible endpoints, or Ollama for AI-powered commit messages, PR descriptions, conflict explanations, and more.
---

# AI integrations

GitWand can connect to an AI model to generate commit messages, PR titles and descriptions, branch names, stash messages, release notes, and conflict explanations. The model runs through a provider you configure — GitWand never bundles its own model.

Go to **Settings → AI** to pick a provider and configure it.

---

## Claude Code CLI (recommended)

If you already use [Claude Code](https://claude.ai/code), this is the simplest option. GitWand calls the local `claude` CLI subprocess and piggybacks on your existing Max or Pro subscription — no API key, no extra cost.

**Requirements:** Claude Code installed and logged in (`claude login`).

**Setup:**
1. Open **Settings → AI**
2. Select **Claude Code CLI** as the provider
3. That's it — GitWand detects the `claude` binary automatically

This is the same Claude Code you use in your terminal for coding tasks. GitWand uses it for focused, single-turn prompts (commit message from a diff, PR description from a branch, etc.) — it won't start interactive sessions or consume your conversation history.

---

## Anthropic API

A direct connection to the Anthropic API with your own key.

**Setup:**
1. Open **Settings → AI**
2. Select **Claude API**
3. Paste your API key (from [console.anthropic.com](https://console.anthropic.com))
4. Choose a model — `claude-sonnet-4-5` is a good default for speed and quality

Costs are billed to your Anthropic account per token. Commit message generation typically uses a few hundred tokens per call.

---

## OpenAI-compatible endpoint

Any API that speaks the OpenAI chat completions format: OpenAI directly (`gpt-4o`, `o3`…), Azure OpenAI, OpenRouter, or a self-hosted endpoint.

**Setup:**
1. Open **Settings → AI**
2. Select **OpenAI-compatible**
3. Enter the **endpoint URL** — for OpenAI: `https://api.openai.com/v1`
4. Paste your **API key**
5. Enter the **model name** (`gpt-4o`, `o3-mini`, etc.)

---

## Ollama (local, offline)

Run a model entirely on your machine with [Ollama](https://ollama.com). No API key, no data leaves your computer.

**Setup:**
1. Install Ollama and pull a model: `ollama pull llama3`
2. Make sure Ollama is running (`ollama serve`)
3. Open **Settings → AI**
4. Select **Ollama**
5. Set the endpoint to `http://localhost:11434` (default)
6. Enter the model name (`llama3`, `mistral`, `codellama`, etc.)

Good models for code-related tasks: `codellama`, `deepseek-coder`, `qwen2.5-coder`.

---

## What the AI is used for

Once a provider is configured, AI features become available throughout the app:

| Feature | Where |
|---------|-------|
| Commit message generation | Commit panel → ✦ button |
| PR title & description | PR Create view → ✦ button |
| Branch name suggestion | Branch creation dialog → ✦ button |
| Stash message | Stash panel → ✦ button |
| Release notes | Tags panel → ✦ button |
| Conflict explanation | Merge editor → Explain button |
| Conflict resolution suggestion | Merge editor → IA button |
| Per-hunk code review | PR detail → Intelligence panel |
| Semantic squash message | Interactive rebase → squash action |
| Blame context | File blame → ✦ button |
| Absorb ranking | Absorb flow (semantic ranking) |
| Merge risk summary | Merge preview panel |

Every AI action is explicit — GitWand never calls the model in the background without your input.

---

## Privacy

GitWand sends only what's needed for each task:

- **Commit message**: the staged diff
- **PR description**: the branch diff against base
- **Conflict explanation**: the ours/theirs/base content of the hunk

No file paths outside the diff, no repo history, no credentials. If you use Claude Code CLI or Ollama, nothing leaves your machine.
