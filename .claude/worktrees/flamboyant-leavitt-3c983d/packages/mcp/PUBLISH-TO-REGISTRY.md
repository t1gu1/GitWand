# Publishing @gitwand/mcp to the official MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io/) indexes MCP servers for discovery by Claude Desktop, Claude Code, Cursor, Windsurf, and other clients. Submission is **not** via a GitHub PR — it's done with the `mcp-publisher` CLI, authenticated with GitHub OAuth.

## Pre-requisites (one-time setup)

- `@gitwand/mcp@1.6.0` must already be live on **npm** (publishing to the MCP Registry doesn't host the artifact — it just points at it). Check with `npm view @gitwand/mcp version`.
- The GitHub repo `devlint/GitWand` must match the `repository.url` declared in `server.json`.
- A GitHub account with write access to `devlint/GitWand` (authenticating the publish).

## One-time CLI setup

The publisher CLI ships as a pre-built binary. Pick one of the following:

### Homebrew (macOS/Linux, recommended)

```bash
brew install mcp-publisher
mcp-publisher --help
```

### Pre-built binary (no package manager)

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/
mcp-publisher --help
```

### Build from source (requires Go)

```bash
git clone https://github.com/modelcontextprotocol/registry.git mcp-registry
cd mcp-registry
make publisher
# Binary is at ./bin/mcp-publisher
```

## Publishing GitWand

From the `packages/mcp` directory of **this** repo (where `server.json` lives):

```bash
# 1. Authenticate with GitHub
mcp-publisher login github

# 2. Dry-run to validate the server.json against the schema
mcp-publisher publish --dry-run

# 3. Actual publish
mcp-publisher publish
```

After publish:
- Check https://registry.modelcontextprotocol.io/ and search "gitwand" — the entry should appear within a few minutes.
- `@gitwand/mcp` will show up natively in Claude Desktop's and Claude Code's registry browsers.

## Updating on each release

**This is now automated.** Pushing a `v*.*.*` tag triggers `.github/workflows/publish.yml`
which, after the npm packages are live and the smoke-test passes, automatically:

1. Installs `mcp-publisher` from the official GitHub releases.
2. Polls npm until `@gitwand/mcp@<version>` propagates (up to 12 min).
3. Runs `mcp-publisher publish` from this directory.

The only manual step remaining before tagging is to bump `version` in `server.json`
(root + `packages[0]`) to match the new `@gitwand/mcp` version — the same bump
you already do in `packages/mcp/package.json` and `packages/mcp/src/server.ts`.

### Required secret

The workflow reads `secrets.MCP_PUBLISHER_TOKEN` — a GitHub PAT with at minimum
`read:user` scope, owned by an account with write access to `devlint/GitWand`.
Set it once in: **Repo → Settings → Secrets and variables → Actions → New repository secret**.

## Current server.json summary

- **Name**: `io.github.devlint/gitwand`
- **Registry**: `npm` / `@gitwand/mcp`
- **Transport**: `stdio`
- **Schema**: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`

## References

- [Registry repo](https://github.com/modelcontextprotocol/registry)
- [Publisher guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md)
- [server.json reference](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
