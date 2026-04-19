# @gitwand/core

[![npm](https://img.shields.io/npm/v/@gitwand/core?color=22c55e)](https://www.npmjs.com/package/@gitwand/core)
[![License](https://img.shields.io/badge/license-MIT-8B5CF6)](../../LICENSE)

**The conflict resolution engine that powers [GitWand](https://github.com/devlint/GitWand).**

This package is primarily a build-time dependency of [`@gitwand/cli`](https://www.npmjs.com/package/@gitwand/cli) and [`@gitwand/mcp`](https://www.npmjs.com/package/@gitwand/mcp). Most users should install one of those instead.

> ⚠️ **Pre-1.0 stability note.** `@gitwand/core` exposes a deliberately small API (`resolve`, `MergeResult`, a handful of types) but is not yet under a formal semver stability commitment. Breaking changes may land in minor versions until the API is declared stable in a future release. If you depend on it directly, pin an exact version.

## Use as a library

```ts
import { resolve } from "@gitwand/core";

const content = readFileSync("src/app.ts", "utf-8");
const result = resolve(content, "src/app.ts");

console.log(`${result.stats.autoResolved}/${result.stats.totalConflicts} resolved`);

if (result.mergedContent) {
  writeFileSync("src/app.ts", result.mergedContent);
}
```

### With options

```ts
const result = resolve(content, "package-lock.json", {
  policy: "prefer-merge",
  minConfidence: "medium",
  patternOverrides: { "*.lock": "prefer-theirs" },
  explainOnly: true,  // don't produce a merged output, just analyze
});
```

## What it does

Parses a file with Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and produces a structured merge result: per-hunk classification, composite confidence score, decision trace, and — when possible — a clean merged content string.

Pattern detection is priority-ordered: `same_change`, `one_side_change`, `delete_no_change`, `non_overlapping`, `whitespace_only`, `reorder_only`, `insertion_at_boundary`, `value_only_change`, `generated_file`, and `complex` (never auto-resolved).

Format-aware resolvers layer on top: JSON / JSONC, Markdown (ATX-heading-aware), YAML, Vue SFC, CSS, and common lockfiles.

See the [main README](https://github.com/devlint/GitWand#conflict-resolution-engine) for the full pattern list, confidence scoring details, and `.gitwandrc` configuration.

## Links

- 📖 [Documentation](https://github.com/devlint/GitWand#conflict-resolution-engine)
- 🐛 [Issue tracker](https://github.com/devlint/GitWand/issues)
- 📜 [License — MIT](../../LICENSE)
