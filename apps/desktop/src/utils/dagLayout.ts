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
  trunkHash?: string,
): DagLayout {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  const hashToIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIndex.set(commits[i].hashFull, i);
  }

  // Trace the trunk first-parent chain — every commit on it is forced to
  // lane 0 regardless of processing order. "Trunk" is the current HEAD
  // branch lineage (HEAD → ancestors through first-parent).
  const trunkSet = new Set<string>();
  if (trunkHash && hashToIndex.has(trunkHash)) {
    let h: string | undefined = trunkHash;
    while (h && hashToIndex.has(h)) {
      trunkSet.add(h);
      const idx = hashToIndex.get(h)!;
      h = commits[idx].parents[0];
    }
  }

  const hashToLane = new Map<string, number>();
  const freeLanes: number[] = [];
  let lanesAllocated = 0;
  // Reference-count per lane. A lane only enters freeLanes when its count
  // drops to 0. freeLanes may contain stale entries (re-claimed lanes) —
  // allocLane skips them via the !lanePendingCount.has() guard.
  const lanePendingCount = new Map<number, number>();
  // Edge-duration reservations: when an edge is created from child (lane X)
  // to parent P, lane X stays reserved until P is processed. This prevents
  // sibling branches from reusing the same column while a longer edge is
  // still visually traversing it.
  const parentReservations = new Map<string, number[]>();
  let maxLane = 0;

  function allocLane(): number {
    while (freeLanes.length > 0) {
      const c = freeLanes.pop()!;
      if (!lanePendingCount.has(c)) return c;
    }
    return lanesAllocated++;
  }

  function claimLane(hash: string, lane: number): void {
    hashToLane.set(hash, lane);
    lanePendingCount.set(lane, (lanePendingCount.get(lane) ?? 0) + 1);
    if (lane > maxLane) maxLane = lane;
  }

  function releaseRef(lane: number): void {
    const n = (lanePendingCount.get(lane) ?? 1) - 1;
    if (n <= 0) {
      lanePendingCount.delete(lane);
      freeLanes.push(lane);
    } else {
      lanePendingCount.set(lane, n);
    }
  }

  function releaseClaim(hash: string): void {
    const lane = hashToLane.get(hash);
    if (lane !== undefined) {
      hashToLane.delete(hash);
      releaseRef(lane);
    }
  }

  function getOrClaimLane(hash: string): number {
    const existing = hashToLane.get(hash);
    if (existing !== undefined) return existing;
    const lane = allocLane();
    claimLane(hash, lane);
    return lane;
  }

  function reserveUntilParent(parentHash: string, lane: number): void {
    lanePendingCount.set(lane, (lanePendingCount.get(lane) ?? 0) + 1);
    const list = parentReservations.get(parentHash) ?? [];
    list.push(lane);
    parentReservations.set(parentHash, list);
  }

  // Pre-seed: trunk head starts on lane 0.
  if (trunkHash && hashToIndex.has(trunkHash)) {
    lanesAllocated = 1;
    claimLane(trunkHash, 0);
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const hash = commit.hashFull;

    // Release edge-duration reservations that were waiting for this commit.
    const reserved = parentReservations.get(hash);
    if (reserved) {
      for (const lane of reserved) releaseRef(lane);
      parentReservations.delete(hash);
    }

    const lane = getOrClaimLane(hash);
    nodes.push({ index: i, hash, parents: commit.parents, lane });
    releaseClaim(hash);

    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentIndex = hashToIndex.get(parentHash);
      if (parentIndex === undefined) continue;

      let parentLane: number;
      if (hashToLane.has(parentHash)) {
        parentLane = hashToLane.get(parentHash)!;
      } else if (trunkSet.has(parentHash)) {
        // Trunk-chain parent always on lane 0.
        claimLane(parentHash, 0);
        parentLane = 0;
      } else if (p === 0) {
        // First non-trunk parent inherits this lane (straight continuation).
        claimLane(parentHash, lane);
        parentLane = lane;
      } else {
        // Merge parents get a fresh lane.
        parentLane = getOrClaimLane(parentHash);
      }

      // Keep this commit's lane reserved until the parent is processed so
      // the visual column stays occupied for the full height of the edge.
      // Without this, sibling branches sharing the same parent reuse the
      // same column and appear falsely chained.
      reserveUntilParent(parentHash, lane);

      edges.push({
        fromIndex: i,
        fromLane: lane,
        toIndex: parentIndex,
        toLane: parentLane,
        isMerge: p > 0,
      });
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
