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
  /** Unique ID for this line of development (for distinct coloring) */
  pathId: number;
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
  /** Unique ID for this line of development (inherited from child) */
  pathId: number;
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
  commits: Array<{ hashFull: string; parents: string[]; isBoundary?: boolean }>,
  forceOffset = false,
): DagLayout {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  const hashToIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIndex.set(commits[i].hashFull, i);
  }

  // Active tracks: each slot holds the hash of the commit it's expecting next.
  const tracks: (string | null)[] = [];
  const trackPathIds: number[] = [];
  let nextPathId = 0;
  let maxLane = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const hash = commit.hashFull;

    // Find the leftmost track waiting for this commit
    let lane = tracks.indexOf(hash);
    let pathId: number;

    if (lane === -1) {
      // New branch tip
      let targetLane: number;
      if (forceOffset && !commit.isBoundary) {
        // Reserve lane 0 for trunk, start branch in lane 1
        const emptyIdx = tracks.indexOf(null, 1);
        targetLane = emptyIdx !== -1 ? emptyIdx : Math.max(1, tracks.length);
      } else {
        const emptyIdx = tracks.indexOf(null);
        targetLane = emptyIdx !== -1 ? emptyIdx : tracks.length;
      }

      lane = targetLane;
      pathId = nextPathId++;
      
      // Expand tracks array if needed
      while (tracks.length <= lane) {
        tracks.push(null);
        trackPathIds.push(-1);
      }
      tracks[lane] = hash;
      trackPathIds[lane] = pathId;
    } else {
      pathId = trackPathIds[lane];
    }

    if (lane > maxLane) maxLane = lane;

    nodes.push({
      index: i,
      hash,
      parents: commit.parents,
      lane,
      pathId,
    });

    // Clear ALL tracks waiting for this commit
    for (let t = 0; t < tracks.length; t++) {
      if (tracks[t] === hash) {
        tracks[t] = null;
      }
    }

    // Assign parents to tracks
    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentIndex = hashToIndex.get(parentHash);

      if (parentIndex !== undefined) {
        const parentIsBoundary = commits[parentIndex]?.isBoundary;
        let masterLane = tracks.indexOf(parentHash);
        
        if (masterLane === -1) {
          let targetLane: number;
          if (forceOffset && parentIsBoundary) {
            // Boundary always goes to lane 0
            targetLane = 0;
          } else if (p === 0 && tracks[lane] === null) {
            targetLane = lane;
          } else {
            const emptyIdx = tracks.indexOf(null);
            targetLane = emptyIdx !== -1 ? emptyIdx : tracks.length;
          }

          masterLane = targetLane;
          // Ensure track exists
          while (tracks.length <= masterLane) {
            tracks.push(null);
            trackPathIds.push(-1);
          }
          tracks[masterLane] = parentHash;
          trackPathIds[masterLane] = p === 0 && masterLane === lane ? pathId : nextPathId++;
        }

        // If we aren't the master lane, keep vertical line until the parent row
        if (masterLane !== lane && tracks[lane] === null) {
          tracks[lane] = parentHash;
          trackPathIds[lane] = pathId;
        }

        if (masterLane > maxLane) maxLane = masterLane;
        if (lane > maxLane) maxLane = lane;

        edges.push({
          fromIndex: i,
          fromLane: lane,
          toIndex: parentIndex,
          toLane: masterLane,
          isMerge: p > 0,
          pathId: pathId,
        });
      }
    }

    // Compact trailing nulls
    while (tracks.length > 0 && tracks[tracks.length - 1] === null) {
      tracks.pop();
      trackPathIds.pop();
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
