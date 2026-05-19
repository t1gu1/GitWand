<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { GitLogEntry } from "../utils/backend";
import { computeDagLayout, parseRefs, type DagLayout } from "../utils/dagLayout";
import { useI18n } from "../composables/useI18n";

import CommitContextMenu from "./CommitContextMenu.vue";

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
}>();

const emit = defineEmits<{
  "select-commit": [hash: string];
  "contextmenu-select": [hash: string];
  // v1.9 — commit context menu (added to graph too)
  editCommit: [entry: GitLogEntry];
  splitCommit: [entry: GitLogEntry];
  checkoutCommit: [entry: GitLogEntry];
  resetToCommit: [entry: GitLogEntry, mode?: "soft" | "mixed" | "hard"];
  revertCommit: [entry: GitLogEntry];
  createBranchFromCommit: [entry: GitLogEntry];
  tagCommit: [entry: GitLogEntry];
  cherryPickCommit: [entry: GitLogEntry];
  viewOnForge: [entry: GitLogEntry];
}>();

// ─── Context menu ────────────────────────────────────
interface CommitCtxMenu {
  visible: boolean;
  x: number;
  y: number;
  entry: GitLogEntry | null;
  idx: number;
}
const ctxMenu = ref<CommitCtxMenu>({ visible: false, x: 0, y: 0, entry: null, idx: -1 });

function openCommitContextMenu(e: MouseEvent, entry: GitLogEntry, idx: number) {
  e.preventDefault();
  e.stopPropagation();
  // Select the commit for the right sidebar to update, but don't emit 'select-commit'
  // which is wired in App.vue to change the view to 'history'.
  // App.vue has selectCommit(hash) exposed, but since we are emitting, we need a separate event
  // for "silent" selection if we wanted it, but let's just emit a new event or rely on the parent.
  // Actually, App.vue wires `@select-commit="(hash) => { selectCommit(hash); viewMode = 'history'; }"`
  // Let's emit a new event just for selection without navigation.
  emit("contextmenu-select", entry.hashFull);
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, entry, idx };
}

function closeCommitContextMenu() {
  ctxMenu.value.visible = false;
}

onMounted(() => {
  window.addEventListener("click", closeCommitContextMenu);
  window.addEventListener("contextmenu", closeCommitContextMenu, { capture: false });
});

// ─── DAG layout ──────────────────────────────────────
// R6 — fingerprint cache: we compare first/last hash + length.
// When getGitLog() returns a new array with the same content
// (e.g. after `.map()` in the parent), we avoid recomputing the
// full O(N*L) layout.  Saves ~1-5 ms on every status poll tick.
let _prevFingerprint = "";
let _cachedLayout: DagLayout | null = null;
const layout = computed<DagLayout>(() => {
  const commits = props.commits;
  const n = commits.length;
  const fp = n + ':' + (commits[0]?.hashFull ?? '') + ':' + (commits[n - 1]?.hashFull ?? '');
  if (fp === _prevFingerprint && _cachedLayout) return _cachedLayout;
  _prevFingerprint = fp;
  _cachedLayout = computeDagLayout(commits);
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
  const idx = props.commits.findIndex(
    (c) => c.hashFull === sha || c.hashFull.startsWith(sha) || sha.startsWith(c.hashFull),
  );
  return idx; // -1 when not found in current window (no dimming)
});

/** Returns true when the commit at `index` is shared history (should be dimmed). */
function isSharedHistory(index: number): boolean {
  const fp = forkPointIndex.value;
  return fp !== -1 && index >= fp;
}

// ─── Rendering constants ─────────────────────────────
const ROW_H = 32;       // height per commit row
const LANE_W = 16;      // width per lane
const NODE_R = 4;       // node circle radius
const GRAPH_PAD = 12;   // left padding before first lane
const SVG_MIN_W = 60;   // minimum graph column width

const graphWidth = computed(() => {
  return Math.max(SVG_MIN_W, GRAPH_PAD + (layout.value.maxLane + 1) * LANE_W + GRAPH_PAD);
});

const totalHeight = computed(() => props.commits.length * ROW_H);

// ─── Lane colours (use CSS tokens via computed) ────────
const LANE_COLORS_TOKENS = [
  "var(--color-info)",       // blue
  "var(--color-success)",    // green
  "var(--color-warning)",    // amber
  "var(--color-danger)",     // red
  "var(--color-accent)",     // purple
  "var(--color-info)",       // cyan (reuse info)
  "var(--color-accent)",     // pink (reuse accent)
  "var(--color-success)",    // lime (reuse success)
];

function laneColor(lane: number): string {
  return LANE_COLORS_TOKENS[lane % LANE_COLORS_TOKENS.length];
}

// ─── SVG path helpers ────────────────────────────────
function cx(lane: number): number {
  return GRAPH_PAD + lane * LANE_W + LANE_W / 2;
}

function cy(index: number): number {
  return index * ROW_H + ROW_H / 2;
}

/** Build an SVG path for an edge */
function edgePath(e: { fromIndex: number; fromLane: number; toIndex: number; toLane: number }): string {
  const x1 = cx(e.fromLane);
  const y1 = cy(e.fromIndex);
  const x2 = cx(e.toLane);
  const y2 = cy(e.toIndex);

  if (x1 === x2) {
    // Straight vertical
    return `M${x1},${y1} L${x2},${y2}`;
  }
  // Curved: use bezier for lane changes
  const midY = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
}

// ─── Helpers ─────────────────────────────────────────
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

function commitRefs(entry: GitLogEntry) {
  return parseRefs(entry.refs);
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
  const total = props.commits.length;
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
  for (let i = first; i <= last; i++) {
    const entry = props.commits[i];
    if (entry) out.push({ entry, index: i });
  }
  return out;
});
</script>

<template>
  <div class="cg" v-if="commits.length > 0">
    <div class="cg-scroll" ref="scrollContainer" @scroll="onScroll">
      <!-- SVG graph column -->
      <svg
        class="cg-svg"
        :width="graphWidth"
        :height="totalHeight"
        :viewBox="`0 0 ${graphWidth} ${totalHeight}`"
      >
        <!-- Edges first (behind nodes). R6: only visible edges are emitted.
             Key uses content (lanes + indices) so Vue can re-use DOM nodes
             stably across scrolls without stale-key collisions. -->
        <path
          v-for="edge in visibleEdges"
          :key="'e-' + edge.fromIndex + '-' + edge.toIndex + '-' + edge.fromLane + '-' + edge.toLane"
          :d="edgePath(edge)"
          :stroke="laneColor(edge.fromLane)"
          :stroke-width="edge.isMerge ? 1.2 : 1.6"
          :stroke-dasharray="edge.isMerge ? '3,3' : 'none'"
          fill="none"
          stroke-linecap="round"
          :opacity="isSharedHistory(edge.fromIndex) ? 0.25 : 1"
        />
        <!-- Nodes (R6: visible only). -->
        <g
          v-for="node in visibleNodes"
          :key="'n' + node.index"
          class="cg-node"
          :opacity="isSharedHistory(node.index) ? 0.25 : 1"
          @click="emit('select-commit', node.hash)"
          @contextmenu="openCommitContextMenu($event, commits[node.index], node.index)"
        >
          <!-- Merge commit: bigger open circle -->
          <circle
            v-if="node.parents.length > 1"
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="NODE_R + 1"
            :stroke="laneColor(node.lane)"
            stroke-width="2"
            fill="var(--color-bg)"
          />
          <!-- Normal commit: filled circle -->
          <circle
            v-else
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
          }"
          :style="{ top: vc.index * ROW_H + 'px', height: ROW_H + 'px' }"
          @click="emit('select-commit', vc.entry.hashFull)"
          @contextmenu="openCommitContextMenu($event, vc.entry, vc.index)"
        >
          <!-- Ref badges -->
          <span
            v-for="r in commitRefs(vc.entry)"
            :key="r.name"
            class="cg-ref"
            :class="`cg-ref--${r.type}`"
          >{{ r.name }}</span>
          <!-- Message -->
          <span class="cg-msg">{{ vc.entry.message }}</span>
          <!-- Author + date -->
          <span class="cg-meta muted">
            <span>{{ vc.entry.author }}</span>
            <span class="cg-sep">&middot;</span>
            <span>{{ formatDate(vc.entry.date) }}</span>
            <span class="cg-sep">&middot;</span>
            <span class="mono cg-hash">{{ vc.entry.hash }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <CommitContextMenu
      v-if="ctxMenu.visible && ctxMenu.entry"
      :entry="ctxMenu.entry"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :idx="ctxMenu.idx"
      @close="closeCommitContextMenu"
      @checkout="(entry) => emit('checkoutCommit', entry)"
      @reset="(entry, mode) => emit('resetToCommit', entry, mode)"
      @revert="(entry) => emit('revertCommit', entry)"
      @create-branch="(entry) => emit('createBranchFromCommit', entry)"
      @tag="(entry) => emit('tagCommit', entry)"
      @cherry-pick="(entry) => emit('cherryPickCommit', entry)"
      @view-on-forge="(entry) => emit('viewOnForge', entry)"
      @edit-commit="(entry) => emit('editCommit', entry)"
      @split-commit="(entry) => emit('splitCommit', entry)"
    />
  </div>
  <div v-else class="cg-empty muted">
    {{ t('log.noCommit') }}
  </div>
</template>

<style scoped>
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

.cg-node {
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

.cg-ref--branch,
.cg-ref--head {
  background: var(--color-accent);
  color: var(--color-accent-text);
}

.cg-ref--remote {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.cg-ref--tag {
  background: var(--color-warning);
  color: var(--color-accent-text);
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

.cg-hash {
  font-size: 10px;
  color: var(--color-accent);
}

.cg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  font-size: 13px;
}
</style>
