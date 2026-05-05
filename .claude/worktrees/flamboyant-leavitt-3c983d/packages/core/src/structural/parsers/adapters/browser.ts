/**
 * Browser adapter for loading tree-sitter grammar WASM files.
 *
 * Fetches the WASM file from a URL. The bundler / dev server must make the
 * grammar WASM files available at a known public URL.
 *
 * Configure via `LoaderOptions.grammarBaseUrl` (default: "/assets/grammars").
 */

export interface BrowserLoaderOptions {
  /** Base URL where grammar WASM files are served (no trailing slash). */
  grammarBaseUrl?: string;
}

/**
 * Load grammar WASM bytes via fetch.
 *
 * Fetches `{grammarBaseUrl}/{grammarName}.wasm`.
 *
 * @param grammarName - e.g. "tree-sitter-typescript"
 * @param opts        - Browser-specific options
 */
export async function loadGrammarBytes(
  grammarName: string,
  opts: BrowserLoaderOptions = {},
): Promise<Uint8Array> {
  const base = opts.grammarBaseUrl ?? "/assets/grammars";
  const url = `${base}/${grammarName}.wasm`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[structural] Failed to fetch grammar WASM: ${url} (HTTP ${response.status})`,
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
