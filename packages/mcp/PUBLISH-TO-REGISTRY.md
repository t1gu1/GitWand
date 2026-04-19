# Publishing @gitwand/mcp to the official MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io/) indexes MCP servers for discovery by Claude Desktop, Claude Code, Cursor, Windsurf, and other clients. Submission is **not** via a GitHub PR — it's done with the `mcp-publisher` CLI, authenticated with GitHub OAuth.

## Pre-requisites (one-time setup)

- `@gitwand/mcp@1.6.0` must already be live on **npm** (publishing to the MCP Registry doesn't host the artifact — it just points at it). Check with `npm view @gitwand/mcp version`.
- The GitHub repo `devlint/GitWand` must match the `repository.url` declared in `server.json`.
- A GitHub account with write access to `devlint/GitWand` (authenticating the publish).

## One-time CLI setup

The publisher CLI is built from the registry repo (there's no npm distribution of it yet):

```bash
# Anywhere outside this repo:
git clone https://github.com/modelcontextprotocol/registry.git mcp-registry
cd mcp-registry
make publisher
# Binary is at ./bin/mcp-publisher — copy somewhere on PATH or call by full path.
./bin/mcp-publisher --help
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

For every new release (e.g. v1.7.0):

1. Bump `version` in `server.json` to match the new `@gitwand/mcp` version on npm.
2. Bump the `version` under `packages[0]`.
3. Re-run `mcp-publisher publish` (the CLI detects the name + maintainer and updates in place).

Consider automating this in the CI publish workflow once the flow is proven manually once.

## Current server.json summary

- **Name**: `io.github.devlint/gitwand`
- **Registry**: `npm` / `@gitwand/mcp`
- **Transport**: `stdio`
- **Schema**: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`

## References

- [Registry repo](https://github.com/modelcontextprotocol/registry)
- [Publisher guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md)
- [server.json reference](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
