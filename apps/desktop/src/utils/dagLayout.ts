/**
 * dagLayout.ts — Simple DAG lane assignment for a git commit graph.
 *
 * Takes a list of commits (with parent hashes) and computes:
 * - Which lane (column) each commit is drawn in
 * - Which edges connect commits to their parents
 *
 * The algorithm assigns lanes left-to-right, reusing freed lanes
 * when branches merge back. This produces a compact graph.
 */

export interface DagNode {
  /** Index in the original commit list */
  index: number;
  /** Full commit hash */
  hash: string;
  /** Parent hashes */
  parents: string[];
  /** Assigned lane (0-based column) */
  lane: number;
}

export interface DagEdge {
  /** Source commit index (child) */
  fromIndex: number;
  fromLane: number;
  /** Target commit index (parent) */
  toIndex: number;
  toLane: number;
  /** Is this a merge edge (second+ parent)? */
  isMerge: boolean;
}

export interface DagLayout {
  nodes: DagNode[];
  edges: DagEdge[];
  /** Maximum lane used (for sizing) */
  maxLane: number;
}

/**
 * Compute DAG layout for a list of commits.
 * Commits must be in reverse chronological order (newest first).
 */
export function computeDagLayout(
  commits: Array<{ hashFull: string; parents: string[] }>,
): DagLayout {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  // Map from hash to index in commits array
  const hashToIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIndex.set(commits[i].hashFull, i);
  }

  // Hash → lane lookup for O(1) findLane (instead of O(L) linear scan).
  const hashToLane = new Map<string, number>();
  // Reusable free lane slots (previously occupied but now freed).
  const freeLanes: number[] = [];
  // Active lanes: each slot holds the hash of the commit it's expecting next.
  const lanes: (string | null)[] = [];
  let maxLane = 0;

  function findLane(hash: string): number {
    const existing = hashToLane.get(hash);
    if (existing !== undefined) return existing;

    if (freeLanes.length > 0) {
      const lane = freeLanes.pop()!;
      hashToLane.set(hash, lane);
      return lane;
    }

    const lane = lanes.length;
    hashToLane.set(hash, lane);
    lanes.push(hash);
    return lane;
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const hash = commit.hashFull;
    const lane = findLane(hash);
    if (lane > maxLane) maxLane = lane;

    nodes.push({
      index: i,
      hash,
      parents: commit.parents,
      lane,
    });

    // Free this lane for reuse
    hashToLane.delete(hash);
    freeLanes.push(lane);

    // Assign parents to lanes
    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentIndex = hashToIndex.get(parentHash);

      if (parentIndex !== undefined) {
        let parentLane = hashToLane.get(parentHash);
        if (parentLane === undefined) {
          if (p === 0) {
            hashToLane.set(parentHash, lane);
            parentLane = lane;
          } else {
            parentLane = findLane(parentHash);
          }
        }
        if (parentLane > maxLane) maxLane = parentLane;

        edges.push({
          fromIndex: i,
          fromLane: lane,
          toIndex: parentIndex,
          toLane: parentLane,
          isMerge: p > 0,
        });
      }
    }
  }

  return { nodes, edges, maxLane };
}

/** Parse ref decoration string into individual labels */
export function parseRefs(refs: string): Array<{ type: "head" | "branch" | "remote" | "tag"; name: string }> {
  if (!refs) return [];
  return refs.split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
    if (r === "HEAD") return { type: "head" as const, name: "HEAD" };
    if (r.startsWith("HEAD -> ")) return { type: "branch" as const, name: r.slice(8) };
    if (r.startsWith("tag: ")) return { type: "tag" as const, name: r.slice(5) };
    if (r.includes("/")) return { type: "remote" as const, name: r };
    return { type: "branch" as const, name: r };
  });
}
