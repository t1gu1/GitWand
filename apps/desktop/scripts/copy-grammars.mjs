/**
 * Copy tree-sitter WASM files to public/grammars/ so Vite can serve them
 * as static assets in both dev mode and the Tauri production bundle.
 *
 * Files copied:
 *   node_modules/web-tree-sitter/web-tree-sitter.wasm
 *     → public/grammars/web-tree-sitter.wasm        (web-tree-sitter runtime)
 *
 *   node_modules/tree-sitter-wasms/out/<grammar>.wasm
 *     → public/grammars/<grammar>.wasm               (language grammars)
 *
 * Grammars copied: typescript, tsx, javascript, python, go, rust
 * (all languages supported by @gitwand/core's structural merge engine)
 */

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(new URL(import.meta.url).pathname);

const destDir = join(__dirname, "..", "public", "grammars");
mkdirSync(destDir, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk up from `startDir` until we find `node_modules/<packageName>`.
 * Needed for packages whose `main` or `exports` field is broken/absent
 * (e.g. tree-sitter-wasms whose `main` points to an unbuilt native binding).
 */
function findPackageDir(packageName, startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "node_modules", packageName);
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // not found here — go up
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Cannot find package: ${packageName}`);
    dir = parent;
  }
}

// ─── web-tree-sitter runtime WASM ────────────────────────────────────────────
// v0.26+ exports "./web-tree-sitter.wasm" as a direct subpath — use that.
const runtimeSrc = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
const runtimeDst = join(destDir, "web-tree-sitter.wasm");
copyFileSync(runtimeSrc, runtimeDst);
console.log("  copied web-tree-sitter.wasm");

// ─── Language grammar WASMs ───────────────────────────────────────────────────
// tree-sitter-wasms has `"exports": []` and a broken `main` (unbuilt native
// binding) — resolve its root directory via directory walking instead.
const wasmsPackageDir = findPackageDir("tree-sitter-wasms", __dirname);
const wasmsDir = join(wasmsPackageDir, "out");

const grammars = [
  "tree-sitter-typescript",
  "tree-sitter-tsx",
  "tree-sitter-javascript",
  "tree-sitter-python",
  "tree-sitter-go",
  "tree-sitter-rust",
];

for (const grammar of grammars) {
  const src = join(wasmsDir, `${grammar}.wasm`);
  const dst = join(destDir, `${grammar}.wasm`);
  copyFileSync(src, dst);
  console.log(`  copied ${grammar}.wasm`);
}

console.log(`\n✓ Grammar WASM files written to public/grammars/ (${grammars.length + 1} files)`);
