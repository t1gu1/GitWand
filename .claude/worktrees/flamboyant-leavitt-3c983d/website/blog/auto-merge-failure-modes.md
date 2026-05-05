---
title: "How often does GitWand's auto-merge get it wrong? A catalog of known failure modes"
description: "Honest catalog of where GitWand's auto-conflict-resolver can be wrong — per-pattern failure modes, structural safeguards, and the design trade-offs behind them."
date: 2026-04-23
---

# How often does GitWand's auto-merge get it wrong? A catalog of known failure modes

A reader [asked on the last post](/blog/automatic-merge-conflict-resolution): *"The resolve-trivial-conflicts-automatically idea is honestly overdue. How often do you see false positives where it thinks it's trivial but isn't?"*

That's the question that forced the whole design. Any auto-resolver that answers it with "zero" is either lying or hasn't been used much. Every pattern-based classifier has an edge, and that edge has trade-offs. The honest answer is to catalog them.

This post is that catalog. For each pattern GitWand ships, I'll show where it can be wrong in principle, the confidence the engine assigns to it, and the structural safeguards that keep the blast radius small in practice. If you've already read [how the classifier works](/blog/automatic-merge-conflict-resolution), this is the inverse-reading: same engine, shown through the lens of its failure modes.

---

## Classification is a hypothesis, not a decision

The first thing worth being precise about: in GitWand a pattern matching is not a verdict. Every match produces a composite confidence score computed from five dimensions:

```
score = typeClassification
      − dataRisk        × 0.40
      − scopeImpact     × 0.15
      − fileFrequency   × 0.10
      + baseAvailability × 0.05
```

(Source: `packages/core/src/patterns/utils.ts:50–73`.)

The hunk only auto-resolves if that score clears a threshold — `high` (68) by default, configurable per-repo via `minConfidence` or per-glob via a policy. A pattern can match with `typeClassification = 88` but, in a file already flagged as a "hot zone", fall to 70 — or, on diff2 without a merge base, fall lower still.

This matters because it means false positives don't live inside the patterns themselves. They live in the gap between "the pattern thinks it has seen X" and "the composite score says it's safe enough to act on". A failure mode is only a real failure if *both* steps get it wrong at once.

---

## The first and most important safeguard: `complex` is never resolved

Before looking at what can go wrong, look at what's structurally impossible.

The `complex` pattern is the fallback — it matches when no other pattern does, with priority 999. Its `detect()` function literally returns `true` (`packages/core/src/patterns/complex.ts:10`). And the resolver's assemble step hardcodes:

```typescript
case "complex":
  return {
    resolvedLines: null,
    autoResolved: false,
    reason: "Conflit complexe — aucune heuristique automatique applicable. Résolution manuelle requise.",
  };
```

(Source: `packages/core/src/resolver/assemble.ts:179–183`.)

No heuristic, no LLM, no clever guess. Overlapping edits on the same lines, where both branches moved the same content in incompatible directions, are always left for the human. The entire rest of the classifier is arranged so that borderline cases fall *into* `complex` rather than being forced into a more confident pattern. When in doubt, the system is designed to not resolve.

That's what the rest of this catalog is about: the narrow lanes where GitWand *does* try to resolve, and where it could still be wrong inside them.

---

## Per-pattern failure modes

### `whitespace_only` — global tab normalization

The pattern detects hunks where ours and theirs differ only in whitespace, by normalizing both sides with:

```typescript
export function normalizeForWhitespaceCheck(lines: string[]): string {
  let normalized = lines.map((l) => l.replace(/\t/g, "  "));
  normalized = normalized.map((l) => l.trim());
  while (normalized.length > 0 && normalized[0] === "") normalized.shift();
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") normalized.pop();
  normalized = normalized.map((l) => l.replace(/  +/g, " "));
  return normalized.join("\n");
}
```

(Source: `packages/core/src/patterns/utils.ts:86–93`.)

**Where it can be wrong.** Tabs are normalized to 2 spaces globally, across all file types. This is safe for JavaScript, TypeScript, Go, Rust, JSON — languages where whitespace is cosmetic. It is not safe for **Python**, **YAML**, or **Makefile**, where whitespace is load-bearing. If ours uses tabs and theirs uses spaces, the normalized forms will match, but applying either side verbatim may produce code that parses differently or, in the Makefile case, breaks outright.

**Current mitigation.** With a diff3 base the confidence sits at 95 (`certain`), but on diff2 it drops to 80 (still `high`) with an explicit penalty logged: `"Sans base (diff2) — hypothèse basée sur la normalisation uniquement"`. The pattern is also opt-in via `resolveWhitespace` — and in the `strict` and `prefer-safety` policies it's disabled by default.

**What's missing.** Language-aware normalization. The normalizer should know that for `.py` and `.yml` and `Makefile`, tab-to-space substitution is itself a semantic change, not a pure cosmetic one. That's tracked; not shipped.

### `value_only_change` — pattern-matched volatile tokens without a base

This pattern is `diff2`-only (`packages/core/src/patterns/value-only-change.ts:7`). It detects hunks where ours and theirs have the same line structure but differ only in tokens that match a set of regex patterns — hashes, UUIDs, semver, ISO timestamps, URLs, short obfuscated IDs:

```typescript
export const VOLATILE_PATTERNS = [
  /^[a-f0-9]{7,64}$/,                                 // hex hashes
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-…-[0-9a-fA-F]{12}$/,// UUIDs
  /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z\d]{6,20}$/, // mixed-case IDs
  /^[~^>=<]*\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/,     // semver
  /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2})?(…)?$/, // timestamps
  /^(https?:)?\/\/\S+$/,                              // URLs
  /^[a-z][a-z0-9]{1,9}-[A-Za-z0-9+/=]{8,}$/,          // prefixed tokens
];
```

(Source: `packages/core/src/patterns/utils.ts:107–115`.)

**Where it can be wrong.** Three real edge cases:

1. A 7-digit hex string that *isn't* a hash — a user-visible color code in a CSS file, a port number written in hex in a config. It matches the hash regex, the line gets classified as volatile, and a meaningful value change gets quietly accepted.
2. A version bump that reverts a fix — `"1.4.2"` vs `"1.3.9"` both match the semver pattern, but picking `theirs` is the *wrong* direction if theirs is the older branch.
3. A timestamp or UUID that carries business meaning — an audit log entry, a seed value in a test fixture.

**Current mitigation.** TypeClassification sits at 88 only when the volatile-token ratio is ≤ 10%. Above that, it drops to 72 or 55, and below 55 the pattern returns `null` and falls through to the next pattern. On a small block (scopeImpact 0), the composite score for the 88 case is ~78 — well into `high` but nowhere near `certain`. The decision trace always records the ratio and the list of tokens matched, so anything that slipped through is auditable after the fact.

**What's missing.** A content-type-aware version of the volatile detector. A hex string in a `.css` file should not be classified the same way as a hex string in a `package-lock.json`. This is the single biggest source of expected false positives on the current engine.

### `insertion_at_boundary` — the diff2 heuristic at the threshold

When both branches only added lines (no deletions, no modifications) and the additions don't overlap, we can safely emit the union. With a diff3 base, the pattern computes the LCS against the base and verifies that removal-sets are empty on both sides (`packages/core/src/patterns/insertion-at-boundary.ts:133–145`). Confidence: 90.

Without a base, the pattern falls back to a *heuristic* union check: one side must be a strict superset of the other when both are deduplicated and normalized (`detectWithoutBase`, lines 98–116). Confidence drops to 68 — precisely on the default `high` threshold.

**Where it can be wrong.** The diff2 heuristic cannot distinguish "ours added lines that theirs happened to remove" from "both sides only added". If the sets look superset-compatible, the pattern trusts that appearance. With an unfortunate set of edits that accidentally dedupes the same way, a true delete-add conflict can look like a pure insertion.

**Current mitigation.** Confidence 68 sits at the very bottom of `high`, and with any `scopeImpact` > 0 it drops to `medium`. Under the default `high` threshold, that means only 1–2-line diff2 insertions are auto-resolved — short enough that the risk window is narrow. The `prefer-safety` and `strict` policies raise `minConfidence`, killing the diff2 case entirely.

### `generated_file` — glob-driven reclassification

If a hunk classified as `complex` lives in a file the system recognizes as auto-generated (lockfiles, minified bundles, manifests, user-defined `generatedFiles` globs), it is reclassified to `generated_file` and resolved by accepting `theirs` with confidence 72 (`packages/core/src/resolver/generated-detection.ts:84–128`).

**Where it can be wrong.** This pattern has **false negatives**, not false positives. If your build produces artifacts that don't match the built-in glob list (`*.min.js`, `dist/*`, `*.lock`, etc.) and you haven't declared them via `.gitwandrc`, the engine will treat your generated file's conflict as a manual-resolution task. That's correct behavior by default — better a false negative than a false positive on generated content — but it's worth being aware of.

The inverse risk — misclassifying a hand-edited file as generated — only happens if you misuse the `generatedFiles` glob in your config. That's a user-input error, not a classifier error.

### `non_overlapping` and `reorder_only` — the LCS corner cases

Both of these require a diff3 base and work by computing the Longest Common Subsequence between base/ours and base/theirs. `non_overlapping` succeeds when the LCS 3-way merge produces a clean output. `reorder_only` detects when ours and theirs contain the exact same lines in different orders — a pure permutation of the base.

**Where it can be wrong.** The LCS is token-agnostic. If ours moves a block from position A to position B and theirs moves an independent block that happens to share lines with the moved block, the LCS can pick a suboptimal alignment and produce a merged output that compiles but reads wrong. Rare in practice, but possible.

**Current mitigation.** Both patterns require diff3, so the base-less failure mode doesn't exist. Confidence is 90 for `non_overlapping` and 92 for `reorder_only`, with scopeImpact docking anything over 10 lines.

---

## The safeguards that keep these rare in practice

Most of the failure modes above would be worse without four design choices that sit above the individual patterns.

**1. The file-frequency penalty.** When a file has already produced N unresolved `complex` hunks, every remaining hunk in that file gets a confidence hit of `N × 20 × 0.10` = `2N` points (`packages/core/src/resolver/policy.ts:92–128`). A file with three complex hunks already drops a `high` hunk (score ≥ 68) down to `medium` (≥ 44) if it was close to the threshold. The intuition: files with lots of overlapping edits are risky territory; don't be confident in *anything* inside them.

**2. The policy framework.** `.gitwandrc` lets you pick a policy per repo (`strict`, `prefer-safety`, `prefer-merge`, `prefer-ours`, `prefer-theirs`) and override it per-glob. A release branch can force `strict` — only `same_change` and `one_side_change`, both of which have near-zero failure surface. A feature branch can opt into `prefer-merge` with a lower threshold. Risk is configurable, not global.

**3. Post-merge validation.** Every file that GitWand writes goes through a validation pass: residual conflict markers are rejected, JSON syntax is checked, and any structural integrity check tied to the file's format is run (`packages/core/src/resolver/validation.ts`). A pattern that resolves something wrong often produces output that fails validation — not a complete guarantee, but a useful last line of defense.

**4. The decision trace.** Every hunk carries a structured `DecisionTrace` listing which patterns were evaluated, which matched, which got skipped for lack of a base, and what the final confidence came out to — with boosters and penalties enumerated. When a false positive does occur, the trace tells you exactly why. This is the difference between a bug you can fix and a heuristic you have to guess at.

---

## What we don't do (yet)

**No rerere-style learning.** Git's `rerere` records how you resolved past conflicts and replays them when the same conflict recurs. GitWand doesn't do this. It's a deliberate omission — for the classifier's safety guarantees to hold, the decision has to be a pure function of the hunk, not a function of history. Adding rerere would introduce a new class of false positives (previously-correct resolution, now-wrong context) that the confidence framework doesn't model. The plan is to expose rerere as an opt-in adjacent feature, not something the core engine relies on.

**No language-aware whitespace.** Flagged above. The fix requires file-type awareness in the normalizer.

**No business-rule-aware volatile detection.** The `value_only_change` regex list is generic. Project-specific hints — "in this repo, `build_number` is never volatile" — are not yet expressible in `.gitwandrc`.

---

## Send me the ones that fooled you

If you've hit a conflict where an auto-resolver somewhere — GitWand's or anyone else's — produced the wrong result, I want it in the test corpus. The current regression suite has 332 tests covering the patterns above, but most of them are synthetic. Real-world near-misses are worth a dozen hand-crafted ones.

Open an issue with the conflict (ours + theirs + base if you have diff3, plus the file type) at [github.com/devlint/GitWand](https://github.com/devlint/GitWand). The patterns are designed to be narrow on purpose — narrow enough that adding "we were wrong on *this* case" is usually a focused, testable change rather than a redesign. That's why the catalog above is this specific. The failure modes are the design.
