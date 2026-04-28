---
name: add-pattern
description: >
  Add a new conflict-resolution pattern to GitWand core. Use this skill
  whenever someone wants to add a pattern, resolution rule, new conflict case,
  new heuristic, teach the resolver to handle a new kind of conflict
  automatically, or extend the pattern registry with a new ConflictType.
---

# Skill: add-pattern

Guide the agent through every step needed to add a new conflict-resolution
pattern from end to end, touching all four required locations in the right
order.

---

## Step 1 — Gather information before writing any code

Ask the following questions up front. Do not start editing files until you
have clear answers.

1. **Name** — What is the snake_case name for this pattern?
   (e.g. `comment_only_change`, `empty_block_insertion`)

2. **Trigger condition** — In plain English, when does this pattern apply?
   Be precise: what must be true of `oursLines`, `theirsLines`, and
   optionally `baseLines` for the pattern to fire?

3. **Resolution strategy** — What should the merged output look like when this
   pattern fires? (accept ours, accept theirs, union, base + additions, etc.)

4. **Confidence score** — What `typeClassification` value (0–100) do you
   propose, and why? What `dataRisk` value (0–100, where 0 = safe)?
   Use the existing patterns as a reference:
   - `same_change` / `one_side_change` / `delete_no_change` → typeClassification 100, dataRisk 0
   - `non_overlapping` → typeClassification 90, dataRisk 20
   - `whitespace_only` / `reorder_only` / `insertion_at_boundary` → typeClassification 85–90, dataRisk 8–20
   - `value_only_change` → typeClassification 72–88, dataRisk 25

5. **Priority** — What numeric priority should this pattern have?
   Lower = evaluated earlier. Current assignments:
   - 10 `same_change`, 20 `delete_no_change`, 30 `one_side_change`
   - 40 `non_overlapping`, 50 `whitespace_only`, 55 `reorder_only`
   - 57 `insertion_at_boundary`, 60 `value_only_change`, 999 `complex`
   Pick a value that places it at the right point in the evaluation chain.

6. **`requires`** — Does the pattern need the base (diff3), work without it
   (diff2), or both? Use `"diff3"`, `"diff2"`, or `"both"`.

---

## Step 2 — Add the ConflictType to `types.ts`

`packages/core/src/types.ts` contains the `ConflictType` union. Add the new
type name there before creating the pattern file — TypeScript will then flag
every location that needs updating.

```typescript
// packages/core/src/types.ts
export type ConflictType =
  | "same_change"
  | "one_side_change"
  // ... existing types ...
  | "my_new_pattern"   // ← add here, with a short comment
  | "complex";
```

Also add a readable summary string for it in the `buildSummary()` switch
inside `packages/core/src/classifier.ts`:

```typescript
case "my_new_pattern":
  return "One-line human-readable description of the resolution.";
```

---

## Step 3 — Create the pattern file

Create `packages/core/src/patterns/<name>.ts`.

The file must export a default `PatternPlugin` object — not a plain function.
Copy the structure below and fill in every field.

```typescript
/**
 * Pattern `my_new_pattern`
 *
 * <Two-sentence description of what this pattern detects and why it is safe
 * to auto-resolve.>
 *
 * Priority: <N> (<before/after which existing pattern>)
 * Requires: <diff3 | diff2 | both>
 */

import type { ClassifyInput, ConfidenceScore, PatternPlugin } from "../types.js";
import { scopeImpact, makeScore } from "./utils.js";

const myNewPattern: PatternPlugin = {
  type: "my_new_pattern",
  priority: <N>,
  requires: "<diff3|diff2|both>",

  detect(h: ClassifyInput): boolean {
    // Return true when this pattern applies.
    // Be conservative — false positives are worse than false negatives.
    return false; // replace with real logic
  },

  confidence(h: ClassifyInput): ConfidenceScore {
    const totalLines = Math.max(h.oursLines.length, h.theirsLines.length);
    return makeScore(
      <typeClassification>,  // 0–100, certainty of the classification
      <dataRisk>,            // 0–100, 0 = no data loss risk
      scopeImpact(totalLines),
      ["<booster: why we are confident>"],
      ["<penalty: why we are cautious, or empty array>"],
    );
  },

  explanation(h: ClassifyInput): string {
    return "Human-readable explanation shown in the UI (explain mode).";
  },

  passReason(h: ClassifyInput): string {
    return "Shown in DecisionTrace when this pattern matched.";
  },

  failReason(h: ClassifyInput): string {
    return "Shown in DecisionTrace when this pattern was tested but did not match.";
  },
};

export default myNewPattern;
```

### Critical: context-line detection

If your `detect()` function ever inspects raw diff lines for context vs.
added/removed:

```typescript
// CORRECT — empty strings do NOT become phantom context lines
const isContext = (line: string) => line.startsWith(' ');

// WRONG — empty string passes this test and produces phantom context lines
const isContext = (line: string) => !line.startsWith('\\');
```

---

## Step 4 — Register the pattern in `classifier.ts`

`packages/core/src/classifier.ts` owns the pattern registry. Add an import
and add the plugin to the `PATTERNS` array in priority order.

```typescript
// 1. Add the import near the other pattern imports
import myNewPattern from "./patterns/my-new-pattern.js";

// 2. Add to PATTERNS array — the array order is cosmetic (sort is by .priority),
//    but keep it in priority order for readability
const PATTERNS: PatternPlugin[] = [
  sameChange,           // priority 10
  // ...
  myNewPattern,         // priority <N>  ← add here
  // ...
  complex,              // priority 999 — MUST stay last
];
```

`complex` must always remain the last entry (priority 999, `detect()` always
returns `true`) — it is the fallback for every unrecognized conflict.

---

## Step 5 — Add a resolution case in `resolver/assemble.ts`

`packages/core/src/resolver/assemble.ts` contains the `assembleResolution()`
function, which switches on `hunk.type` to produce merged lines. Every new
`ConflictType` needs a `case` here, otherwise the pattern will be classified
correctly but its resolution will never be assembled.

```typescript
case "my_new_pattern": {
  // Produce the merged lines according to the resolution strategy.
  const merged = /* ... */;
  return {
    lines: merged,
    reason: "Short one-line reason logged in verbose mode.",
  };
}
```

Place the new `case` near the patterns of similar priority. Return
`{ lines: null, reason: "..." }` if under certain option flags the pattern
should refuse to auto-resolve (see `whitespace_only` for an example).

---

## Step 6 — Write the tests

Create `packages/core/src/__tests__/patterns/<name>.test.ts`.

Minimum coverage: **10 test cases**.

```typescript
import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

describe("<name> — should resolve", () => {
  // At least 5 cases where the pattern fires and produces the expected output.
  // Include at least one diff3 case (with ||||||| base section) and one diff2.
  // Include at least one case with empty strings.
  it("resolves <scenario>", () => {
    const input = [
      "<<<<<<< ours",
      /* ours lines */
      "||||||| base",
      /* base lines */
      "=======",
      /* theirs lines */
      ">>>>>>> theirs",
    ].join("\n");
    const result = resolve(input, "src/file.ts");
    expect(result.hunks[0].type).toBe("<name>");
    expect(result.stats.autoResolved).toBe(1);
    expect(result.mergedContent).toBe(/* expected output */);
  });
});

describe("<name> — should NOT resolve", () => {
  // At least 5 cases where the pattern must NOT fire (returns null / classified
  // as a different type). These guard against false positives.
  // Include at least one edge case (single line, all-empty lines, etc.).
  it("does not resolve when <counter-scenario>", () => {
    const input = [
      "<<<<<<< ours",
      /* ours lines that look similar but must not match */
      "=======",
      /* theirs lines */
      ">>>>>>> theirs",
    ].join("\n");
    const result = resolve(input, "src/file.ts");
    expect(result.hunks[0].type).not.toBe("<name>");
  });
});
```

---

## Step 7 — Check Rust parity

Open `apps/desktop/src-tauri/examples/parity_probe.rs` and check whether the
new pattern corresponds to a conflict type that the Rust side also classifies.

The parity probe binary is compiled and run by `pnpm test:parity` (from
`apps/desktop/`). If the Rust classifier uses a matching concept, add the
equivalent classification logic there and update the parity fixtures.

If the new pattern is purely a TypeScript-side heuristic with no Rust
equivalent, add a comment in `parity_probe.rs` documenting that this type
is TS-only.

---

## Step 8 — Validation

Run both suites before marking the task done:

```bash
# TypeScript unit tests
cd packages/core && pnpm test

# Rust ↔ TypeScript parity tests
cd apps/desktop && pnpm test:parity
```

Both must pass with zero failures. If the parity suite fails, the Rust
implementation is out of sync — fix it before merging.
