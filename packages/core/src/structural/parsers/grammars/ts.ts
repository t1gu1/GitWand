/**
 * Grammar loaders for all structural-merge–supported languages.
 *
 * Uses the unified language registry from `languages.ts` to map file paths
 * to the correct `tree-sitter-wasms` grammar WASM.
 */

import { loadGrammar, type Language, type LoaderOptions } from "../loader.js";
import { grammarNameForFile, LANGUAGE_SPECS } from "./languages.js";

// ─── Named loaders (kept for backward compat + direct use) ───────────────────

/** Load the TypeScript grammar. */
export async function loadTypeScriptGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.typescript.grammarName, opts);
}

/** Load the TSX grammar. */
export async function loadTsxGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.tsx.grammarName, opts);
}

/** Load the JavaScript grammar (also used for JSX). */
export async function loadJavaScriptGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.javascript.grammarName, opts);
}

/** Load the Python grammar. */
export async function loadPythonGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.python.grammarName, opts);
}

/** Load the Go grammar. */
export async function loadGoGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.go.grammarName, opts);
}

/** Load the Rust grammar. */
export async function loadRustGrammar(opts: LoaderOptions = {}): Promise<Language | null> {
  return loadGrammar(LANGUAGE_SPECS.rust.grammarName, opts);
}

// ─── Generic loader ───────────────────────────────────────────────────────────

/**
 * Load the appropriate grammar for a given file path.
 * Returns `null` if the file extension is not supported or the grammar WASM
 * is unavailable.
 */
export async function loadGrammarForFile(
  filePath: string,
  opts: LoaderOptions = {},
): Promise<Language | null> {
  const grammarName = grammarNameForFile(filePath);
  if (!grammarName) return null;
  return loadGrammar(grammarName, opts);
}
