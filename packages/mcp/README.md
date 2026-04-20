# @gitwand/mcp

[![npm](https://img.shields.io/npm/v/@gitwand/mcp?color=22c55e)](https://www.npmjs.com/package/@gitwand/mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-22c55e)](https://registry.modelcontextprotocol.io/?search=gitwand)
[![License](https://img.shields.io/badge/license-MIT-8B5CF6)](../../LICENSE)

**MCP server that lets AI agents resolve Git merge conflicts automatically.**

[GitWand](https://github.com/devlint/GitWand) exposes its conflict resolution engine as a [Model Context Protocol](https://modelcontextprotocol.io) server. Plug it into Claude Desktop, Claude Code, Cursor, Windsurf, or any MCP-compatible client and the agent can inspect, preview, and resolve conflicts in your repos without you opening a single conflict marker.

## Install

No install step — run it via `npx`:

```bash
npx -y @gitwand/mcp --cwd /path/to/your/repo
```

Or add it to your MCP client config (examples below).

## Configure

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "gitwand": {
      "command": "npx",
      "args": ["-y", "@gitwand/mcp"]
    }
  }
}
```

The server defaults to the current working directory. To pin it to a specific repo, add `"--cwd", "/absolute/path/to/repo"` to the `args` array.

### Claude Code

```bash
claude mcp add gitwand -- npx -y @gitwand/mcp
```

### Cursor / Windsurf

Same config shape as Claude Desktop — drop it into the `mcpServers` block of your client's config file.

## What the agent can do

Five tools are exposed:

| Tool | What it does |
|------|--------------|
| `gitwand_status` | List conflicted files with counts and auto-resolvability score |
| `gitwand_preview_merge` | Dry-run: return stats and a risk assessment without writing |
| `gitwand_resolve_conflicts` | Auto-resolve trivial conflicts, return resolutions + pending hunks |
| `gitwand_explain_hunk` | Full decision trace for one hunk (ours / theirs / base / reasoning) |
| `gitwand_apply_resolution` | Apply an agent-provided resolution to a specific complex hunk |

Plus three resources (`gitwand://repo/conflicts`, `gitwand://repo/policy`, `gitwand://hunk/{file}/{line}`) for ambient context.

## How it works — the collaboration loop

GitWand handles the trivial conflicts (whitespace, same-change, non-overlapping inserts, value updates, generated files…). The agent handles the complex ones.

1. Agent calls `gitwand_preview_merge` → sees risk level + how many conflicts GitWand can handle alone.
2. Agent calls `gitwand_resolve_conflicts` → GitWand resolves the easy hunks and returns `pendingHunks` for the rest.
3. For each pending hunk, the agent reads ours/theirs/base from the response and decides.
4. Agent calls `gitwand_apply_resolution` with its chosen content — the file is written.

## Resolution patterns

GitWand only auto-resolves when it's certain. The engine tags each hunk with a pattern and a composite confidence score (0–100):

- `same_change` — identical edit on both sides (certain)
- `one_side_change` — only one branch touched the block (certain)
- `non_overlapping` — additions in different locations (high)
- `whitespace_only` — same logic, different indentation (high)
- `reorder_only` — pure permutation (high)
- `insertion_at_boundary` — pure insertions, base intact (high)
- `value_only_change` — scalar updated on one side (medium)
- `generated_file` — path matches a known generated-file pattern (high)
- `complex` — overlapping edits — **never auto-resolved**

Format-aware resolvers (JSON, Markdown, YAML, Vue SFC, lockfiles) kick in before pure text matching.

## Configuration

Drop a `.gitwandrc` at the repo root to tune policies:

```json
{
  "policy": "prefer-merge",
  "patternOverrides": {
    "*.lock": "prefer-theirs",
    "CHANGELOG.md": "prefer-ours"
  },
  "generatedFiles": ["src/generated/**", "**/*.pb.ts"]
}
```

Policies: `prefer-ours`, `prefer-theirs`, `prefer-safety`, `prefer-merge`, `strict`.

## Also available

- **[@gitwand/cli](https://www.npmjs.com/package/@gitwand/cli)** — same engine, command-line interface for terminals and CI pipelines.
- **[GitWand desktop app](https://github.com/devlint/GitWand#desktop-app)** — full Git client with built-in resolution, merge preview, and inline code review.

## Links

- 📖 [Documentation](https://github.com/devlint/GitWand#mcp-server)
- 🐛 [Issue tracker](https://github.com/devlint/GitWand/issues)
- 🌐 [Website](https://devlint.github.io/GitWand/)
- 📜 [License — MIT](../../LICENSE)
