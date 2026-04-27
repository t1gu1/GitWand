/**
 * Node.js adapter for loading tree-sitter grammar WASM files.
 *
 * Reads WASM bytes from the filesystem. Grammar resolution order:
 *   1. `tree-sitter-wasms` package (if installed as optional peer)
 *   2. `@gitwand/core` local assets directory (packages/core/assets/grammars/)
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const _require = createRequire(import.meta.url);

/**
 * Resolve the filesystem path to a grammar WASM file.
 *
 * @param grammarName - e.g. "tree-sitter-typescript"
 */
export function resolveGrammarPath(grammarName: string): string {
  // 1. Try tree-sitter-wasms (optional peer) — publishes to out/ dir
  try {
    const pkgJson = _require.resolve("tree-sitter-wasms/package.json");
    const pkgDir = dirname(pkgJson);
    return resolve(pkgDir, "out", `${grammarName}.wasm`);
  } catch {
    // tree-sitter-wasms not installed
  }

  // 2. Fallback: local assets directory (four levels up from this file)
  //    __file__ = packages/core/src/structural/parsers/adapters/node.ts
  //    target   = packages/core/assets/grammars/
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "../../../../../assets/grammars", `${grammarName}.wasm`);
}

/**
 * Load grammar WASM bytes from the Node.js filesystem.
 */
export async function loadGrammarBytes(grammarName: string): Promise<Uint8Array> {
  const grammarPath = resolveGrammarPath(grammarName);
  const buf = await readFile(grammarPath);
  return new Uint8Array(buf);
}
