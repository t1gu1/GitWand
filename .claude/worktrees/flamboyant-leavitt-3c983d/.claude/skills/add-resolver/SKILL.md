---
name: add-resolver
description: >
  Add a format-specific resolver to GitWand core. Use this skill whenever
  someone wants to add support for a new file format, file extension, lockfile,
  config file type, or format-specific conflict resolution strategy. Triggers:
  "add resolver for .prisma", "handle composer.lock conflicts", "resolve .tf
  files", "new format support", "add lockfile resolver", "teach GitWand about
  X files".
---

# Skill: add-resolver

Guide the agent through adding a format-specific resolver to `packages/core`
end to end — file creation, dispatcher wiring, tests, and docs — without
missing any of the four required touch points.

---

## Step 1 — Qualify the need

Answer these before writing any code:

1. **Format / extension?** (e.g. `.prisma`, `composer.lock`, `.tf`, `.toml`)
2. **Is it a lockfile?** If yes → confidence is `0.95` by convention. Lockfile
   conflicts are almost always trivially re-generable, so high confidence is
   appropriate.
3. **Resolution strategy?** Examples:
   - Structured config (key = value) → merge non-conflicting keys
   - Lockfile → accept one side; file is regenerable
   - Source code → be conservative, 0.70–0.80 max
4. **Browser-compatible parsing available?** `packages/core` must run in
   browsers — no Node.js imports (`fs`, `path`, `child_process`). If no
   parser lib is available, write a pure string-manipulation parser.

**Confidence score guidelines:**

| File type | Score |
|---|---|
| Lockfile | `0.95` |
| Structured config (JSON, YAML, TOML, dotenv) | `0.85`–`0.90` |
| Source code | `0.70`–`0.80` |
| Never exceed `0.95` unless perfectly deterministic | — |

---

## Step 2 — Create the resolver file

Create `packages/core/src/resolvers/<format>.ts`. Follow this exact shape,
which mirrors all existing resolvers in the directory:

```typescript
/**
 * GitWand — <FORMAT> resolver
 *
 * Strategy: [describe the resolution strategy precisely]
 *
 * Handled cases:
 *  - [case 1]
 *  - [case 2]
 *  - [non-resolvable case → return null]
 */

// ✅ Allowed: pure string manipulation, parsing, algorithms
// ❌ FORBIDDEN: import * as fs from 'fs' / import * as path from 'path'

export interface ResolveResult {
  /** Resolved lines, or null if not resolvable */
  lines: string[] | null;
  /** Human-readable description of what was done (or why it failed) */
  reason: string;
}

/**
 * Attempts to resolve a <format> conflict.
 * Confidence: 0.XX — [justify the score here]
 */
export function tryResolve<Format>Conflict(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
): ResolveResult {
  // ... resolution logic ...

  return { lines: null, reason: "Non-resolvable: [reason]." };
}
```

Key points:
- Zero Node.js imports — double-check every import before writing it
- Justify the confidence score in the JSDoc comment
- On parse failure, return `lines: null` rather than throwing — the dispatcher
  falls back gracefully when a resolver returns null

---

## Step 3 — Wire into the dispatcher

Open `packages/core/src/resolvers/dispatcher.ts` and make **four changes**:

**3a. Add a detection function** in the `// ─── Type detection ───` section:

```typescript
/** Checks whether the file is a <format> file */
export function is<Format>File(filePath: string): boolean {
  return /\.<ext>$/i.test(filePath);
  // For exact filenames: /(?:^|[\\/])<name>$/i.test(filePath)
}
```

**3b. Add the import** at the top with the other resolver imports:

```typescript
import { tryResolve<Format>Conflict } from "./<format>.js";
```

**3c. Add the route in `tryFormatAwareResolve()`**, keeping specificity order
— more specific detections first (e.g. `composer.lock` before `*.lock`,
a named lockfile before a generic JSON):

```typescript
if (is<Format>File(filePath)) {
  const result = tryResolve<Format>Conflict(
    hunk.baseLines,
    hunk.oursLines,
    hunk.theirsLines,
  );
  return {
    lines: result.lines,
    reason: `[<format>] ${result.reason}`,
    resolverUsed: "<format>",
  };
}
```

**3d. Extend the `resolverUsed` union** in `FormatResolveResult`:

```typescript
resolverUsed: "json" | "markdown" | ... | "<format>" | "structural" | "none";
```

---

## Step 4 — Write tests

Create `packages/core/src/__tests__/resolvers/<format>.test.ts` with at least
**5 cases**:

```typescript
import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// Case 1 — Simple resolvable conflict (happy path)
describe("<FORMAT> — non-conflicting addition", () => {
  it("auto-resolves and keeps both sides", () => { /* ... */ });
  it("reason mentions [<format>]", () => { /* ... */ });
});

// Case 2 — Irresolvable complex conflict
describe("<FORMAT> — irresolvable conflict", () => {
  it("returns resolved: false", () => { /* ... */ });
});

// Case 3 — Empty / minimal structure
describe("<FORMAT> — minimal file", () => {
  it("does not throw", () => { /* ... */ });
});

// Cases 4 & 5 — Representative real-world conflicts for this format
describe("<FORMAT> — real scenario 1", () => { /* ... */ });
describe("<FORMAT> — real scenario 2", () => { /* ... */ });
```

Build fixtures using real git conflict markers
(`<<<<<<< ours / ||||||| base / ======= / >>>>>>> theirs`). Never mock the
diff algorithms.

---

## Step 5 — Update the docs

In `packages/core/CLAUDE.md`, add the new resolver name to the resolvers list.

---

## Step 6 — Validate

```bash
cd packages/core && pnpm test
```

If the resolver touches the main resolution pipeline, also run the parity
probe to make sure Rust and TypeScript outputs stay in sync:

```bash
cd apps/desktop && pnpm test:parity
```

---

## Common mistakes to avoid

- **Forgetting step 3d** — omitting the new name from the `resolverUsed` union
  causes a TypeScript error that only surfaces at build time.
- **Wrong specificity order** — a generic `*.lock` matcher placed before
  `pnpm-lock.yaml` would silently shadow the existing pnpm resolver.
- **Importing Node.js builtins** — `packages/core` runs in browsers and Tauri
  WebViews; any Node.js import will crash at runtime in those environments.
- **Throwing on parse errors** — always return `lines: null` with a reason;
  let the dispatcher fall through to the text engine.
