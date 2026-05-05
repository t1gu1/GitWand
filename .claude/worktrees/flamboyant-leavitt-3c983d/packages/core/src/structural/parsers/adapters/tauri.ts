/**
 * Tauri adapter for loading tree-sitter grammar WASM files.
 *
 * Uses `window.__TAURI_INTERNALS__.convertFileSrc` (Tauri v2) to convert a
 * local asset path into a fetch-able asset:// URL, then loads via fetch.
 *
 * Grammar WASM files must be included in the Tauri bundle under the path
 * specified by `grammarDir` (default: "/assets/grammars" relative to the
 * Tauri resource directory).
 */

export interface TauriLoaderOptions {
  /**
   * Absolute path to the directory containing grammar WASM files inside
   * the Tauri resource bundle.
   * Defaults to "/assets/grammars".
   */
  grammarDir?: string;
}

/**
 * Load grammar WASM bytes in a Tauri webview context.
 *
 * @param grammarName - e.g. "tree-sitter-typescript"
 * @param opts        - Tauri-specific options
 */
export async function loadGrammarBytes(
  grammarName: string,
  opts: TauriLoaderOptions = {},
): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tauri = (window as any).__TAURI_INTERNALS__;
  if (typeof tauri?.convertFileSrc !== "function") {
    throw new Error(
      "[structural] Tauri adapter: __TAURI_INTERNALS__.convertFileSrc is not available. " +
        "Ensure you are running inside a Tauri webview and using Tauri v2.",
    );
  }

  const grammarDir = opts.grammarDir ?? "/assets/grammars";
  const localPath = `${grammarDir}/${grammarName}.wasm`;
  const url: string = tauri.convertFileSrc(localPath, "asset");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[structural] Failed to fetch grammar WASM via Tauri: ${localPath} (HTTP ${response.status})`,
    );
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
