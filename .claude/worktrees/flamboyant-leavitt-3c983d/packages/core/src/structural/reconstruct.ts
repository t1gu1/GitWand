/**
 * Merged file reconstruction from entity merge results.
 *
 * Follows theirs entity order (to preserve incoming structure), interpolating
 * the inter-entity whitespace/comments from the theirs source verbatim.
 * Entities that only exist in ours (ours-added) are appended at the end.
 */

import type { TopLevelEntity } from "./entities.js";
import type { EntityMergeResult } from "./merge.js";

/**
 * Reconstruct the merged source file from entity merge results.
 *
 * Strategy:
 *   1. Walk theirs entities in order.
 *      - Emit the source gap (whitespace, comments) between consecutive
 *        entities, taken verbatim from `theirsSource`.
 *      - Emit the merged text for each entity (or skip if deleted).
 *   2. Emit the trailing content from `theirsSource` after the last entity.
 *   3. Append any entities that only exist in ours (ours-added), separated
 *      by a newline.
 *
 * @param merges         - Merge decision per entity signature
 * @param theirsEntities - Top-level entities from the theirs version (ordered)
 * @param oursEntities   - Top-level entities from the ours version (ordered)
 * @param theirsSource   - Full source text of the theirs version (for gaps)
 */
export function reconstructFile(
  merges: EntityMergeResult[],
  theirsEntities: TopLevelEntity[],
  oursEntities: TopLevelEntity[],
  theirsSource: string,
): string {
  const mergeMap = new Map(merges.map((m) => [m.signature, m]));
  const theirsSigSet = new Set(theirsEntities.map((e) => e.signature));

  const parts: string[] = [];
  let lastEnd = 0;

  // ── 1. Follow theirs entity order ────────────────────────
  for (const entity of theirsEntities) {
    const merge = mergeMap.get(entity.signature);

    // Emit the gap between the previous entity and this one (whitespace / comments)
    const gap = theirsSource.slice(lastEnd, entity.startByte);
    if (gap) parts.push(gap);

    if (merge?.include && merge.mergedText !== null) {
      parts.push(merge.mergedText);
    }
    // If the entity is excluded (deleted / conflicted), we still advance
    // lastEnd to skip over the theirs text for that entity.

    lastEnd = entity.endByte;
  }

  // ── 2. Trailing content after the last theirs entity ─────
  const trailing = theirsSource.slice(lastEnd);
  if (trailing) parts.push(trailing);

  // ── 3. Append ours-added entities ────────────────────────
  for (const entity of oursEntities) {
    if (theirsSigSet.has(entity.signature)) continue; // already handled above

    const merge = mergeMap.get(entity.signature);
    if (!merge?.include || merge.mergedText === null) continue;

    // Ensure there's at least one newline separator before the appended entity
    const last = parts[parts.length - 1] ?? "";
    if (last !== "" && !last.endsWith("\n")) parts.push("\n");

    parts.push(merge.mergedText);
  }

  return parts.join("");
}
