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
  mainBranchHash?: string,
): DagLayout {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  const hashToIndex = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIndex.set(commits[i].hashFull, i);
  }

  // Trace the main branch first-parent chain so every commit on it is
  // forced to lane 0, regardless of processing order.
  const mainChainSet = new Set<string>();
  if (mainBranchHash && hashToIndex.has(mainBranchHash)) {
    let h: string | undefined = mainBranchHash;
    while (h && hashToIndex.has(h)) {
      mainChainSet.add(h);
      const idx = hashToIndex.get(h)!;
      h = commits[idx].parents[0];
    }
  }

  const hashToLane = new Map<string, number>();
  const freeLanes: number[] = [];
  // lanes.length doubles as "next new lane index".
  let lanesAllocated = 0;
  // Reference count: how many pending commits share a lane.
  // A lane only enters freeLanes when its count reaches 0.
  const lanePendingCount = new Map<number, number>();
  let maxLane = 0;

  function allocLane(): number {
    // Skip any freeLane slot that was re-claimed after being freed
    // (can happen when a main-chain parent grabs a just-released slot).
    while (freeLanes.length > 0) {
      const candidate = freeLanes.pop()!;
      if (!lanePendingCount.has(candidate)) return candidate;
    }
    return lanesAllocated++;
  }

  function claimLane(hash: string, lane: number): void {
    hashToLane.set(hash, lane);
    lanePendingCount.set(lane, (lanePendingCount.get(lane) ?? 0) + 1);
    if (lane > maxLane) maxLane = lane;
  }

  function releaseClaim(hash: string): void {
    const lane = hashToLane.get(hash);
    if (lane === undefined) return;
    hashToLane.delete(hash);
    const n = (lanePendingCount.get(lane) ?? 1) - 1;
    if (n <= 0) {
      lanePendingCount.delete(lane);
      freeLanes.push(lane);
    } else {
      lanePendingCount.set(lane, n);
    }
  }

  function getOrClaimLane(hash: string): number {
    const existing = hashToLane.get(hash);
    if (existing !== undefined) return existing;
    const lane = allocLane();
    claimLane(hash, lane);
    return lane;
  }

  // Pre-seed: reserve lane 0 for the main branch head.
  if (mainBranchHash && hashToIndex.has(mainBranchHash)) {
    lanesAllocated = 1; // slot 0 is taken
    claimLane(mainBranchHash, 0);
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const hash = commit.hashFull;
    const lane = getOrClaimLane(hash);

    nodes.push({ index: i, hash, parents: commit.parents, lane });

    // Release this commit's own claim — its lane stays alive only as long
    // as pending parent claims keep its reference count above zero.
    releaseClaim(hash);

    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentIndex = hashToIndex.get(parentHash);
      if (parentIndex === undefined) continue;

      let parentLane: number;
      if (hashToLane.has(parentHash)) {
        // Parent already has a lane (assigned by an earlier sibling or pre-seeded).
        parentLane = hashToLane.get(parentHash)!;
      } else if (mainChainSet.has(parentHash)) {
        // Main-chain commits always live on lane 0.
        claimLane(parentHash, 0);
        parentLane = 0;
      } else if (p === 0) {
        // First non-main parent inherits this commit's lane (straight continuation).
        claimLane(parentHash, lane);
        parentLane = lane;
      } else {
        // Merge parents (2nd+) get a fresh lane.
        parentLane = getOrClaimLane(parentHash);
      }

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
