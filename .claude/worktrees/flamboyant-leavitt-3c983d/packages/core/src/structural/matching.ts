/**
 * 3-way entity matching for structural merge.
 *
 * Matches top-level entities across the three file versions (base / ours /
 * theirs) using their `signature` as a stable key. Each entity triple is
 * assigned a status that describes what happened to it during the merge.
 */

import type { TopLevelEntity } from "./entities.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityMatchStatus =
  /** Text identical in all three versions */
  | "unchanged"
  /** Changed in ours, unchanged in theirs */
  | "ours-only-change"
  /** Changed in theirs, unchanged in ours */
  | "theirs-only-change"
  /** Both sides made the same change (or both deleted) */
  | "both-changed-same"
  /** Both sides changed differently — unresolvable at entity level */
  | "both-changed-diff"
  /** Added only by ours (not in base, not in theirs) */
  | "ours-added"
  /** Added only by theirs (not in base, not in ours) */
  | "theirs-added"
  /** Deleted by ours (was in base and theirs) */
  | "ours-deleted"
  /** Deleted by theirs (was in base and ours) */
  | "theirs-deleted";

export interface EntityMatch {
  signature: string;
  status: EntityMatchStatus;
  base: TopLevelEntity | null;
  ours: TopLevelEntity | null;
  theirs: TopLevelEntity | null;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function classifyMatch(
  base: TopLevelEntity | null,
  ours: TopLevelEntity | null,
  theirs: TopLevelEntity | null,
): EntityMatchStatus {
  const inBase = base !== null;
  const inOurs = ours !== null;
  const inTheirs = theirs !== null;

  // Not in base → newly added in this merge
  if (!inBase) {
    if (inOurs && inTheirs) {
      return ours!.text === theirs!.text ? "both-changed-same" : "both-changed-diff";
    }
    if (inOurs) return "ours-added";
    if (inTheirs) return "theirs-added";
    // Unreachable: signature would not be in allSigs without being in at least one version
    return "unchanged";
  }

  // Entity present in base — did ours/theirs change or delete it?
  const inBothMissing = !inOurs && !inTheirs;
  if (inBothMissing) return "both-changed-same"; // both deleted = same outcome

  if (!inOurs) return "ours-deleted";
  if (!inTheirs) return "theirs-deleted";

  const oursChanged = ours!.text !== base!.text;
  const theirsChanged = theirs!.text !== base!.text;

  if (!oursChanged && !theirsChanged) return "unchanged";
  if (oursChanged && !theirsChanged) return "ours-only-change";
  if (!oursChanged && theirsChanged) return "theirs-only-change";

  // Both changed
  return ours!.text === theirs!.text ? "both-changed-same" : "both-changed-diff";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute 3-way entity matches between base, ours, and theirs.
 *
 * The returned array covers every unique signature found across all three
 * versions. Order follows: base order → ours-only → theirs-only sigs.
 *
 * @param base   - Entities extracted from the base (ancestor) version
 * @param ours   - Entities extracted from our version (current branch)
 * @param theirs - Entities extracted from their version (incoming branch)
 */
export function matchEntities(
  base: TopLevelEntity[],
  ours: TopLevelEntity[],
  theirs: TopLevelEntity[],
): EntityMatch[] {
  const baseMap = new Map(base.map((e) => [e.signature, e]));
  const oursMap = new Map(ours.map((e) => [e.signature, e]));
  const theirsMap = new Map(theirs.map((e) => [e.signature, e]));

  // Collect all signatures, preserving a sensible order (base → ours-only → theirs-only)
  const seen = new Set<string>();
  const orderedSigs: string[] = [];

  for (const map of [baseMap, oursMap, theirsMap]) {
    for (const sig of map.keys()) {
      if (!seen.has(sig)) {
        seen.add(sig);
        orderedSigs.push(sig);
      }
    }
  }

  return orderedSigs.map((sig) => {
    const b = baseMap.get(sig) ?? null;
    const o = oursMap.get(sig) ?? null;
    const t = theirsMap.get(sig) ?? null;
    return {
      signature: sig,
      status: classifyMatch(b, o, t),
      base: b,
      ours: o,
      theirs: t,
    };
  });
}
