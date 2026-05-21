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
      const idx: number = hashToIndex.get(h)!;
      h = commits[idx].parents[0];
    }
  }

  const hashToLane = new Map<string, number>();
  const freeLanes: number[] = [];
  let lanesAllocated = 0;
  // Reference-count per lane. A lane only enters the cooldown queue when its
  // count drops to 0. freeLanes may contain stale entries (re-claimed lanes) —
  // allocLane skips them via the !lanePendingCount.has() guard.
  const lanePendingCount = new Map<number, number>();
  // Edge-duration reservations: when an edge is created from child (lane X)
  // to parent P, lane X stays reserved until P is processed. This prevents
  // sibling branches from reusing the same column while a longer edge is
  // still visually traversing it.
  const parentReservations = new Map<string, number[]>();
  // Cooldown: after a lane's last edge terminates, wait this many rows before
  // allowing reuse. Prevents two unrelated branches from appearing on the same
  // column with less than 3 commits of visual gap between them.
  const LANE_REUSE_COOLDOWN = 3;
  // cooldownMap[row] = list of lanes that become free at that row.
  const cooldownMap = new Map<number, number[]>();
  let maxLane = 0;

  function allocLane(): number {
    // Pick the lowest-numbered available free lane so the graph stays
    // compact and left-aligned (new branches fill leftward gaps first).
    let bestIdx = -1;
    let bestLane = Infinity;
    for (let j = 0; j < freeLanes.length; j++) {
      const c = freeLanes[j];
      if (!lanePendingCount.has(c) && c < bestLane) {
        bestLane = c;
        bestIdx = j;
      }
    }
    if (bestIdx !== -1) {
      freeLanes.splice(bestIdx, 1);
      return bestLane;
    }
    return lanesAllocated++;
  }

  function claimLane(hash: string, lane: number): void {
    hashToLane.set(hash, lane);
    lanePendingCount.set(lane, (lanePendingCount.get(lane) ?? 0) + 1);
    if (lane > maxLane) maxLane = lane;
  }

  function releaseRef(lane: number, row: number): void {
    const n = (lanePendingCount.get(lane) ?? 1) - 1;
    if (n <= 0) {
      lanePendingCount.delete(lane);
      // Schedule reuse after cooldown rows so visually adjacent branches
      // don't share a column with fewer than LANE_REUSE_COOLDOWN empty rows.
      const freeAtRow = row + LANE_REUSE_COOLDOWN;
      const list = cooldownMap.get(freeAtRow) ?? [];
      list.push(lane);
      cooldownMap.set(freeAtRow, list);
    } else {
      lanePendingCount.set(lane, n);
    }
  }

  function releaseClaim(hash: string, row: number): void {
    const lane = hashToLane.get(hash);
    if (lane !== undefined) {
      hashToLane.delete(hash);
      releaseRef(lane, row);
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

  // Move a hash from its current (wrong) lane to lane 0 without disturbing
  // reference counts more than necessary. Called when a trunk commit was
  // pre-claimed to a non-0 lane before we knew it was trunk.
  function relaneToTrunk(h: string): void {
    const wrongLane = hashToLane.get(h);
    if (wrongLane === undefined || wrongLane === 0) return;
    const n = lanePendingCount.get(wrongLane) ?? 1;
    if (n <= 1) lanePendingCount.delete(wrongLane);
    else lanePendingCount.set(wrongLane, n - 1);
    hashToLane.set(h, 0);
    if (maxLane < 0) maxLane = 0;
    lanePendingCount.set(0, (lanePendingCount.get(0) ?? 0) + 1);
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const hash = commit.hashFull;

    // Drain any lanes whose cooldown expires at this row.
    const cooled = cooldownMap.get(i);
    if (cooled) {
      for (const lane of cooled) freeLanes.push(lane);
      cooldownMap.delete(i);
    }

    // Release edge-duration reservations that were waiting for this commit.
    const reserved = parentReservations.get(hash);
    if (reserved) {
      for (const lane of reserved) releaseRef(lane, i);
      parentReservations.delete(hash);
    }

    // Trunk commits must always land on lane 0, even if a merge-parent edge
    // from a later-processed (newer) commit pre-claimed them to another lane.
    if (trunkSet.has(hash)) {
      if (!hashToLane.has(hash)) claimLane(hash, 0);
      else relaneToTrunk(hash);
    }
    const lane = getOrClaimLane(hash);
    nodes.push({ index: i, hash, parents: commit.parents, lane });
    releaseClaim(hash, i);

    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p];
      const parentIndex = hashToIndex.get(parentHash);
      if (parentIndex === undefined) continue;

      let parentLane: number;
      // trunkSet check MUST come before hashToLane: a trunk parent may have
      // been pre-claimed to the wrong lane as a merge-parent of an earlier
      // (newer) commit.  Force it to 0 and fix the reference counts.
      if (trunkSet.has(parentHash)) {
        if (!hashToLane.has(parentHash)) claimLane(parentHash, 0);
        else relaneToTrunk(parentHash);
        parentLane = 0;
      } else if (hashToLane.has(parentHash)) {
        parentLane = hashToLane.get(parentHash)!;
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

/** Parse ref decoration string into individual labels, sorted by priority (branch > remote > tag > head) */
export function parseRefs(refs: string): Array<{ type: "head" | "branch" | "remote" | "tag" | "stash"; name: string }> {
  if (!refs) return [];
  const parsed = refs.split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
    if (r === "HEAD") return { type: "head" as const, name: "HEAD" };
    if (r.startsWith("HEAD -> ")) return { type: "branch" as const, name: r.slice(8) };
    if (r.startsWith("tag: ")) return { type: "tag" as const, name: r.slice(5) };
    if (r === "refs/stash" || r === "stash") return { type: "stash" as const, name: "stash" };
    if (r.includes("/")) return { type: "remote" as const, name: r };
    return { type: "branch" as const, name: r };
  });

  // Sort: Branch (local) > Remote > Tag > Stash > HEAD (detached)
  const weights: Record<string, number> = {
    branch: 1,
    remote: 2,
    tag: 3,
    stash: 4,
    head: 5,
  };

  return parsed.sort((a, b) => {
    // If one is "HEAD -> branch" and other is just "branch", they both have type "branch"
    // but we might want to keep the one from HEAD first if they are different.
    // In practice, git log --decorate gives us what we need.
    return (weights[a.type] ?? 99) - (weights[b.type] ?? 99);
  });
}
