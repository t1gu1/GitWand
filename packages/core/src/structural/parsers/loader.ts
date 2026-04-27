/**
 * Grammar loader for web-tree-sitter.
 *
 * Handles environment detection, WASM loading, and in-process caching.
 *
 * `web-tree-sitter` is an **optional** peer dependency — if it is not
 * installed, every function here returns `null` gracefully and the
 * structural merge is silently skipped.
 */

// ─── Types (kept minimal to avoid hard-coupling to web-tree-sitter types) ────

/** A loaded tree-sitter Language (opaque to callers). */
export type Language = unknown;

/** A ready-to-use tree-sitter Parser (opaque to callers). */
export type TSParser = unknown;

export type Environment = "node" | "tauri" | "browser";

export interface LoaderOptions {
  /** Base URL used by the browser adapter to locate grammar WASM files. */
  grammarBaseUrl?: string;
  /** Directory used by the Tauri adapter to locate grammar WASM files. */
  grammarDir?: string;
  /**
   * URL for `web-tree-sitter.wasm` — the web-tree-sitter runtime WASM.
   * Pass this when the runtime cannot auto-discover the file (e.g. inside a
   * Vite bundle where the hashed asset URL is not predictable).
   * Example: `"/grammars/web-tree-sitter.wasm"`.
   *
   * Internally mapped to `locateFile` for web-tree-sitter v0.26+ (Emscripten).
   */
  wasmPath?: string;
  /**
   * Custom WASM bytes loader — overrides environment detection entirely.
   * Receives the grammar name (e.g. "tree-sitter-typescript") and must
   * return the raw WASM bytes.
   */
  customLoader?: (grammarName: string) => Promise<Uint8Array>;
}

// ─── Module-level cache ───────────────────────────────────────────────────────

const grammarCache = new Map<string, Language>();
let parserInitialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ParserClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _LanguageClass: any = null;

// ─── Environment detection ────────────────────────────────────────────────────

/**
 * Detect the current runtime environment.
 * Priority: Tauri (window.__TAURI_INTERNALS__) > Node.js (process.versions.node) > browser.
 */
export function detectEnvironment(): Environment {
  if (
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__TAURI_INTERNALS__ != null
  ) {
    return "tauri";
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }
  return "browser";
}

// ─── web-tree-sitter dynamic import ──────────────────────────────────────────

/**
 * Try to dynamically import `web-tree-sitter`.
 * Returns `null` (never throws) if the package is not installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryImportTreeSitter(): Promise<any | null> {
  if (_ParserClass !== null) return _ParserClass;
  try {
    // web-tree-sitter is an optional peerDependency — TypeScript cannot
    // resolve it at compile time when it is not installed.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: optional peer — may not be installed
    const mod = await import("web-tree-sitter");
    // v0.26+ exports named exports (Parser, Language, …) with no default.
    // Earlier versions (≤0.22) had a single default export (the Parser class)
    // with Language available as Parser.Language.
    // Support both shapes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyMod = mod as any;
    if (anyMod.Parser) {
      // v0.26+ shape: { Parser, Language, … }
      _ParserClass = anyMod.Parser;
      _LanguageClass = anyMod.Language;
    } else {
      // pre-v0.22 shape: default export is the Parser class; Language is Parser.Language
      const ParserDefault = anyMod.default ?? anyMod;
      _ParserClass = ParserDefault;
      _LanguageClass = ParserDefault.Language;
    }
    return _ParserClass;
  } catch {
    return null;
  }
}

/**
 * Ensure web-tree-sitter's WASM runtime is initialized.
 *
 * Idempotent — safe to call multiple times; initialization runs only once.
 *
 * @returns The Parser class, or `null` if web-tree-sitter is unavailable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureParserInitialized(_opts: LoaderOptions = {}): Promise<any | null> {
  const Parser = await tryImportTreeSitter();
  if (!Parser) return null;

  if (!parserInitialized) {
    // `wasmPath` lets the caller override where web-tree-sitter finds its own
    // runtime WASM (web-tree-sitter.wasm).  This is needed in bundled
    // environments (Vite, Tauri) where the file is served as a static asset.
    //
    // web-tree-sitter v0.26+ uses the Emscripten `locateFile` callback to
    // resolve the WASM URL — there is no `wasmPath` option in that API.
    const initOpts = _opts.wasmPath
      ? {
          locateFile: (path: string) =>
            path.endsWith(".wasm") ? _opts.wasmPath! : path,
        }
      : {};
    await Parser.init(initOpts);
    parserInitialized = true;
  }

  return Parser;
}

// ─── WASM bytes loading ───────────────────────────────────────────────────────

async function loadWasmForEnv(
  env: Environment,
  grammarName: string,
  opts: LoaderOptions,
): Promise<Uint8Array> {
  if (env === "node") {
    const { loadGrammarBytes } = await import("./adapters/node.js");
    return loadGrammarBytes(grammarName);
  }
  if (env === "tauri") {
    const { loadGrammarBytes } = await import("./adapters/tauri.js");
    return loadGrammarBytes(grammarName, { grammarDir: opts.grammarDir });
  }
  // browser
  const { loadGrammarBytes } = await import("./adapters/browser.js");
  return loadGrammarBytes(grammarName, { grammarBaseUrl: opts.grammarBaseUrl });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and cache a tree-sitter grammar by name.
 *
 * Returns `null` (never throws) if:
 * - `web-tree-sitter` is not installed
 * - The grammar WASM file cannot be found or loaded
 *
 * @param grammarName - e.g. "tree-sitter-typescript"
 * @param opts        - Optional WASM path / loader overrides
 */
export async function loadGrammar(
  grammarName: string,
  opts: LoaderOptions = {},
): Promise<Language | null> {
  const cached = grammarCache.get(grammarName);
  if (cached !== undefined) return cached;

  const Parser = await ensureParserInitialized(opts);
  if (!Parser) return null;

  try {
    let wasmBytes: Uint8Array;
    if (opts.customLoader) {
      wasmBytes = await opts.customLoader(grammarName);
    } else {
      const env = detectEnvironment();
      wasmBytes = await loadWasmForEnv(env, grammarName, opts);
    }

    // Use the module-level Language class (v0.26+ separate export;
    // fall back to Parser.Language for older versions).
    const LanguageClass = _LanguageClass ?? Parser.Language;
    const language: Language = await LanguageClass.load(wasmBytes);
    grammarCache.set(grammarName, language);
    return language;
  } catch {
    return null;
  }
}

/**
 * Create a configured tree-sitter Parser instance.
 *
 * Returns `null` if web-tree-sitter is unavailable.
 *
 * @param language - A language object returned by `loadGrammar()`
 * @param opts     - Loader options (passed to `ensureParserInitialized`)
 */
export async function createParser(
  language: Language,
  opts: LoaderOptions = {},
): Promise<TSParser | null> {
  const Parser = await ensureParserInitialized(opts);
  if (!Parser) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parser = new (Parser as any)();
  parser.setLanguage(language);
  return parser as TSParser;
}

/**
 * Reset the in-process grammar cache and initialization state.
 * Intended for use in tests only.
 */
export function _resetCache(): void {
  grammarCache.clear();
  parserInitialized = false;
  _ParserClass = null;
  _LanguageClass = null;
}
