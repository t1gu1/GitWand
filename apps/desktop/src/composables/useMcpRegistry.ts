import { ref } from "vue";

// ---------------------------------------------------------------------------
// MCP Registry composable
//
// Data source strategy (in order):
//   1. Official registry  https://registry.modelcontextprotocol.io/api/v0/servers
//      → mirrors server.json manifest format (packages[].registryType/identifier…)
//   2. npm search fallback  https://registry.npmjs.org/-/v1/search?text=keywords:mcp-server
//      → used when the official registry returns non-2xx or is unreachable.
//      Results are mapped to the same McpServer shape (registryType: "npm").
//
// A 1 h localStorage cache avoids re-fetching on every Settings open.
// ---------------------------------------------------------------------------

const REGISTRY_URL =
  "https://registry.modelcontextprotocol.io/api/v0/servers";

const NPM_SEARCH_URL =
  "https://registry.npmjs.org/-/v1/search?text=keywords%3Amcp-server&size=250";

const CACHE_KEY = "gitwand-mcp-registry-cache";
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 h

// ---------------------------------------------------------------------------
// Types — matching the real registry response format
// ---------------------------------------------------------------------------

export type McpRegistryType = "npm" | "pypi" | "docker" | string;
export type McpTransportType = "stdio" | "http" | string;

export interface McpPackage {
  registryType: McpRegistryType;
  /** Package identifier: npm name, PyPI name, Docker image tag, etc. */
  identifier: string;
  version?: string;
  transport?: { type: McpTransportType };
}

export interface McpRepository {
  url: string;
  source?: string; // "github", "gitlab", etc.
}

export interface McpVersionDetail {
  name: string;
  is_latest?: boolean;
}

export interface McpServer {
  /** Fully-qualified registry ID, e.g. "io.github.devlint/gitwand" */
  id: string;
  /** Display name (often same as id) */
  name: string;
  description: string;
  repository?: McpRepository;
  packages?: McpPackage[];
  version_detail?: McpVersionDetail;
}

interface RegistryResponse {
  servers: McpServer[];
  metadata?: { next_cursor?: string | null; total_count?: number };
}

interface CacheEntry {
  ts: number;
  servers: McpServer[];
}

// ---------------------------------------------------------------------------
// Install fragment derivation
// Returns a JSON string describing how the AI client should launch the server.
// ---------------------------------------------------------------------------

/**
 * Build the mcpServers entry JSON for a given server.
 * @param server - registry server record
 * @param cwdOverride - optional --cwd arg (only used for stdio npm servers that accept it)
 */
export function buildInstallFragment(
  server: McpServer,
  cwdOverride?: string,
): string {
  const pkg = server.packages?.[0];

  if (!pkg) {
    // Fallback: try npx with the id
    return JSON.stringify({ command: "npx", args: ["-y", server.id] });
  }

  if (pkg.transport?.type === "http") {
    // HTTP/SSE server — no local command needed
    return JSON.stringify({ url: pkg.identifier });
  }

  switch (pkg.registryType) {
    case "npm": {
      const args: string[] = ["-y", pkg.identifier];
      if (cwdOverride) args.push("--cwd", cwdOverride);
      return JSON.stringify({ command: "npx", args });
    }
    case "pypi":
      return JSON.stringify({ command: "uvx", args: [pkg.identifier] });
    case "docker":
      return JSON.stringify({
        command: "docker",
        args: ["run", "-i", "--rm", pkg.identifier],
      });
    default:
      return JSON.stringify({ command: pkg.identifier });
  }
}

/**
 * Derive a stable key to use under `mcpServers` for a registry server.
 * Prefers the last path segment of the npm package name; falls back to
 * the last segment of the registry id.
 */
export function serverInstallKey(server: McpServer): string {
  const pkg = server.packages?.[0];
  if (pkg?.identifier) {
    // "@scope/name-mcp" → "name-mcp"  |  "name" → "name"
    return pkg.identifier.replace(/^@[^/]+\//, "");
  }
  // "io.github.foo/bar" → "bar"
  return server.id.split("/").pop() ?? server.id;
}

/**
 * Parse a free-text input and classify it as:
 *   "url"     — starts with http:// or https://
 *   "package" — looks like an npm package (@scope/name or unscoped-name)
 *   "search"  — everything else (plain text filter)
 */
export type InputMode = "url" | "package" | "search";

export function classifyInput(input: string): InputMode {
  const v = input.trim();
  if (!v) return "search";
  if (v.startsWith("http://") || v.startsWith("https://")) return "url";
  // npm package: starts with @ or looks like "word" / "word/word"
  if (v.startsWith("@") || /^[a-z0-9]([a-z0-9._-]*\/)?[a-z0-9._-]+$/i.test(v)) {
    return "package";
  }
  return "search";
}

/**
 * Given a registry URL, extract the server id if it points to a specific
 * server page on registry.modelcontextprotocol.io.
 * Returns null for non-registry URLs or root URLs.
 */
export function extractRegistryServerId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("modelcontextprotocol.io")) return null;
    // /servers/<id>  or  /<id>
    const m = u.pathname.match(/(?:\/servers)?\/(.+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

let _fetchPromise: Promise<{ servers: McpServer[]; source: DataSource }> | null = null;

function readCache(): McpServer[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry.servers;
  } catch {
    return null;
  }
}

function writeCache(servers: McpServer[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), servers }));
  } catch { /* quota exceeded */ }
}

/** Try the official MCP Registry API. Returns null on any non-2xx response. */
async function tryOfficialRegistry(): Promise<McpServer[] | null> {
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RegistryResponse;
    const servers = Array.isArray(data.servers) ? data.servers : [];
    return servers.length > 0 ? servers : null;
  } catch {
    return null;
  }
}

// ── npm search fallback ──────────────────────────────────────────────────────

interface NpmPackage {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  links?: { repository?: string; homepage?: string };
  author?: { name?: string };
  publisher?: { username?: string };
}

interface NpmSearchResponse {
  objects: Array<{ package: NpmPackage }>;
  total: number;
}

function npmToMcpServer(pkg: NpmPackage): McpServer {
  const repoUrl = pkg.links?.repository ?? pkg.links?.homepage;
  const source = repoUrl?.includes("gitlab")
    ? "gitlab"
    : repoUrl?.includes("github")
    ? "github"
    : undefined;
  return {
    id: pkg.name,
    name: pkg.name.replace(/^@[^/]+\//, ""),
    description: pkg.description ?? "",
    repository: repoUrl ? { url: repoUrl, source } : undefined,
    packages: [
      {
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: "stdio" },
      },
    ],
    version_detail: { name: pkg.version, is_latest: true },
  };
}

async function fetchFromNpm(): Promise<McpServer[]> {
  const res = await fetch(NPM_SEARCH_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`npm search HTTP ${res.status}`);
  const data = (await res.json()) as NpmSearchResponse;
  return (data.objects ?? []).map((o) => npmToMcpServer(o.package));
}

/** Official registry first, npm search as fallback. */
async function fetchFromRegistry(): Promise<{ servers: McpServer[]; source: DataSource }> {
  const official = await tryOfficialRegistry();
  if (official) return { servers: official, source: "official" };
  const npm = await fetchFromNpm();
  return { servers: npm, source: "npm" };
}

export type DataSource = "official" | "npm";

// ---------------------------------------------------------------------------
// Module-level reactive state (singleton across all composable instances)
// ---------------------------------------------------------------------------

const _servers = ref<McpServer[]>([]);
const _loading = ref(false);
const _error = ref<string | null>(null);
const _loaded = ref(false);
const _source = ref<DataSource | null>(null);

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useMcpRegistry() {
  async function load(force = false): Promise<void> {
    if (!force) {
      const cached = readCache();
      if (cached) {
        _servers.value = cached;
        _loaded.value = true;
        return;
      }
    }
    if (_fetchPromise) { await _fetchPromise; return; }
    _loading.value = true;
    _error.value = null;
    _fetchPromise = fetchFromRegistry();
    try {
      const result = await _fetchPromise;
      _servers.value = result.servers;
      _source.value = result.source;
      writeCache(result.servers);
      _loaded.value = true;
    } catch (err: unknown) {
      _error.value = err instanceof Error ? err.message : String(err);
    } finally {
      _loading.value = false;
      _fetchPromise = null;
    }
  }

  function refresh(): Promise<void> {
    try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    return load(true);
  }

  /** Find a server by id (for registry URL deep-links). */
  function findById(id: string): McpServer | undefined {
    return _servers.value.find((s) => s.id === id);
  }

  /** Client-side filter: text across name/description/id + no categories/stars (don't exist). */
  function filteredServers(query: string): McpServer[] {
    const q = query.trim().toLowerCase();
    if (!q) return _servers.value;
    return _servers.value.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q) ||
        s.packages?.some((p) => p.identifier?.toLowerCase().includes(q)),
    );
  }

  return {
    servers: _servers,
    loading: _loading,
    error: _error,
    loaded: _loaded,
    load,
    refresh,
    filteredServers,
    findById,
  };
}
