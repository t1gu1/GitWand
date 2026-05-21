<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { GitLogEntry, GitBranch } from "../utils/backend";
import { computeDagLayout, parseRefs, type DagLayout, type DagNode } from "../utils/dagLayout";
import { useI18n } from "../composables/useI18n";
import { filterCommitsLocal } from "../composables/useCommitSearch";

const { t } = useI18n();

const props = defineProps<{
  commits: GitLogEntry[];
  selectedHash?: string | null;
  /** Current branch name for highlighting */
  currentBranch?: string;
  /**
   * SHA of the fork-point commit (from `git merge-base HEAD <upstream>`).
   * Commits at or "below" this SHA (older commits, shared history) are
   * rendered with reduced opacity so branch-specific commits stand out.
   * Optional — no dimming when absent or empty.
   */
  forkPointSha?: string;
  repoStats?: { staged: number; unstaged: number; untracked: number; conflicted: number };
  branches?: GitBranch[];
  stashes?: any[];
}>();

type CommitEvent =
  | "select-commit"
  | "change-view"
  | "edit-commit"
  | "split-commit"
  | "checkout-commit"
  | "checkout-branch"
  | "reset-to-commit"
  | "revert-commit"
  | "create-branch-from-commit"
  | "tag-commit"
  | "cherry-pick-commit"
  | "view-on-forge"
  | "delete-tag"
  | "apply-stash"
  | "pop-stash"
  | "drop-stash";

const emit = defineEmits<{
  "select-commit": [hash: string];
  "change-view": [mode: "changes" | "history"];
  "edit-commit": [entry: GitLogEntry];
  "split-commit": [entry: GitLogEntry];
  "checkout-commit": [entry: GitLogEntry];
  "checkout-branch": [name: string];
  "reset-to-commit": [entry: GitLogEntry, mode?: "soft" | "mixed" | "hard"];
  "revert-commit": [entry: GitLogEntry];
  "create-branch-from-commit": [entry: GitLogEntry];
  "tag-commit": [entry: GitLogEntry];
  "cherry-pick-commit": [entry: GitLogEntry];
  "view-on-forge": [entry: GitLogEntry];
  "delete-branch": [name: string, hasLocal: boolean, hasRemote: boolean, remoteName?: string];
  "delete-tag": [name: string, hasLocal: boolean, hasRemote: boolean];
  "apply-stash": [index: number];
  "pop-stash": [index: number];
  "drop-stash": [index: number];
  "wip-discard-all": [];
  "wip-stash": [];
}>();

// ─── Context menu (v1.9) ─────────────────────────────
interface CommitCtxMenu {
  visible: boolean;
  x: number;
  y: number;
  entry: GitLogEntry | null;
  /** Index in the displayed list — used to restrict some actions to HEAD. */
  idx: number;
  /** The specific branch name that was right-clicked (if any). */
  clickedBranch?: string;
  /** The type of ref that was right-clicked (if any). */
  clickedBranchType?: "head" | "branch" | "remote" | "tag" | "stash";
  /** The specific tag name that was right-clicked (if any). */
  clickedTag?: string;
  /** The specific stash index that was right-clicked (if any). */
  clickedStashIndex?: number;
}
const ctxMenu = ref<CommitCtxMenu>({ visible: false, x: 0, y: 0, entry: null, idx: -1 });

function openCommitContextMenu(e: MouseEvent, entry: GitLogEntry, idx: number, branchName?: string, branchType?: any) {
  if (entry.hashFull === "WIP") return;
  e.preventDefault();
  e.stopPropagation();
  // Select the commit first
  emit("select-commit", entry.hashFull);
  const tag = branchType === "tag" ? branchName : undefined;

  // Identify if this is a stash commit
  const refs = commitRefs(entry);
  let stashIdx: number | undefined;
  if (branchType === "stash" || refs.some(r => r.type === "stash")) {
    const stash = props.stashes?.find((s) => s.hash === entry.hashFull);
    if (stash) {
      stashIdx = stash.index;
    } else if (entry.refs.includes("refs/stash") || entry.refs.includes("(stash)")) {
      // Fallback: if it has the tip-of-stash ref, it's stash@{0}
      stashIdx = 0;
    }
  }

  // If we right-clicked the row (no branchName) but there are tags,
  // we could potentially pick one, but it's ambiguous.
  // For now, we only show tag deletion if a specific tag badge was right-clicked.

  // If no branchName provided, pick a candidate branch from the commit refs if any
  let finalBranchName = branchName;
  let finalBranchType = branchType;

  if (!finalBranchName && !tag && stashIdx === undefined) {
    const branchesAtCommit = refs.filter(r => r.type === 'branch' || r.type === 'remote');
    if (branchesAtCommit.length > 0) {
      // Prioritize branches that are NOT the current one (v2.14)
      const notCurrent = branchesAtCommit.find(r => r.name !== props.currentBranch);
      const candidate = notCurrent || branchesAtCommit[0];
      finalBranchName = candidate.name;
      finalBranchType = candidate.type;
    }
  }

  ctxMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    entry,
    idx,
    clickedBranch: finalBranchName,
    clickedBranchType: finalBranchType || (stashIdx !== undefined ? "stash" : undefined),
    clickedTag: tag,
    clickedStashIndex: stashIdx,
  };
}

/**
 * True when the checkout action should be disabled:
 * - We are already on the branch being clicked
 * - Or we are checking out a commit that is already HEAD (and no specific branch was clicked)
 */
const isCheckoutDisabled = computed(() => {
  if (!ctxMenu.value.entry) return true;
  if (ctxMenu.value.clickedBranch) {
    return ctxMenu.value.clickedBranch === props.currentBranch;
  }
  return isCtxEntryHead.value;
});

function closeCommitContextMenu() {
  ctxMenu.value.visible = false;
}

function onBranchDblClick(branch: { name: string, type: string }) {
  const name = branch.type === 'remote'
    ? branch.name.slice(branch.name.indexOf('/') + 1)
    : branch.name;
  emit('checkout-branch', name);
}

function onRowDblClick(entry: GitLogEntry) {
  if (entry.hashFull === 'WIP') return;
  if (isCurrent(entry)) return;
  const refs = commitRefs(entry);
  const branch = refs.find(r => r.type === 'branch') ?? refs.find(r => r.type === 'remote');
  if (!branch) return;
  onBranchDblClick(branch);
}

function onCtxEmit(event: CommitEvent, mode?: "soft" | "mixed" | "hard", branchName?: string, branchType?: any) {
  const entry = ctxMenu.value.entry;
  if (!entry) return;
  if (event === "reset-to-commit") {
    (emit as any)(event, entry, mode);
  } else if (event === "checkout-commit") {
    (emit as any)(event, entry, branchName, branchType);
  } else {
    (emit as any)(event, entry);
  }
  closeCommitContextMenu();
}

async function onCtxCopySha(full: boolean) {
  const sha = full ? ctxMenu.value.entry?.hashFull : ctxMenu.value.entry?.hash;
  if (sha) await navigator.clipboard.writeText(sha);
  closeCommitContextMenu();
}

async function onCtxCopyBranchName() {
  if (ctxMenu.value.clickedBranch) {
    await navigator.clipboard.writeText(ctxMenu.value.clickedBranch);
  }
  closeCommitContextMenu();
}

async function onCtxCopySummary() {
  const entry = ctxMenu.value.entry;
  if (entry) await navigator.clipboard.writeText(entry.message);
  closeCommitContextMenu();
}

async function onCtxCopyDescription() {
  const entry = ctxMenu.value.entry;
  if (entry?.body) await navigator.clipboard.writeText(entry.body);
  closeCommitContextMenu();
}

const branchToDelete = computed(() => {
  if (!ctxMenu.value.clickedBranch || !props.branches) return null;
  const name = ctxMenu.value.clickedBranch;
  const type = ctxMenu.value.clickedBranchType;

  if (type === "branch" || type === "head") {
    // Standard local branch (or current branch HEAD -> ...)
    const local = props.branches.find((b) => b.name === name && !b.isRemote);
    if (!local) {
      // Fallback: if we can't find it in props.branches, but the graph says it's a branch,
      // it's likely a local branch we just created or haven't loaded yet.
      return { name, localName: name, hasLocal: true, hasRemote: false };
    }
    const remote = props.branches.find(
      (b) => b.isRemote && (b.name === `origin/${name}` || b.name === local.upstream),
    );
    return { name, localName: name, remoteName: remote?.name, hasLocal: true, hasRemote: !!remote };
  } else if (type === "remote") {
    // Remote tracking branch (e.g. origin/main)
    const remote = props.branches.find((b) => b.name === name && b.isRemote);
    // Extract base name from remote name (e.g. origin/main -> main)
    const slashIdx = name.indexOf("/");
    const baseName = slashIdx !== -1 ? name.slice(slashIdx + 1) : name;

    if (!remote) {
      // Fallback: assume it's a remote branch even if not in props.branches
      return { name: baseName, remoteName: name, hasLocal: false, hasRemote: true };
    }

    const local = props.branches.find((b) => !b.isRemote && (b.name === baseName || b.upstream === name));
    return {
      name: baseName,
      localName: local?.name,
      remoteName: name,
      hasLocal: !!local,
      hasRemote: true,
    };
  }
  return null;
});

function onCtxDeleteBranch() {
  const b = branchToDelete.value;
  if (!b) return;
  emit("delete-branch", b.name, b.hasLocal, b.hasRemote, b.remoteName);
  closeCommitContextMenu();
}

const tagToDelete = computed(() => {
  if (!ctxMenu.value.clickedTag) return null;
  return { name: ctxMenu.value.clickedTag, hasLocal: true, hasRemote: true };
});

function onCtxDeleteTag() {
  const t = tagToDelete.value;
  if (!t) return;
  emit("delete-tag", t.name, t.hasLocal, t.hasRemote);
  closeCommitContextMenu();
}

/** True when the commit under the context menu is a merge (>1 parent). */
const isCtxEntryMerge = computed(
  () => (ctxMenu.value.entry?.parents?.length ?? 0) > 1,
);

/** True when the commit under the context menu is the topmost commit (HEAD). */
const isCtxEntryHead = computed(() => {
  const entry = ctxMenu.value.entry;
  if (!entry) return false;
  return isCurrent(entry);
});

onMounted(() => {
  window.addEventListener("click", closeCommitContextMenu);
  window.addEventListener("click", closeWipContextMenu);
  window.addEventListener("contextmenu", closeCommitContextMenu, { capture: false });
  window.addEventListener("keydown", onCtxKey);
});
onUnmounted(() => {
  window.removeEventListener("click", closeCommitContextMenu);
  window.removeEventListener("click", closeWipContextMenu);
  window.removeEventListener("contextmenu", closeCommitContextMenu, { capture: false } as EventListenerOptions);
  window.removeEventListener("keydown", onCtxKey);
});

function onCtxKey(e: KeyboardEvent) {
  if (e.key === "Escape") { closeCommitContextMenu(); closeWipContextMenu(); }
}

// ─── WIP context menu ────────────────────────────────
const wipCtxMenu = ref<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });

function openWipContextMenu(e: MouseEvent) {
  e.preventDefault();
  wipCtxMenu.value = { visible: true, x: e.clientX, y: e.clientY };
}

function closeWipContextMenu() {
  wipCtxMenu.value.visible = false;
}

// ─── WIP commit (v2.14) ──────────────────────────────
// If there are uncommitted changes, we prepend a virtual "WIP" commit to
// the top of the graph, connected to the current HEAD.
const totalChanges = computed(() => {
  if (!props.repoStats) return 0;
  return props.repoStats.staged + props.repoStats.unstaged + props.repoStats.untracked + props.repoStats.conflicted;
});
const hasChanges = computed(() => totalChanges.value > 0);

const displayCommits = computed(() => {
  if (!hasChanges.value) return props.commits;
  const headCommit = props.commits.find(isCurrent);
  if (!headCommit) return props.commits;

  const wip: GitLogEntry = {
    hash: "WIP",
    hashFull: "WIP",
    message: "// WIP",
    author: "",
    email: "",
    date: new Date().toISOString(),
    refs: "",
    parents: [headCommit.hashFull],
    body: "",
  };
  return [wip, ...props.commits];
});

// ─── DAG layout ──────────────────────────────────────
// R6 — fingerprint cache: we compare first/last hash + length.
// When getGitLog() returns a new array with the same content
// (e.g. after `.map()` in the parent), we avoid recomputing the
// full O(N*L) layout.  Saves ~1-5 ms on every status poll tick.
let _prevFingerprint = "";
let _cachedLayout: DagLayout | null = null;
const TRUNK_NAMES = new Set(["main", "master"]);
const layout = computed<DagLayout>(() => {
  const commits = displayCommits.value;
  const n = commits.length;
  // Include currentBranch + hasChanges in fingerprint: branch change or WIP
  // state change must recompute layout even when commit hashes are identical.
  const fp =
    n + ":" + (commits[0]?.hashFull ?? "") + ":" + (commits[n - 1]?.hashFull ?? "") + ":" +
    (props.currentBranch ?? "") + ":" + hasChanges.value;
  if (fp === _prevFingerprint && _cachedLayout) return _cachedLayout;
  _prevFingerprint = fp;

  // Trunk = the lineage to pin on lane 0 (far left).
  // Priority 1: main / master — always lane 0 regardless of current branch.
  // Priority 2: current HEAD branch (if no main/master in view).
  // Priority 3: WIP (edge case: detached HEAD with no trunk branch).
  let trunkHash: string | undefined;
  for (const commit of commits) {
    if (parseRefs(commit.refs).some((r) => r.type === "branch" && TRUNK_NAMES.has(r.name))) {
      trunkHash = commit.hashFull;
      break;
    }
  }
  if (!trunkHash) {
    for (const commit of commits) {
      const refs = parseRefs(commit.refs);
      if (props.currentBranch && refs.some((r) => r.type === "branch" && r.name === props.currentBranch)) {
        trunkHash = commit.hashFull;
        break;
      }
    }
  }
  if (!trunkHash && hasChanges.value) {
    trunkHash = "WIP";
  }

  _cachedLayout = computeDagLayout(commits, trunkHash);
  return _cachedLayout;
});

// ─── Fork Point dimming (v2.11) ──────────────────────
// Commits at or below the fork point (shared history) are displayed with
// reduced opacity. This highlights the commits unique to the current branch.
//
// forkPointIndex is -1 when no fork point is set (no dimming).
// A commit at index >= forkPointIndex is in shared history (dim it).
// A commit at index <  forkPointIndex is branch-specific (full opacity).
//
// Logic: git log is newest-first, so lower index = newer. The fork point
// is the last shared commit. Everything AFTER it in the list is shared.
const forkPointIndex = computed<number>(() => {
  if (!props.forkPointSha) return -1;
  const sha = props.forkPointSha;
  // Match against either full SHA or the 7-char short hash displayed in the UI
  const idx = displayCommits.value.findIndex(
    (c) => c.hashFull === sha || c.hashFull.startsWith(sha) || sha.startsWith(c.hashFull),
  );
  return idx; // -1 when not found in current window (no dimming)
});

/** Returns true when the commit at `index` is shared history (should be dimmed). */
function isSharedHistory(index: number): boolean {
  const fp = forkPointIndex.value;
  if (fp === -1) return false;
  // WIP is never shared history
  if (hasChanges.value && index === 0) return false;
  return index >= fp;
}

// ─── Commit search / highlight ───────────────────────
const searchQuery = ref("");
const currentMatchIdx = ref(-1);

const matchedIndices = computed<number[]>(() => {
  const q = searchQuery.value.trim();
  if (!q) return [];
  const matched = filterCommitsLocal(displayCommits.value, q);
  const matchSet = new Set(matched.map((e) => e.hashFull));
  const indices: number[] = [];
  displayCommits.value.forEach((e, i) => { if (matchSet.has(e.hashFull)) indices.push(i); });
  return indices;
});

watch(matchedIndices, (indices) => {
  if (indices.length === 0) {
    currentMatchIdx.value = -1;
  } else if (currentMatchIdx.value < 0 || currentMatchIdx.value >= indices.length) {
    currentMatchIdx.value = 0;
    scrollToIndex(indices[0]);
  }
});

watch(searchQuery, (q) => {
  if (!q.trim()) currentMatchIdx.value = -1;
});

function scrollToIndex(index: number) {
  const el = scrollContainer.value;
  if (!el) return;
  const top = index * ROW_H;
  const bottom = top + ROW_H;
  if (top < el.scrollTop) {
    el.scrollTop = top - ROW_H;
  } else if (bottom > el.scrollTop + el.clientHeight) {
    el.scrollTop = bottom - el.clientHeight + ROW_H;
  }
}

function navigateSearch(dir: 1 | -1) {
  const count = matchedIndices.value.length;
  if (count === 0) return;
  let next = currentMatchIdx.value + dir;
  if (next < 0) next = count - 1;
  if (next >= count) next = 0;
  currentMatchIdx.value = next;
  scrollToIndex(matchedIndices.value[next]);
}

const matchedHashSet = computed<Set<string>>(() => {
  return new Set(matchedIndices.value.map((i) => displayCommits.value[i]?.hashFull ?? ""));
});

const activeMatchHash = computed<string | null>(() => {
  const idx = matchedIndices.value[currentMatchIdx.value];
  return idx !== undefined ? (displayCommits.value[idx]?.hashFull ?? null) : null;
});

// ─── Rendering constants ─────────────────────────────
const ROW_H = 32; // height per commit row
const LANE_W = 18; // width per lane
const NODE_R = 4; // node circle radius
const GRAPH_PAD = 12; // left padding before first lane
const SVG_MIN_W = 60; // minimum graph column width

const graphWidth = computed(() => {
  return Math.max(SVG_MIN_W, GRAPH_PAD + (layout.value.maxLane + 1) * LANE_W + GRAPH_PAD);
});

const totalHeight = computed(() => displayCommits.value.length * ROW_H);

// ─── Lane colours — rainbow spectrum left-to-right ───────
// 45° hue steps: purple → pink → red → orange → yellow → green → cyan → blue
// Cycles every 8 lanes; each branch gets a visually distinct color.
function laneColor(lane: number): string {
  const hue = (280 + lane * 45) % 360;
  return `hsl(${hue}, 80%, 55%)`;
}

function laneColorTint(lane: number): string {
  const hue = (280 + lane * 45) % 360;
  return `hsla(${hue}, 80%, 55%, 0.09)`;
}

const indexToLane = computed(() => {
  const map = new Map<number, number>();
  for (const node of layout.value.nodes) map.set(node.index, node.lane);
  return map;
});

// ─── SVG path helpers ────────────────────────────────
function cx(lane: number): number {
  return GRAPH_PAD + lane * LANE_W + LANE_W / 2;
}

function cy(index: number): number {
  return index * ROW_H + ROW_H / 2;
}

/** Build an SVG path for an edge — elbow style.
 * Straight down in child lane, then a rounded corner into the parent lane
 * at the parent row level. Creates a visible horizontal segment exactly at
 * the commit where branches connect. */
function edgePath(e: { fromIndex: number; fromLane: number; toIndex: number; toLane: number }): string {
  const x1 = cx(e.fromLane);
  const y1 = cy(e.fromIndex);
  const x2 = cx(e.toLane);
  const y2 = cy(e.toIndex);

  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;

  const r = Math.min(LANE_W * 0.6, (y2 - y1) * 0.35);
  const xSign = x2 < x1 ? -1 : 1;
  return `M${x1},${y1} L${x1},${y2 - r} Q${x1},${y2} ${x1 + xSign * r},${y2} L${x2},${y2}`;
}

/** Build an SVG path for a 5-pointed star centered at (cx, cy) */
function starPath(x: number, y: number): string {
  const R = NODE_R + 1.8; // outer radius
  const r = NODE_R / 2.2; // inner radius
  let d = "";
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const px = x + rad * Math.cos(angle);
    const py = y + rad * Math.sin(angle);
    d += (i === 0 ? "M" : "L") + px.toFixed(1) + "," + py.toFixed(1);
  }
  return d + "Z";
}

// ─── Helpers ─────────────────────────────────────────
function truncate(str: string, limit = 20) {
  if (str.length <= limit) return str;
  return str.slice(0, limit - 1) + "…";
}

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return t("date.minutesAgo", String(diffMin));
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t("date.hoursAgo", String(diffH));
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return t("date.daysAgo", String(diffD));
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch { return raw; }
}

// stash@{1+} have no regular ref decoration (%D empty). Build a hash→index
// map from props.stashes so we can inject a synthetic stash ref for them.
const stashByHash = computed(() => {
  const map = new Map<string, number>();
  for (const s of (props.stashes ?? [])) {
    map.set(s.hash, s.index);
  }
  return map;
});

function commitRefs(entry: GitLogEntry) {
  const refs = parseRefs(entry.refs);
  if (!refs.some(r => r.type === 'stash') && stashByHash.value.has(entry.hashFull)) {
    refs.push({ type: 'stash' as const, name: 'stash' });
  }

  // Re-classify refs using props.branches (v2.14)
  // parseRefs is generic and thinks anything with a '/' is remote.
  // We use our ground-truth branches list to fix this.
  const reclassified = refs.map(r => {
    if (r.type === 'branch' || r.type === 'remote') {
      const match = props.branches?.find(b => b.name === r.name);
      if (match) {
        return { ...r, type: (match.isRemote ? 'remote' : 'branch') as 'remote' | 'branch' };
      }
    }
    return r;
  });

  // Filter out redundant remote tracking branches and noise (v2.14)
  const localBranchNames = new Set(reclassified.filter(r => r.type === 'branch').map(r => r.name));
  const filtered = reclassified.filter(r => {
    // Hide origin/HEAD (noise)
    if (r.name === 'origin/HEAD') return false;

    if (r.type === 'remote') {
      const slashIdx = r.name.indexOf('/');
      if (slashIdx !== -1) {
        const baseName = r.name.slice(slashIdx + 1);
        if (localBranchNames.has(baseName)) return false;
      }
      // Also check against local branches that might have the same name as upstream
      const match = props.branches?.find(b => b.name === r.name && b.isRemote);
      if (match) {
        // Find if any local branch has this remote as its upstream
        const hasLocalUpstream = props.branches?.some(b => !b.isRemote && b.upstream === r.name && localBranchNames.has(b.name));
        if (hasLocalUpstream) return false;
      }
    }
    return true;
  });

  // Sort: tag → current branch → other branches → remote → stash → head
  filtered.sort((a, b) => {
    const rank = (r: { type: string; name: string }) => {
      if (r.type === 'tag') return 0;
      if (r.type === 'branch' && r.name === props.currentBranch) return 1;
      if (r.type === 'branch') return 2;
      if (r.type === 'remote') return 3;
      if (r.type === 'stash') return 4;
      return 5;
    };
    return rank(a) - rank(b);
  });
  return filtered;
}

function isCurrent(entry: GitLogEntry): boolean {
  if (!entry.refs) return false;
  return entry.refs.split(",").some((r) => {
    const trimmed = r.trim();
    return trimmed === "HEAD" || trimmed.startsWith("HEAD -> ");
  });
}

type NodeKind = 'stash' | 'trunk' | 'merge' | 'normal';

function nodeKind(node: DagNode): NodeKind {
  const entry = displayCommits.value[node.index];
  if (!entry) return 'normal';
  const refs = commitRefs(entry);
  if (refs.some(r => r.type === 'stash')) return 'stash';
  if (refs.some(r =>
    (r.type === 'branch' && TRUNK_NAMES.has(r.name)) ||
    (r.type === 'remote' && (r.name.endsWith('/main') || r.name.endsWith('/master')))
  )) return 'trunk';
  if (node.parents.length > 1) return 'merge';
  return 'normal';
}

// ─── R6 viewport culling ─────────────────────────────
// For repos with hundreds of commits, the SVG used to render every edge +
// node + info row at once. We now track the scroll position and only
// render the rows visible (plus an overscan margin for smooth scrolling).
//
// Effects:
//   - SVG <path> for edges and <g> for nodes only emit visible items
//   - <div class="cg-row"> only emits visible rows, positioned via their
//     original `index * ROW_H` so the scrollbar / total height stay correct
//   - On 1000-commit repos, DOM nodes drop from 3*N to ~3*(visibleRows + 2*overscan)
const OVERSCAN_ROWS = 8;
const scrollContainer = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);
const clientHeight = ref(0);

function onScroll() {
  if (scrollContainer.value) {
    scrollTop.value = scrollContainer.value.scrollTop;
  }
}

let _ro: ResizeObserver | null = null;
onMounted(() => {
  if (scrollContainer.value) {
    clientHeight.value = scrollContainer.value.clientHeight;
    _ro = new ResizeObserver(() => {
      if (scrollContainer.value) clientHeight.value = scrollContainer.value.clientHeight;
    });
    _ro.observe(scrollContainer.value);
  }
});
onUnmounted(() => {
  _ro?.disconnect();
  _ro = null;
});

const visibleRange = computed(() => {
  const total = displayCommits.value.length;
  if (total === 0) return { first: 0, last: -1 };
  // Before mount or during a 0-height layout, clientHeight is 0 and we'd
  // render only the overscan. Fall back to a safe minimum so first paint
  // shows something meaningful even before ResizeObserver fires.
  const ch = clientHeight.value > 0 ? clientHeight.value : 600;
  const first = Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN_ROWS);
  const visibleRows = Math.ceil(ch / ROW_H);
  const last = Math.min(total - 1, first + visibleRows + 2 * OVERSCAN_ROWS);
  return { first, last };
});

const visibleNodes = computed(() => {
  const { first, last } = visibleRange.value;
  return layout.value.nodes.filter((n) => n.index >= first && n.index <= last);
});

const visibleEdges = computed(() => {
  const { first, last } = visibleRange.value;
  return layout.value.edges.filter((e) => {
    const lo = Math.min(e.fromIndex, e.toIndex);
    const hi = Math.max(e.fromIndex, e.toIndex);
    // Render any edge that overlaps the visible window — partial overlaps
    // still need the path drawn so the user sees lines entering/leaving
    // the viewport.
    return lo <= last && hi >= first;
  });
});

interface VisibleCommit { entry: GitLogEntry; index: number }
const visibleCommits = computed<VisibleCommit[]>(() => {
  const { first, last } = visibleRange.value;
  const out: VisibleCommit[] = [];
  const commits = displayCommits.value;
  for (let i = first; i <= last; i++) {
    const entry = commits[i];
    if (entry) out.push({ entry, index: i });
  }
  return out;
});
</script>

<template>
  <div class="cg" v-if="displayCommits.length > 0">
    <div class="cg-search-bar">
      <input
        v-model="searchQuery"
        class="cg-search-input"
        type="search"
        :placeholder="t('log.graphSearchPlaceholder')"
        @keydown.enter="navigateSearch(1)"
        @keydown.escape="searchQuery = ''"
      />
      <span v-if="matchedIndices.length > 0" class="cg-search-count">
        {{ t('log.graphSearchCount', currentMatchIdx + 1, matchedIndices.length) }}
      </span>
      <button
        class="cg-search-nav"
        :disabled="matchedIndices.length === 0"
        :title="t('log.graphSearchPrev')"
        :aria-label="t('log.graphSearchPrev')"
        @click="navigateSearch(-1)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
      <button
        class="cg-search-nav"
        :disabled="matchedIndices.length === 0"
        :title="t('log.graphSearchNext')"
        :aria-label="t('log.graphSearchNext')"
        @click="navigateSearch(1)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button
        v-if="searchQuery"
        class="cg-search-nav"
        :title="t('log.graphSearchClear')"
        :aria-label="t('log.graphSearchClear')"
        @click="searchQuery = ''"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cg-scroll" ref="scrollContainer" @scroll="onScroll">
      <!-- SVG graph column -->
      <svg
        class="cg-svg"
        :width="graphWidth"
        :height="totalHeight"
        :viewBox="`0 0 ${graphWidth} ${totalHeight}`"
      >
        <defs>
          <!-- Trunk lane multi-color gradient (vibrant for nodes/edges) -->
          <linearGradient id="trunk-gradient-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color: #c33eff;" />
            <stop offset="33%" style="stop-color: #ffaa3e;" />
            <stop offset="66%" style="stop-color: #3eff88;" />
            <stop offset="100%" style="stop-color: #c33eff;" />
          </linearGradient>
          <!-- Trunk lane multi-color gradient (subtle for row tints) -->
          <linearGradient id="trunk-gradient-tint" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color: hsla(280, 80%, 55%, 0.15);" />
            <stop offset="33%" style="stop-color: hsla(35, 80%, 55%, 0.15);" />
            <stop offset="66%" style="stop-color: hsla(140, 80%, 55%, 0.15);" />
            <stop offset="100%" style="stop-color: hsla(280, 80%, 55%, 0.15);" />
          </linearGradient>
        </defs>

        <!-- Row tints: colored band from the commit node to the SVG right edge -->
        <rect
          v-for="node in visibleNodes"
          :key="'t' + node.index"
          class="cg-row-tint"
          :x="cx(node.lane) - 11"
          :y="node.index * ROW_H + 1"
          :width="graphWidth - cx(node.lane) + 11 + 20"
          :height="ROW_H - 2"
          :fill="nodeKind(node) === 'trunk' ? 'url(#trunk-gradient-tint)' : laneColorTint(node.lane)"
          rx="8"
          @click="node.hash === 'WIP' ? emit('change-view', 'changes') : emit('select-commit', node.hash)"
          @contextmenu="openCommitContextMenu($event, displayCommits[node.index], node.index)"
        />
        <!-- Edges first (behind nodes). R6: only visible edges are emitted.
             Key uses content (lanes + indices) so Vue can re-use DOM nodes
             stably across scrolls without stale-key collisions. -->
        <path
          v-for="edge in visibleEdges"
          :key="'e-' + edge.fromIndex + '-' + edge.toIndex + '-' + edge.fromLane + '-' + edge.toLane"
          :d="edgePath(edge)"
          :stroke="laneColor(edge.fromLane)"
          :stroke-width="edge.isMerge ? 1.2 : 1.6"
          :stroke-dasharray="edge.isMerge || (hasChanges && edge.fromIndex === 0) || stashByHash.has(displayCommits[edge.fromIndex]?.hashFull) ? '3,3' : 'none'"
          fill="none"
          stroke-linecap="round"
          :opacity="isSharedHistory(edge.fromIndex) ? 0.25 : 1"
        />
        <!-- Nodes (R6: visible only). Always fully opaque — dots never fade. -->
        <g
          v-for="node in visibleNodes"
          :key="'n' + node.index"
          class="cg-node"
          @click="node.hash === 'WIP' ? emit('change-view', 'changes') : emit('select-commit', node.hash)"
          @contextmenu="openCommitContextMenu($event, displayCommits[node.index], node.index)"
        >
          <!-- WIP Node: dashed circle -->
          <circle
            v-if="node.hash === 'WIP'"
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="NODE_R + 1.5"
            fill="none"
            :stroke="laneColor(node.lane)"
            stroke-width="1.5"
            stroke-dasharray="3,3"
          />

          <!-- Current commit indicator: outer ring -->
          <circle
            v-else-if="isCurrent(displayCommits[node.index])"
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="nodeKind(node) === 'trunk' ? NODE_R + 4 : (nodeKind(node) === 'merge' ? NODE_R + 3.5 : NODE_R + 2.5)"
            fill="none"
            :stroke="nodeKind(node) === 'trunk' ? 'url(#trunk-gradient-stroke)' : laneColor(node.lane)"
            stroke-width="1.2"
          />

          <!-- Stash commit: dashed square outline, no fill -->
          <rect
            v-if="nodeKind(node) === 'stash'"
            :x="cx(node.lane) - NODE_R"
            :y="cy(node.index) - NODE_R"
            :width="NODE_R * 2"
            :height="NODE_R * 2"
            fill="none"
            :stroke="laneColor(node.lane)"
            stroke-width="1.5"
            stroke-dasharray="2,2"
          />
          <!-- Trunk commit (main/master): star icon (v2.13) -->
          <template v-else-if="nodeKind(node) === 'trunk' && node.hash !== 'WIP'">
            <!-- The Shadow: slightly larger, offset, and semi-transparent with blur -->
            <path
              :d="starPath(cx(node.lane), cy(node.index) - 0.2)"
              fill="rgba(0,0,0,0.5)"
              style="transform: scale(1.5); transform-origin: center; transform-box: fill-box; filter: blur(1px);"
            />

            <!-- The Star -->
            <path
              :d="starPath(cx(node.lane), cy(node.index))"
              fill="url(#trunk-gradient-stroke)"
            />
          </template>
          <!-- Merge commit: solid filled, slightly larger circle -->
          <circle
            v-else-if="nodeKind(node) === 'merge'"
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="NODE_R + 1"
            :fill="laneColor(node.lane)"
          />
          <!-- Normal commit: solid filled circle -->
          <circle
            v-else-if="node.hash !== 'WIP'"
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="NODE_R"
            :fill="laneColor(node.lane)"
          />
        </g>
      </svg>

      <!-- Commit info rows — R6: visible-only with original index for
           positioning. The wrapper keeps `height: totalHeight` so the
           scrollbar matches the full commit list. -->
      <div class="cg-info" :style="{ height: totalHeight + 'px' }">
        <div
          v-for="vc in visibleCommits"
          :key="vc.entry.hashFull"
          class="cg-row"
          :class="{
            'cg-row--selected': vc.entry.hashFull === selectedHash,
            'cg-row--shared': isSharedHistory(vc.index),
            'cg-row--current': isCurrent(vc.entry),
            'cg-row--wip': vc.entry.hashFull === 'WIP',
            'cg-row--match': matchedHashSet.has(vc.entry.hashFull),
            'cg-row--match-active': vc.entry.hashFull === activeMatchHash,
          }"
          :style="{ top: vc.index * ROW_H + 'px', height: ROW_H + 'px' }"
          @click="vc.entry.hashFull === 'WIP' ? emit('change-view', 'changes') : emit('select-commit', vc.entry.hashFull)"
          @dblclick="onRowDblClick(vc.entry)"
          @contextmenu="vc.entry.hashFull === 'WIP' ? openWipContextMenu($event) : openCommitContextMenu($event, vc.entry, vc.index)"
        >
          <template v-if="vc.entry.hashFull === 'WIP'">
            <span class="cg-msg wip-msg">{{ vc.entry.message }}</span>
            <span class="cg-meta wip-meta">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              <span>{{ totalChanges }}</span>
            </span>
          </template>
          <template v-else>
            <!-- Ref badges -->
            <template v-for="(branchList, r_key) in { list: commitRefs(vc.entry) }" :key="r_key">
              <span
                v-for="r in branchList"
                :key="r.name"
                class="cg-ref"
                :class="[`cg-ref--${r.type}`, r.type === 'branch' && r.name === props.currentBranch ? 'cg-ref--branch-current' : '']"
                :style="(r.type === 'branch' || r.type === 'tag' || r.type === 'remote') ? { '--ref-lane-color': laneColor(indexToLane.get(vc.index) ?? 0) } : {}"
                :title="r.name"
                @contextmenu.stop="openCommitContextMenu($event, vc.entry, vc.index, r.name, r.type)"
                @dblclick.stop="onBranchDblClick(r)"
              >{{ branchList.length > 1 ? truncate(r.name) : r.name }}</span>
            </template>
            <!-- Message -->
            <span class="cg-msg">{{ vc.entry.message }}</span>
            <!-- Author + date -->
            <span class="cg-meta muted">
              <span>{{ vc.entry.author }}</span>
              <span class="cg-sep">&middot;</span>
              <span>{{ formatDate(vc.entry.date) }}</span>
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="cg-empty muted">
    {{ t('log.noCommit') }}
  </div>

  <!-- Context menu for commit items (right-click) -->
  <Teleport to="body">
    <ul
      v-if="ctxMenu.visible"
      class="commit-ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      role="menu"
      @click.stop
      @contextmenu.prevent
    >
      <!-- Stash actions (v2.12) — shown ONLY for stash commits -->
      <template v-if="ctxMenu.clickedBranchType === 'stash' && ctxMenu.clickedStashIndex !== undefined">
        <li
          class="commit-ctx-menu-item"
          role="menuitem"
          @click="emit('apply-stash', ctxMenu.clickedStashIndex!); closeCommitContextMenu()"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          <span>{{ t('stash.applyStash') }}</span>
        </li>
        <li
          class="commit-ctx-menu-item"
          role="menuitem"
          @click="emit('pop-stash', ctxMenu.clickedStashIndex!); closeCommitContextMenu()"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          <span>{{ t('stash.popStash') }}</span>
        </li>
        <li
          class="commit-ctx-menu-item commit-ctx-menu-item--danger"
          role="menuitem"
          @click="emit('drop-stash', ctxMenu.clickedStashIndex!); closeCommitContextMenu()"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('stash.dropStash') }}</span>
        </li>
      </template>

      <!-- Standard git actions — hidden for stashes -->
      <template v-else>
        <!-- Navigation -->
        <li
          class="commit-ctx-menu-item"
          :class="{ 'commit-ctx-menu-item--disabled': isCheckoutDisabled }"
          role="menuitem"
          :title="isCheckoutDisabled ? t('commitCtx.checkoutHeadDisabled') : t('commitCtx.checkoutHint')"
          @click="!isCheckoutDisabled && (ctxMenu.clickedBranch ? (emit('checkout-branch', ctxMenu.clickedBranchType === 'remote' ? ctxMenu.clickedBranch.slice(ctxMenu.clickedBranch.indexOf('/') + 1) : ctxMenu.clickedBranch), closeCommitContextMenu()) : onCtxEmit('checkout-commit'))"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span>{{ ctxMenu.clickedBranch ? t('commitCtx.checkoutBranch') : t('commitCtx.checkout') }}</span>
        </li>

        <li
          v-if="ctxMenu.clickedBranch"
          class="commit-ctx-menu-item"
          :class="{ 'commit-ctx-menu-item--disabled': isCtxEntryHead }"
          role="menuitem"
          :title="isCtxEntryHead ? t('commitCtx.checkoutHeadDisabled') : t('commitCtx.checkoutHint')"
          @click="!isCtxEntryHead && onCtxEmit('checkout-commit')"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span>{{ t('commitCtx.checkout') }}</span>
        </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Reset options -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxEmit('reset-to-commit')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8a5 5 0 1 0 1.5-3.5L2 2v4h4L4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.reset') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Branching -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxEmit('create-branch-from-commit')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2v8m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8-4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 0v2a2 2 0 0 1-2 2H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.createBranch') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxEmit('tag-commit')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 2h6l6 6-6 6-6-6V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>
        </svg>
        <span>{{ t('commitCtx.tag') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        :class="{ 'commit-ctx-menu-item--disabled': isCtxEntryHead }"
        role="menuitem"
        :title="isCtxEntryHead ? t('commitCtx.cherryPickHeadDisabled') : undefined"
        @click="!isCtxEntryHead && onCtxEmit('cherry-pick-commit')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="5" cy="13" r="2" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="11" cy="13" r="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M5 11V7a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 4V1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.cherryPick') }}</span>
      </li>

      <!-- Branch Deletion (v2.12) -->
      <template v-if="branchToDelete">
        <li class="commit-ctx-menu-sep" role="separator"></li>
        <li
          class="commit-ctx-menu-item commit-ctx-menu-item--danger"
          role="menuitem"
          @click="onCtxDeleteBranch"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('branchMenu.deleteLabel') }}</span>
        </li>
      </template>

      <!-- Tag Deletion (v2.12) -->
      <template v-if="tagToDelete">
        <li class="commit-ctx-menu-sep" role="separator"></li>
        <li
          class="commit-ctx-menu-item commit-ctx-menu-item--danger"
          role="menuitem"
          @click="onCtxDeleteTag"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('tags.deleteTag') }}</span>
        </li>
      </template>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- History operations -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxEmit('revert-commit')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M5 1L2 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.revert') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Clipboard -->
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCtxCopySha(false)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5" y="4" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyShortSha') }}</span>
      </li>
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCtxCopySha(true)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5" y="4" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 8h3M8 11h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyFullSha') }}</span>
      </li>
      <li
        v-if="ctxMenu.clickedBranch"
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxCopyBranchName"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2v8m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8-4a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.copyBranchName') }}</span>
      </li>
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCtxCopySummary">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12v8H2z" rx="1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M5 7h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copySummary') }}</span>
      </li>
      <li
        v-if="ctxMenu.entry?.body"
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxCopyDescription"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12v8H2z" rx="1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyDescription') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Forge -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="onCtxEmit('view-on-forge')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 2h4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 2L8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.viewOnForge') }}</span>
      </li>
      </template>
    </ul>
  </Teleport>

  <!-- WIP context menu -->
  <Teleport to="body">
    <ul
      v-if="wipCtxMenu.visible"
      class="commit-ctx-menu"
      :style="{ left: wipCtxMenu.x + 'px', top: wipCtxMenu.y + 'px' }"
      role="menu"
      @click.stop
      @contextmenu.prevent
    >
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="emit('wip-stash'); closeWipContextMenu()"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 5h12v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M1 2h14v3H1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M6 8h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('sidebar.footerStash') }}</span>
      </li>
      <li class="commit-ctx-menu-sep" role="separator"></li>
      <li
        class="commit-ctx-menu-item commit-ctx-menu-item--danger"
        role="menuitem"
        @click="emit('wip-discard-all'); closeWipContextMenu()"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4M6 7v5M10 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('sidebar.discardAll') }}</span>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
/* Teleported menu — unscoped so the styles apply after mounting to <body>. */
.commit-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 8px 20px rgba(0, 0, 0, 0.18));
  font-size: var(--font-size-sm);
}

.commit-ctx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}

.commit-ctx-menu-item:hover {
  background: var(--color-bg-tertiary);
}

.commit-ctx-menu-item svg {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.commit-ctx-menu-item--danger:hover {
  background: var(--color-danger-soft, rgba(220, 38, 38, 0.12));
  color: var(--color-danger, #dc2626);
}

.commit-ctx-menu-item--danger:hover svg {
  color: var(--color-danger, #dc2626);
}

.commit-ctx-menu-item--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.commit-ctx-menu-item--disabled:hover {
  background: transparent;
}

.commit-ctx-menu-sep {
  height: 1px;
  background: var(--color-border);
  margin: 3px 6px;
  list-style: none;
}

.cg-search-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.cg-search-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  font-size: 11px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  outline: none;
}

.cg-search-input:focus {
  border-color: var(--color-accent);
}

.cg-search-input::-webkit-search-cancel-button {
  cursor: pointer;
}

.cg-search-count {
  font-size: 10px;
  color: var(--color-text-muted);
  padding: 0 4px;
  flex-shrink: 0;
  white-space: nowrap;
}

.cg-search-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.cg-search-nav:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text);
}

.cg-search-nav:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cg {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.cg-scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  position: relative;
}

.cg-svg {
  flex-shrink: 0;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--color-bg);
}

.cg-node,
.cg-row-tint {
  cursor: pointer;
}

.cg-info {
  flex: 1;
  position: relative;
  min-width: 0;
}

.cg-row {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 0 4px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 1px solid var(--color-border);
  transition: background 0.1s;
  overflow: hidden;
  white-space: nowrap;
}

.cg-row:hover {
  background: var(--color-bg-tertiary);
}

.cg-row--selected {
  background: var(--color-accent-bg, rgba(56, 132, 255, 0.08));
}

.cg-row--current {
  background: var(--color-accent-soft);
}

.cg-row--wip {
  color: var(--color-text-muted);
}

.cg-row--match {
  background: rgba(245, 158, 11, 0.10);
}

.cg-row--match-active {
  background: rgba(245, 158, 11, 0.28) !important;
  outline: 1px solid rgba(245, 158, 11, 0.55);
  outline-offset: -1px;
}

.wip-msg {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 11px;
}

.wip-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-warning);
  font-weight: 600;
}

/* Shared-history commits (pre-fork-point): dimmed to de-emphasise */
.cg-row--shared {
  opacity: 0.45;
}
.cg-row--shared.cg-row--selected {
  opacity: 1; /* Always show selected commit at full opacity */
}

.cg-ref {
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 3px;
  flex-shrink: 0;
  line-height: 1.5;
}

.cg-ref--branch {
  background: transparent;
  color: var(--ref-lane-color, var(--color-accent));
  border: 1px solid var(--ref-lane-color, var(--color-accent));
  font-size: 11px;
  font-weight: 700;
}
.cg-ref--branch-current {
  background: var(--ref-lane-color, var(--color-accent));
  color: #fff;
  border: none;
}
.cg-ref--head {
  background: var(--color-accent);
  color: var(--color-accent-text);
  font-size: 11px;
  font-weight: 700;
}

.cg-ref--remote {
  background: transparent;
  color: var(--ref-lane-color, var(--color-text-muted));
  border: 1px solid var(--ref-lane-color, var(--color-border));
  opacity: 0.75;
}

.cg-ref--tag {
  background: var(--ref-lane-color, var(--color-warning));
  color: #fff;
  border: none;
  font-size: 11px;
  font-weight: 700;
}

.cg-ref--stash {
  background: var(--color-warning-soft, rgba(245, 158, 11, 0.12));
  color: var(--color-warning, #f59e0b);
  border: 1px dashed var(--color-warning, #f59e0b);
  font-size: 11px;
  font-weight: 700;
}

.cg-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--color-text);
}

.cg-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  flex-shrink: 0;
}

.cg-sep {
  opacity: 0.4;
}

.cg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  font-size: 13px;
}
</style>

