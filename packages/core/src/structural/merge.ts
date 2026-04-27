/**
 * Entity-level merge decisions for structural merge.
 *
 * Given a 3-way entity match, decides which text version to use in the
 * merged output. Conservative by design: if both sides changed an entity
 * differently, we return a "conflict" result and abort the structural merge
 * for the whole file (falling back to the hunk-based resolver).
 */

import type { EntityMatch } from "./matching.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityMergeResult {
  signature: string;
  /**
   * Whether this entity should appear in the merged output.
   * `false` means the entity was deleted by ours, theirs, or both.
   */
  include: boolean;
  /**
   * The text to emit for this entity in the merged file.
   * `null` signals an unresolvable conflict (structural merge aborted).
   */
  mergedText: string | null;
  /** Human-readable explanation of the merge decision */
  reason: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Decide how to merge a single entity based on its 3-way match status.
 *
 * Rules (conservative, correct-by-default):
 * - unchanged            → emit as-is
 * - both-changed-same    → emit the common changed version
 * - ours-only-change     → emit ours
 * - theirs-only-change   → emit theirs
 * - ours-added           → emit ours (append after theirs structure)
 * - theirs-added         → emit theirs
 * - ours-deleted         → omit (unless theirs also modified it → conflict)
 * - theirs-deleted       → omit (unless ours also modified it → conflict)
 * - both-changed-diff    → conflict (return mergedText: null → abort)
 */
export function mergeEntity(match: EntityMatch): EntityMergeResult {
  const { signature, status, base, ours, theirs } = match;

  switch (status) {
    case "unchanged":
      return {
        signature,
        include: true,
        mergedText: (ours ?? theirs ?? base)!.text,
        reason: "unchanged",
      };

    case "both-changed-same":
      if (ours && theirs) {
        return {
          signature,
          include: true,
          mergedText: theirs.text,
          reason: "both changed identically — taking theirs",
        };
      }
      // Both deleted
      return {
        signature,
        include: false,
        mergedText: null,
        reason: "both deleted",
      };

    case "ours-only-change":
      return {
        signature,
        include: ours !== null,
        mergedText: ours?.text ?? null,
        reason: "ours-only change",
      };

    case "theirs-only-change":
      return {
        signature,
        include: theirs !== null,
        mergedText: theirs?.text ?? null,
        reason: "theirs-only change",
      };

    case "ours-added":
      return {
        signature,
        include: true,
        mergedText: ours!.text,
        reason: "ours added",
      };

    case "theirs-added":
      return {
        signature,
        include: true,
        mergedText: theirs!.text,
        reason: "theirs added",
      };

    case "ours-deleted":
      // If theirs also modified this entity, it's a conflict (we'd silently
      // drop a change by theirs). Treat as unresolvable.
      if (theirs && base && theirs.text !== base.text) {
        return {
          signature,
          include: false,
          mergedText: null,
          reason: "conflict: ours deleted, theirs modified",
        };
      }
      return {
        signature,
        include: false,
        mergedText: null,
        reason: "ours deleted",
      };

    case "theirs-deleted":
      // Symmetric: if ours modified the entity, conflict.
      if (ours && base && ours.text !== base.text) {
        return {
          signature,
          include: false,
          mergedText: null,
          reason: "conflict: theirs deleted, ours modified",
        };
      }
      return {
        signature,
        include: false,
        mergedText: null,
        reason: "theirs deleted",
      };

    case "both-changed-diff":
      return {
        signature,
        include: false,
        mergedText: null,
        reason: "conflict: both changed differently",
      };
  }
}

/**
 * Returns `true` if any entity merge has an unresolvable conflict
 * (i.e. the structural merge cannot produce a clean output).
 */
export function hasEntityConflict(merges: EntityMergeResult[]): boolean {
  return merges.some((m) => m.include === false && m.reason.startsWith("conflict:"));
}
