/**
 * Language registry for the structural merge engine.
 *
 * Maps file extensions → language identifiers → tree-sitter grammar WASM names.
 * Grammar WASM names correspond to the filenames published by `tree-sitter-wasms`.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "python"
  | "go"
  | "rust";

export interface LanguageSpec {
  /** Grammar WASM name as published in `tree-sitter-wasms/out/` */
  grammarName: string;
  /** File extensions handled by this language (lowercase, with dot) */
  extensions: string[];
}

// ─── Language specs ───────────────────────────────────────────────────────────

export const LANGUAGE_SPECS: Record<SupportedLanguage, LanguageSpec> = {
  typescript: {
    grammarName: "tree-sitter-typescript",
    extensions: [".ts"],
  },
  tsx: {
    grammarName: "tree-sitter-tsx",
    extensions: [".tsx"],
  },
  javascript: {
    grammarName: "tree-sitter-javascript",
    extensions: [".js", ".mjs", ".cjs"],
  },
  jsx: {
    // JSX is parsed by the JavaScript grammar (tree-sitter-javascript supports JSX natively)
    grammarName: "tree-sitter-javascript",
    extensions: [".jsx"],
  },
  python: {
    grammarName: "tree-sitter-python",
    extensions: [".py"],
  },
  go: {
    grammarName: "tree-sitter-go",
    extensions: [".go"],
  },
  rust: {
    grammarName: "tree-sitter-rust",
    extensions: [".rs"],
  },
};

// ─── Extension → language lookup table ───────────────────────────────────────

const EXT_TO_LANGUAGE: Map<string, SupportedLanguage> = new Map(
  (Object.entries(LANGUAGE_SPECS) as [SupportedLanguage, LanguageSpec][]).flatMap(
    ([lang, spec]) => spec.extensions.map((ext): [string, SupportedLanguage] => [ext, lang]),
  ),
);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the language for a given file path.
 * Returns `null` if the file extension is not supported.
 */
export function languageForFile(filePath: string): SupportedLanguage | null {
  const lower = filePath.toLowerCase();
  for (const [ext, lang] of EXT_TO_LANGUAGE) {
    if (lower.endsWith(ext)) return lang;
  }
  return null;
}

/**
 * Returns `true` if the file can be handled by the structural merge engine.
 *
 * Excludes TypeScript declaration files (`.d.ts`) — they have no implementation
 * to merge. Excludes `.min.js` and other generated bundles via the generated-file
 * detector in the main resolver pipeline.
 */
export function isStructuralLanguage(filePath: string): boolean {
  if (/\.d\.ts$/i.test(filePath)) return false;
  return languageForFile(filePath) !== null;
}

/**
 * Return the grammar WASM name for a file, or `null` if not supported.
 */
export function grammarNameForFile(filePath: string): string | null {
  const lang = languageForFile(filePath);
  return lang ? LANGUAGE_SPECS[lang].grammarName : null;
}
