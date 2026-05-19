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
   * Scope of the commit log:
   *   "current" → only commits reachable from the current branch HEAD
   *   "all"     → all refs
   */
  logScope?: "current" | "all";
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
  "update:logScope": [scope: "current" | "all"];
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
  // Include logScope in the fingerprint so layout recomputes when switching view focus
  const fp = n + ':' + (commits[0]?.hashFull ?? '') + ':' + (commits[n - 1]?.hashFull ?? '') + ':' + (props.logScope ?? 'all');
  if (fp === _prevFingerprint && _cachedLayout) return _cachedLayout;
  _prevFingerprint = fp;
  _cachedLayout = computeDagLayout(commits, props.logScope === 'current');
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
const ROW_H = 48;       // height per commit row
const LANE_W = 48;      // width per lane (increased from 40 for more fan room)
const NODE_R = 15;      // node circle radius (increased from 14)
const GRAPH_PAD = 24;   // left padding
const SVG_MIN_W = 140;

const graphWidth = computed(() => {
  return Math.max(SVG_MIN_W, GRAPH_PAD + (layout.value.maxLane + 1) * LANE_W + GRAPH_PAD);
});

const totalHeight = computed(() => props.commits.length * ROW_H);

// ─── Path colours (rainbow via HSL) ──────────────────
function pathColor(pathId: number): string {
  // Use a sequential rainbow for the fanned-out tracks
  const hue = (pathId * 32) % 360;
  return `hsl(${hue}, 95%, 55%)`;
}

// ─── SVG path helpers ────────────────────────────────
function cx(lane: number): number {
  return GRAPH_PAD + lane * LANE_W + LANE_W / 2;
}

function cy(index: number): number {
  return index * ROW_H + ROW_H / 2;
}

/** Build an SVG path for an edge — horizontal branching style */
function edgePath(e: { fromIndex: number; fromLane: number; toIndex: number; toLane: number }): string {
  const x1 = cx(e.fromLane);
  const y1 = cy(e.fromIndex);
  const x2 = cx(e.toLane);
  const y2 = cy(e.toIndex);

  if (x1 === x2) {
    // Straight vertical
    return `M${x1},${y1} L${x2},${y2}`;
  }

  // Branching out: horizontal from parent (x2, y2), then vertical to child (x1, y1)
  const r = 8; // sharper corner radius
  
  let d = `M${x2},${y2}`;
  if (x1 > x2) {
    // Branching to the right
    d += ` L${x1 - r},${y2} Q${x1},${y2} ${x1},${y2 - r}`;
  } else {
    // Branching to the left
    d += ` L${x1 + r},${y2} Q${x1},${y2} ${x1},${y2 - r}`;
  }
  d += ` L${x1},${y1}`;
  
  return d;
}

// ─── Avatar helpers ──────────────────────────────────
function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** 
 * Returns a Gravatar URL for the given email. 
 * Falls back to an identicon if no Gravatar exists.
 */
function getAvatarUrl(email: string): string {
  if (!email) return "";
  // Simple non-cryptographic hash for identicon selection
  let hash = 0;
  const s = email.toLowerCase().trim();
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `https://www.gravatar.com/avatar/${hex}?d=identicon&s=40`;
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
    
    // Rationale: When logScope is 'current', we only want to show the fanned-out branch
    // and its explicit boundary link. We should NOT include edges that lead to
    // commits not present in the current filtered log.
    const inRange = lo <= last && hi >= first;
    
    // In 'current' scope, ensure both ends of the edge exist in our commits list
    if (props.logScope === 'current') {
      return inRange && props.commits[e.fromIndex] && props.commits[e.toIndex];
    }

    return inRange;
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
    <!-- Header with scope toggle (v2.9.0) -->
    <div class="cg-header" v-if="logScope">
      <div class="cg-scope">
        <button
          class="cg-scope-btn"
          :class="{ 'cg-scope-btn--active': logScope === 'current' }"
          @click="emit('update:logScope', 'current')"
          :title="t('sidebar.logScopeCurrentTitle', currentBranch ?? '')"
        >
          {{ t('sidebar.logScopeCurrent') }}
        </button>
        <button
          class="cg-scope-btn"
          :class="{ 'cg-scope-btn--active': logScope === 'all' }"
          @click="emit('update:logScope', 'all')"
          :title="t('sidebar.logScopeAllTitle')"
        >
          {{ t('sidebar.logScopeAll') }}
        </button>
      </div>
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
          <!-- Culling-friendly clipPaths for avatars -->
          <clipPath v-for="node in visibleNodes" :key="'cp-' + node.hash" :id="'clip-' + node.hash">
            <circle :cx="cx(node.lane)" :cy="cy(node.index)" :r="NODE_R - 1" />
          </clipPath>
        </defs>

        <!-- Edges first (behind nodes). R6: only visible edges are emitted. -->
        <path
          v-for="edge in visibleEdges"
          :key="'e-' + edge.fromIndex + '-' + edge.toIndex + '-' + edge.fromLane + '-' + edge.toLane"
          :d="edgePath(edge)"
          :stroke="pathColor(edge.pathId)"
          :stroke-width="edge.isMerge ? 1.8 : 3.2"
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
          <!-- Background circle with colored border -->
          <circle
            :cx="cx(node.lane)"
            :cy="cy(node.index)"
            :r="NODE_R"
            :stroke="pathColor(node.pathId)"
            :stroke-width="node.parents.length > 1 ? 4 : 3"
            fill="var(--color-bg)"
          />
          <!-- Avatar Image -->
          <image
            v-if="commits[node.index].email"
            :href="getAvatarUrl(commits[node.index].email)"
            :x="cx(node.lane) - NODE_R + 2"
            :y="cy(node.index) - NODE_R + 2"
            :width="(NODE_R - 2) * 2"
            :height="(NODE_R - 2) * 2"
            :clip-path="`url(#clip-${node.hash})`"
          />
          <!-- Fallback Initials -->
          <text
            v-else
            :x="cx(node.lane)"
            :y="cy(node.index)"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="12"
            font-weight="700"
            fill="var(--color-text-muted)"
          >{{ initials(commits[node.index].author) }}</text>
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

.cg-header {
  padding: 8px 12px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.cg-scope {
  display: flex;
  background: var(--color-bg-secondary);
  padding: 2px;
  border-radius: var(--radius-md, 6px);
  gap: 2px;
}

.cg-scope-btn {
  border: none;
  background: transparent;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: all 0.15s;
}

.cg-scope-btn:hover {
  color: var(--color-text);
  background: var(--color-bg-tertiary);
}

.cg-scope-btn--active {
  background: var(--color-bg);
  color: var(--color-accent);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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
