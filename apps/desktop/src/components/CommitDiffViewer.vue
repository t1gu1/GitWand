<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import type { GitDiff, GitLogEntry, DiffLine, FolderDiffNode } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import type { DiffMode } from "../utils/diffMode";
import { detectLanguage, highlightLine } from "../utils/highlight";
import { safeHtml } from "../composables/useSafeHtml";
import { wordDiff, segmentsToHtml } from "../utils/wordDiff";
import FolderDiffTree from "./FolderDiffTree.vue";

const { t } = useI18n();

const props = defineProps<{
  diffs: GitDiff[];
  commitHash: string | null;
  commitInfo: GitLogEntry | null;
  diffMode: DiffMode;
}>();

const emit = defineEmits<{
  "update:diffMode": [mode: DiffMode];
}>();

// ─── Side-by-side line pairing with word-diff ────────
interface SbsPair {
  left: DiffLine | null;
  right: DiffLine | null;
  leftHtml?: string;
  rightHtml?: string;
}

/** Highlight a line of content for a given file path */
function hl(content: string, filePath: string): string {
  const lang = detectLanguage(filePath);
  return highlightLine(content, lang);
}

function pairLines(lines: DiffLine[]): SbsPair[] {
  const pairs: SbsPair[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === "context") {
      pairs.push({ left: lines[i], right: lines[i] });
      i++;
    } else {
      const deletes: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "delete") {
        deletes.push(lines[i]);
        i++;
      }
      while (i < lines.length && lines[i].type === "add") {
        adds.push(lines[i]);
        i++;
      }
      const maxLen = Math.max(deletes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        const del = j < deletes.length ? deletes[j] : null;
        const add = j < adds.length ? adds[j] : null;
        const pair: SbsPair = { left: del, right: add };
        if (del && add) {
          const wd = wordDiff(del.content, add.content);
          pair.leftHtml = segmentsToHtml(wd.oldSegments);
          pair.rightHtml = segmentsToHtml(wd.newSegments);
        }
        pairs.push(pair);
      }
    }
  }
  return pairs;
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Deterministic pastel color from author name
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function cleanBody(raw: string): string {
  // Replace literal \n sequences with real newlines, then trim
  return raw.replace(/\\n/g, "\n").trim();
}

// ─── Body collapse ───────────────────────────────────────
const BODY_PREVIEW_LINES = 2;
const bodyExpanded = ref(false);

const bodyLines = computed(() => {
  if (!props.commitInfo?.body) return [];
  return cleanBody(props.commitInfo.body).split("\n");
});

const bodyNeedsCollapse = computed(() => bodyLines.value.length > BODY_PREVIEW_LINES);

const bodyPreview = computed(() =>
  bodyLines.value.slice(0, BODY_PREVIEW_LINES).join("\n"),
);

// Reset when commit changes
watch(() => props.commitHash, () => { bodyExpanded.value = false; });

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

// ─── Cached diff stats (computed once per diffs change) ──
const fileStats = computed(() =>
  props.diffs.map((diff) => {
    let adds = 0;
    let dels = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") adds++;
        else if (line.type === "delete") dels++;
      }
    }
    return { adds, dels };
  }),
);

const totalStats = computed(() => {
  let adds = 0;
  let dels = 0;
  for (const s of fileStats.value) {
    adds += s.adds;
    dels += s.dels;
  }
  return { adds, dels, files: props.diffs.length };
});

// ─── File-list view toggle: flat vs tree (v1.6.3) ────────
const fileListView = ref<"flat" | "tree">("flat");
const folderFilter = ref<string | null>(null);

/** Map path → index in props.diffs for O(1) lookup from tree events */
const pathToIdx = computed(() => {
  const m = new Map<string, number>();
  props.diffs.forEach((d, i) => m.set(d.path, i));
  return m;
});

/** Aggregated status letter from fileStats (A/D/M) matching existing flat-list icon */
function statusForIdx(idx: number): string {
  const s = fileStats.value[idx];
  if (!s) return "M";
  if (s.adds > 0 && s.dels === 0) return "A";
  if (s.dels > 0 && s.adds === 0) return "D";
  return "M";
}

/** Build a folder-diff tree from diffs + fileStats (client-side, no IPC). */
const folderTree = computed<FolderDiffNode>(() => {
  const root: FolderDiffNode = {
    path: "",
    name: "",
    kind: "folder",
    status: null,
    oldPath: null,
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    binary: false,
    children: [],
  };
  props.diffs.forEach((diff, idx) => {
    const stats = fileStats.value[idx] ?? { adds: 0, dels: 0 };
    const segments = diff.path.split("/").filter(Boolean);
    let cursor = root;
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      acc = acc ? `${acc}/${seg}` : seg;
      const isLeaf = i === segments.length - 1;
      if (isLeaf) {
        cursor.children.push({
          path: acc,
          name: seg,
          kind: "file",
          status: statusForIdx(idx),
          oldPath: null,
          filesChanged: 1,
          additions: stats.adds,
          deletions: stats.dels,
          binary: false,
          children: [],
        });
      } else {
        let child = cursor.children.find(
          (c) => c.kind === "folder" && c.name === seg,
        );
        if (!child) {
          child = {
            path: acc,
            name: seg,
            kind: "folder",
            status: null,
            oldPath: null,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            binary: false,
            children: [],
          };
          cursor.children.push(child);
        }
        cursor = child;
      }
    }
    // Walk again to accumulate folder totals
    let cur: FolderDiffNode = root;
    root.filesChanged += 1;
    root.additions += stats.adds;
    root.deletions += stats.dels;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const nxt = cur.children.find(
        (c) => c.kind === "folder" && c.name === seg,
      );
      if (!nxt) break;
      nxt.filesChanged += 1;
      nxt.additions += stats.adds;
      nxt.deletions += stats.dels;
      cur = nxt;
    }
  });

  // Sort: folders first, alphabetical
  function sortNode(n: FolderDiffNode) {
    n.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const c of n.children) if (c.kind === "folder") sortNode(c);
  }
  sortNode(root);
  return root;
});

/** Indices into props.diffs that match the current folder filter (or all if none). */
const visibleIndices = computed<number[]>(() => {
  if (!folderFilter.value) return props.diffs.map((_, i) => i);
  const prefix = folderFilter.value + "/";
  const out: number[] = [];
  props.diffs.forEach((d, i) => {
    if (d.path === folderFilter.value || d.path.startsWith(prefix)) out.push(i);
  });
  return out;
});

function onTreeSelectFolder(path: string) {
  folderFilter.value = path;
  // Scroll main content to first file under this folder
  const firstIdx = visibleIndices.value[0];
  if (firstIdx != null) scrollToFile(firstIdx);
}

function onTreeSelectFile(path: string) {
  const idx = pathToIdx.value.get(path);
  if (idx != null) scrollToFile(idx);
}

function clearFolderFilter() {
  folderFilter.value = null;
}

function toggleFileListView() {
  fileListView.value = fileListView.value === "flat" ? "tree" : "flat";
  if (fileListView.value === "flat") folderFilter.value = null;
}

// ─── Resizable file-list column (v1.6.3) ─────────────────
const FILELIST_WIDTH_KEY = "gitwand.cdv.filelistWidth";
const FILELIST_MIN = 180;
const FILELIST_MAX = 600;
const FILELIST_DEFAULT = 220;

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(FILELIST_WIDTH_KEY);
    if (!raw) return FILELIST_DEFAULT;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= FILELIST_MIN && n <= FILELIST_MAX) return n;
  } catch {
    /* localStorage unavailable */
  }
  return FILELIST_DEFAULT;
}

const filelistWidth = ref<number>(readStoredWidth());
const isResizingFilelist = ref(false);

let dragStartX = 0;
let dragStartWidth = 0;

function onFilelistResizeStart(e: MouseEvent) {
  e.preventDefault();
  isResizingFilelist.value = true;
  dragStartX = e.clientX;
  dragStartWidth = filelistWidth.value;
  document.addEventListener("mousemove", onFilelistResizeMove);
  document.addEventListener("mouseup", onFilelistResizeEnd);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

function onFilelistResizeMove(e: MouseEvent) {
  // Drag handle is on the left edge of the right-hand aside:
  // moving mouse LEFT widens the column.
  const delta = dragStartX - e.clientX;
  const next = Math.min(
    FILELIST_MAX,
    Math.max(FILELIST_MIN, dragStartWidth + delta),
  );
  filelistWidth.value = next;
}

function onFilelistResizeEnd() {
  isResizingFilelist.value = false;
  document.removeEventListener("mousemove", onFilelistResizeMove);
  document.removeEventListener("mouseup", onFilelistResizeEnd);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  try {
    localStorage.setItem(FILELIST_WIDTH_KEY, String(filelistWidth.value));
  } catch {
    /* localStorage unavailable */
  }
}

// Double-click on the handle → reset to default
function onFilelistResizeReset() {
  filelistWidth.value = FILELIST_DEFAULT;
  try {
    localStorage.setItem(FILELIST_WIDTH_KEY, String(FILELIST_DEFAULT));
  } catch {
    /* localStorage unavailable */
  }
}

// ─── Lazy rendering: only expand a few files at a time ──
const MAX_INITIAL_FILES = 20;
const MAX_LINES_PER_FILE = 500;

/** Build initial set of expanded files from diffs already available at mount time */
function buildInitialExpanded(count: number): Set<number> {
  const s = new Set<number>();
  const autoExpand = Math.min(count, 5);
  for (let i = 0; i < autoExpand; i++) s.add(i);
  return s;
}

/** Set of expanded file indices — pre-seeded with whatever diffs are available at mount */
const expandedFiles = ref(buildInitialExpanded(props.diffs.length));

/** How many files to show in the list (grows on scroll) — capped at actual diff count */
const renderedFileCount = ref(Math.min(props.diffs.length, MAX_INITIAL_FILES));

function isExpanded(idx: number): boolean {
  return expandedFiles.value.has(idx);
}

function toggleFile(idx: number) {
  const s = new Set(expandedFiles.value);
  if (s.has(idx)) {
    s.delete(idx);
  } else {
    s.add(idx);
  }
  expandedFiles.value = s;
}

/** Total lines in a file diff */
function fileTotalLines(idx: number): number {
  let count = 0;
  for (const hunk of props.diffs[idx].hunks) {
    count += hunk.lines.length;
  }
  return count;
}

/** Whether a file diff is truncated (too many lines) */
function isFileTruncated(idx: number): boolean {
  return fileTotalLines(idx) > MAX_LINES_PER_FILE;
}

/** Get hunks with truncation applied */
function truncatedHunks(idx: number) {
  const diff = props.diffs[idx];
  if (!isFileTruncated(idx)) return diff.hunks;

  const result: typeof diff.hunks = [];
  let remaining = MAX_LINES_PER_FILE;

  for (const hunk of diff.hunks) {
    if (remaining <= 0) break;
    if (hunk.lines.length <= remaining) {
      result.push(hunk);
      remaining -= hunk.lines.length;
    } else {
      result.push({ ...hunk, lines: hunk.lines.slice(0, remaining) });
      remaining = 0;
    }
  }
  return result;
}

// Reset expansion and rendered count when diffs change (subsequent prop updates)
watch(
  () => props.diffs,
  () => {
    expandedFiles.value = buildInitialExpanded(props.diffs.length);
    renderedFileCount.value = Math.min(props.diffs.length, MAX_INITIAL_FILES);
    visibleFileIdx.value = 0;
  },
);

// ─── Scroll-spy: track which file is visible ────────────
const contentEl = ref<HTMLElement | null>(null);
const fileEls = ref<HTMLElement[]>([]);
const visibleFileIdx = ref(0);

let observer: IntersectionObserver | null = null;
const visibleSet = new Map<number, number>();

function setupObserver() {
  teardownObserver();
  if (!contentEl.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = Number((entry.target as HTMLElement).dataset.fileIdx);
        if (entry.isIntersecting) {
          visibleSet.set(idx, entry.intersectionRatio);
        } else {
          visibleSet.delete(idx);
        }
      }
      if (visibleSet.size > 0) {
        visibleFileIdx.value = Math.min(...visibleSet.keys());
      }
    },
    { root: contentEl.value, threshold: [0, 0.1, 0.5] },
  );

  for (const el of fileEls.value) {
    if (el) observer.observe(el);
  }
}

function teardownObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  visibleSet.clear();
}

watch(
  () => props.diffs,
  async () => {
    await nextTick();
    setupObserver();
  },
);

onUnmounted(() => {
  teardownObserver();
  // Safety: if the component unmounts mid-drag, detach global listeners
  if (isResizingFilelist.value) {
    document.removeEventListener("mousemove", onFilelistResizeMove);
    document.removeEventListener("mouseup", onFilelistResizeEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
});

// Click on a file in the list → expand & scroll to it
function scrollToFile(idx: number) {
  // Ensure file is rendered
  if (idx >= renderedFileCount.value) {
    renderedFileCount.value = idx + 1;
  }
  // Ensure file is expanded
  if (!expandedFiles.value.has(idx)) {
    const s = new Set(expandedFiles.value);
    s.add(idx);
    expandedFiles.value = s;
  }
  nextTick(() => {
    const el = fileEls.value[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

// Collect refs
function setFileRef(el: any, idx: number) {
  if (el) fileEls.value[idx] = el as HTMLElement;
}

// ─── Load more on scroll ─────────────────────────────────
function onContentScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  const scrollBottom = el.scrollTop + el.clientHeight;
  const threshold = el.scrollHeight - 200;
  if (scrollBottom >= threshold && renderedFileCount.value < props.diffs.length) {
    renderedFileCount.value = Math.min(
      renderedFileCount.value + MAX_INITIAL_FILES,
      props.diffs.length,
    );
    nextTick(() => setupObserver());
  }
}
</script>

<template>
  <div class="commit-diff-viewer">
    <!-- Commit card -->
    <div class="cdv-commit-card" v-if="commitInfo">
      <!-- Row 1: avatar + subject + hash -->
      <div class="cdv-commit-top">
        <span class="cdv-avatar" :style="{ background: avatarColor(commitInfo.author) }">
          {{ commitInfo.author.charAt(0).toUpperCase() }}
        </span>
        <div class="cdv-commit-top-text">
          <div class="cdv-commit-subject">{{ commitInfo.message }}</div>
          <div class="cdv-commit-meta">
            <span class="cdv-author">{{ commitInfo.author }}</span>
            <span class="cdv-meta-sep">&middot;</span>
            <span class="cdv-date">{{ formatDate(commitInfo.date) }}</span>
            <span class="cdv-meta-sep">&middot;</span>
            <span class="cdv-hash mono" :title="commitInfo.hashFull">{{ commitInfo.hash }}</span>
          </div>
        </div>
      </div>
      <!-- Row 2: body (if any) -->
      <div class="cdv-commit-body" v-if="commitInfo.body">
        <span class="cdv-body-text">{{ bodyExpanded || !bodyNeedsCollapse ? cleanBody(commitInfo.body) : bodyPreview }}</span>
        <button
          v-if="bodyNeedsCollapse"
          class="cdv-body-toggle"
          @click="bodyExpanded = !bodyExpanded"
        >{{ bodyExpanded ? '▲ moins' : `▼ +${bodyLines.length - BODY_PREVIEW_LINES} ligne${bodyLines.length - BODY_PREVIEW_LINES > 1 ? 's' : ''}` }}</button>
      </div>
      <!-- Row 3: stats badges -->
      <div class="cdv-commit-stats">
        <span class="cdv-badge cdv-badge--files">
          {{ totalStats.files }} {{ totalStats.files === 1 ? t('header.file') : t('header.files') }}
        </span>
        <span class="cdv-badge cdv-badge--add" v-if="totalStats.adds > 0">+{{ totalStats.adds }}</span>
        <span class="cdv-badge cdv-badge--del" v-if="totalStats.dels > 0">&minus;{{ totalStats.dels }}</span>
        <span class="cdv-large-diff-hint" v-if="diffs.length > MAX_INITIAL_FILES">
          ({{ renderedFileCount }}/{{ diffs.length }})
        </span>
        <!-- Toggle inline / side-by-side -->
        <div class="cdv-mode-toggle">
          <button
            class="cdv-mode-btn"
            :class="{ 'cdv-mode-btn--active': diffMode === 'inline' }"
            @click="emit('update:diffMode', 'inline')"
            :title="t('diff.modeInline')"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.6"/><rect x="1" y="6" width="12" height="2" rx="0.5" fill="currentColor"/><rect x="1" y="10" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.6"/></svg>
          </button>
          <button
            class="cdv-mode-btn"
            :class="{ 'cdv-mode-btn--active': diffMode === 'side-by-side' }"
            @click="emit('update:diffMode', 'side-by-side')"
            :title="t('diff.modeSideBySide')"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
          </button>
        </div>
      </div>
    </div>

    <div class="cdv-body" v-if="diffs.length > 0">
      <!-- File diffs -->
      <div class="cdv-content" ref="contentEl" @scroll="onContentScroll">
        <div
          v-for="fileIdx in renderedFileCount"
          :key="fileIdx - 1"
          class="cdv-file"
          :ref="(el) => setFileRef(el, fileIdx - 1)"
          :data-file-idx="fileIdx - 1"
        >
          <!-- Collapsible file header -->
          <div
            class="cdv-file-header"
            @click="toggleFile(fileIdx - 1)"
            role="button"
            tabindex="0"
            @keydown.enter="toggleFile(fileIdx - 1)"
          >
            <span class="cdv-collapse-icon" :class="{ 'cdv-collapse-icon--open': isExpanded(fileIdx - 1) }">&#9654;</span>
            <span class="cdv-file-name mono">{{ fileName(diffs[fileIdx - 1].path) }}</span>
            <span class="cdv-file-path muted">{{ diffs[fileIdx - 1].path }}</span>
            <div class="cdv-file-stats">
              <span class="cdv-stat cdv-stat--add" v-if="fileStats[fileIdx - 1]?.adds > 0">
                +{{ fileStats[fileIdx - 1].adds }}
              </span>
              <span class="cdv-stat cdv-stat--del" v-if="fileStats[fileIdx - 1]?.dels > 0">
                -{{ fileStats[fileIdx - 1].dels }}
              </span>
            </div>
          </div>

          <!-- Hunks (only rendered if expanded) -->
          <template v-if="isExpanded(fileIdx - 1)">
            <div
              v-for="(hunk, hunkIdx) in truncatedHunks(fileIdx - 1)"
              :key="hunkIdx"
              class="cdv-hunk"
            >
              <div class="cdv-hunk-header mono">{{ hunk.header }}</div>

              <!-- INLINE mode -->
              <table v-if="diffMode === 'inline'" class="cdv-table">
                <tbody>
                  <tr
                    v-for="(line, lineIdx) in hunk.lines"
                    :key="lineIdx"
                    class="cdv-line"
                    :class="`cdv-line--${line.type}`"
                  >
                    <td class="cdv-line-no mono">{{ line.oldLineNo ?? '' }}</td>
                    <td class="cdv-line-no mono">{{ line.newLineNo ?? '' }}</td>
                    <td class="cdv-line-marker mono">
                      {{ line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ' }}
                    </td>
                    <td class="cdv-line-content mono">
                      <span v-html="safeHtml(hl(line.content, diffs[fileIdx - 1].path)) || '\u00a0'"></span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <!-- SIDE-BY-SIDE mode -->
              <table v-else class="cdv-table cdv-table--sbs">
                <tbody>
                  <tr
                    v-for="(pair, pairIdx) in pairLines(hunk.lines)"
                    :key="pairIdx"
                    class="cdv-line"
                  >
                    <td class="cdv-line-no mono" :class="pair.left ? `cdv-sbs--${pair.left.type}` : 'cdv-sbs--empty'">
                      {{ pair.left?.oldLineNo ?? '' }}
                    </td>
                    <td class="cdv-line-marker mono" :class="pair.left ? `cdv-sbs--${pair.left.type}` : 'cdv-sbs--empty'">
                      {{ pair.left?.type === 'delete' ? '-' : pair.left?.type === 'context' ? ' ' : '' }}
                    </td>
                    <td class="cdv-line-content mono cdv-sbs-content" :class="pair.left ? `cdv-sbs--${pair.left.type}` : 'cdv-sbs--empty'">
                      <span v-html="safeHtml(pair.leftHtml ?? (pair.left ? hl(pair.left.content, diffs[fileIdx - 1].path) : '')) || '\u00a0'"></span>
                    </td>
                    <td class="cdv-sbs-gutter"></td>
                    <td class="cdv-line-no mono" :class="pair.right ? `cdv-sbs--${pair.right.type}` : 'cdv-sbs--empty'">
                      {{ pair.right?.newLineNo ?? '' }}
                    </td>
                    <td class="cdv-line-marker mono" :class="pair.right ? `cdv-sbs--${pair.right.type}` : 'cdv-sbs--empty'">
                      {{ pair.right?.type === 'add' ? '+' : pair.right?.type === 'context' ? ' ' : '' }}
                    </td>
                    <td class="cdv-line-content mono cdv-sbs-content" :class="pair.right ? `cdv-sbs--${pair.right.type}` : 'cdv-sbs--empty'">
                      <span v-html="safeHtml(pair.rightHtml ?? (pair.right ? hl(pair.right.content, diffs[fileIdx - 1].path) : '')) || '\u00a0'"></span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="isFileTruncated(fileIdx - 1)" class="cdv-truncated">
              Diff truncated ({{ fileTotalLines(fileIdx - 1) }} lines, showing first {{ MAX_LINES_PER_FILE }})
            </div>
          </template>
        </div>

        <!-- Load more indicator -->
        <div v-if="renderedFileCount < diffs.length" class="cdv-load-more">
          {{ diffs.length - renderedFileCount }} more files — scroll down to load
        </div>
      </div>

      <!-- Resize handle between main content and aside -->
      <div
        class="cdv-filelist-resize"
        :class="{ 'cdv-filelist-resize--active': isResizingFilelist }"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('folderDiff.resizeHandle')"
        :title="t('folderDiff.resizeHandle')"
        @mousedown="onFilelistResizeStart"
        @dblclick="onFilelistResizeReset"
      ></div>

      <!-- Right-side file list / folder tree -->
      <aside class="cdv-filelist" :style="{ width: filelistWidth + 'px' }">
        <div class="cdv-filelist-header">
          <span class="cdv-filelist-title">
            {{ fileListView === 'tree' ? t('folderDiff.title') : t('header.files') }}
          </span>
          <button
            type="button"
            class="cdv-view-toggle"
            :title="fileListView === 'flat' ? t('folderDiff.viewTree') : t('folderDiff.viewFlat')"
            :aria-label="fileListView === 'flat' ? t('folderDiff.viewTree') : t('folderDiff.viewFlat')"
            @click="toggleFileListView"
          >
            <svg v-if="fileListView === 'flat'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 5h7l2 2h9v12H3z" />
              <path d="M3 10h18" />
            </svg>
          </button>
        </div>

        <!-- Active folder filter breadcrumb -->
        <div v-if="fileListView === 'tree' && folderFilter" class="cdv-folder-filter">
          <span class="cdv-folder-filter-path" :title="folderFilter">{{ folderFilter }}</span>
          <button
            type="button"
            class="cdv-folder-filter-clear"
            @click="clearFolderFilter"
            :title="t('folderDiff.clearFilter')"
            :aria-label="t('folderDiff.clearFilter')"
          >×</button>
        </div>

        <!-- Tree view -->
        <FolderDiffTree
          v-if="fileListView === 'tree'"
          :tree="folderTree"
          :selected-folder-path="folderFilter"
          :selected-file-path="diffs[visibleFileIdx]?.path ?? null"
          @select-folder="onTreeSelectFolder"
          @select-file="onTreeSelectFile"
          @clear-filter="clearFolderFilter"
        />

        <!-- Flat list view -->
        <ul v-else class="cdv-filelist-items">
          <li
            v-for="(fileDiff, idx) in diffs"
            :key="idx"
            class="cdv-filelist-item"
            :class="{ 'cdv-filelist-item--active': idx === visibleFileIdx }"
            @click="scrollToFile(idx)"
            :title="fileDiff.path"
          >
            <span class="cdv-filelist-icon mono" :class="{
              'cdv-filelist-icon--add': fileStats[idx]?.adds > 0 && fileStats[idx]?.dels === 0,
              'cdv-filelist-icon--del': fileStats[idx]?.dels > 0 && fileStats[idx]?.adds === 0,
              'cdv-filelist-icon--mod': fileStats[idx]?.adds > 0 && fileStats[idx]?.dels > 0,
            }">{{ fileStats[idx]?.adds > 0 && fileStats[idx]?.dels === 0 ? 'A' : fileStats[idx]?.dels > 0 && fileStats[idx]?.adds === 0 ? 'D' : 'M' }}</span>
            <span class="cdv-filelist-name">{{ fileName(fileDiff.path) }}</span>
            <span class="cdv-filelist-stats">
              <span v-if="fileStats[idx]?.adds > 0" class="cdv-stat cdv-stat--add">+{{ fileStats[idx].adds }}</span>
              <span v-if="fileStats[idx]?.dels > 0" class="cdv-stat cdv-stat--del">-{{ fileStats[idx].dels }}</span>
            </span>
          </li>
        </ul>
      </aside>
    </div>

    <!-- Empty state -->
    <div class="cdv-empty" v-else-if="commitHash">
      <span class="muted">{{ t('log.noDiffForCommit') }}</span>
    </div>
    <div class="cdv-empty" v-else>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" stroke="var(--color-text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
      </svg>
      <span class="muted">{{ t('log.selectCommit') }}</span>
    </div>
  </div>
</template>

<style scoped>
.commit-diff-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.cdv-commit-card {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cdv-commit-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.cdv-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: #fff;
  flex-shrink: 0;
}

.cdv-commit-top-text {
  flex: 1;
  min-width: 0;
}

.cdv-commit-subject {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  line-height: 1.4;
}

.cdv-commit-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.cdv-meta-sep {
  opacity: 0.4;
}

.cdv-author {
  font-weight: var(--font-medium);
}

.cdv-hash {
  font-size: var(--text-xs);
  color: var(--color-accent);
  background: var(--color-bg-tertiary);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.cdv-commit-body {
  font-size: var(--text-base);
  font-weight: var(--font-normal);
  color: var(--color-text-muted);
  line-height: 1.5;
  padding-left: 44px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cdv-body-text {
  margin-right: 44px;
}

.cdv-body-toggle {
  align-self: flex-start;
  font-size: var(--text-xs);
  color: var(--color-accent);
  background: none;
  padding: 0;
  cursor: pointer;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}

.cdv-body-toggle:hover {
  opacity: 1;
}

.cdv-commit-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 44px;
}

.cdv-badge {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
}

.cdv-badge--files {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.cdv-badge--add {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.cdv-badge--del {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.cdv-summary {
  font-size: var(--text-base);
  color: var(--color-text-muted);
}

.cdv-large-diff-hint {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  opacity: 0.6;
}

.cdv-stat {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  font-family: var(--font-mono);
}

.cdv-stat--add {
  color: var(--color-success);
}

.cdv-stat--del {
  color: var(--color-danger);
}

/* ─── Body: diff + file list side by side ─────────────── */

.cdv-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.cdv-content {
  flex: 1;
  overflow: auto;
}

/* ─── Right-side file list ────────────────────────────── */

.cdv-filelist-resize {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  transition: background 120ms ease;
  user-select: none;
}

.cdv-filelist-resize:hover,
.cdv-filelist-resize--active {
  background: var(--color-accent, var(--color-primary));
  opacity: 0.5;
}

.cdv-filelist {
  flex: 0 0 auto;
  min-width: 180px;
  max-width: 600px;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cdv-filelist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.cdv-filelist-title {
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-subtle);
}

.cdv-view-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-text-subtle);
  cursor: pointer;
}

.cdv-view-toggle:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.cdv-folder-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 12px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary, var(--color-bg));
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.cdv-folder-filter-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.cdv-folder-filter-clear {
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--color-text-subtle);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.cdv-folder-filter-clear:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.cdv-filelist-items {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}

.cdv-filelist-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: var(--text-base);
  cursor: pointer;
  transition: background var(--transition-fast);
  border-left: 2px solid transparent;
}

.cdv-filelist-item:hover {
  background: var(--color-bg-tertiary);
}

.cdv-filelist-item--active {
  background: var(--color-bg-tertiary);
  border-left-color: var(--color-accent);
}

.cdv-filelist-icon {
  font-size: var(--text-xs);
  font-weight: var(--font-bold);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.cdv-filelist-icon--add { color: var(--color-success); }
.cdv-filelist-icon--del { color: var(--color-danger); }
.cdv-filelist-icon--mod { color: var(--color-warning); }

.cdv-filelist-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.cdv-filelist-item--active .cdv-filelist-name {
  font-weight: var(--font-semibold);
}

.cdv-filelist-stats {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* ─── File diff blocks ────────────────────────────────── */

.cdv-file {
  border-bottom: 2px solid var(--color-border);
}

.cdv-file:last-child {
  border-bottom: none;
}

.cdv-file-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 2;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.cdv-file-header:hover {
  background: var(--color-bg-tertiary);
}

.cdv-collapse-icon {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  transition: transform var(--transition-base);
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.cdv-collapse-icon--open {
  transform: rotate(90deg);
}

.cdv-file-name {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  flex-shrink: 0;
}

.cdv-file-path {
  font-size: var(--text-xs);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cdv-file-stats {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.cdv-hunk-header {
  padding: 4px 16px;
  font-size: var(--text-xs);
  color: var(--color-text-subtle);
  background: var(--color-bg-tertiary);
  border-bottom: 1px solid var(--color-border);
}

.cdv-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.cdv-line {
  line-height: 1.5;
}

.cdv-line--context { background: var(--color-bg); }
.cdv-line--add { background: var(--color-success-soft); }
.cdv-line--delete { background: var(--color-danger-soft); }

.cdv-line-no {
  width: 44px;
  min-width: 44px;
  padding: 0 6px;
  text-align: right;
  font-size: var(--text-xs);
  color: var(--color-text-subtle);
  opacity: 0.5;
  user-select: none;
  border-right: 1px solid var(--color-border);
}

.cdv-line-marker {
  width: 18px;
  min-width: 18px;
  padding: 0 3px;
  text-align: center;
  font-size: var(--text-base);
  color: var(--color-text-muted);
  user-select: none;
}

.cdv-line--add .cdv-line-marker { color: var(--color-success); font-weight: var(--font-bold); }
.cdv-line--delete .cdv-line-marker { color: var(--color-danger); font-weight: var(--font-bold); }

.cdv-line-content {
  padding: 0 10px;
  font-size: var(--text-base);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── Side-by-side mode ──────────────────────────────── */
.cdv-table--sbs {
  table-layout: fixed;
}

.cdv-table--sbs .cdv-line-no {
  width: 36px;
  min-width: 36px;
}

.cdv-table--sbs .cdv-line-marker {
  width: 16px;
  min-width: 16px;
}

.cdv-sbs-content {
  width: calc(50% - 56px);
}

.cdv-sbs-gutter {
  width: 4px;
  min-width: 4px;
  background: var(--color-border);
  padding: 0;
}

.cdv-sbs--context { background: var(--color-bg); }
.cdv-sbs--delete { background: var(--color-danger-soft); }
.cdv-sbs--add { background: var(--color-success-soft); }
.cdv-sbs--empty { background: var(--color-bg-tertiary); opacity: 0.5; }

.cdv-sbs--delete.cdv-line-marker { color: var(--color-danger); font-weight: var(--font-bold); }
.cdv-sbs--add.cdv-line-marker { color: var(--color-success); font-weight: var(--font-bold); }
.cdv-sbs--delete.cdv-line-no { color: var(--color-danger); opacity: 0.7; }
.cdv-sbs--add.cdv-line-no { color: var(--color-success); opacity: 0.7; }

/* ─── Mode toggle ────────────────────────────────────── */
.cdv-mode-toggle {
  display: flex;
  gap: 2px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  padding: 2px;
  margin-left: auto;
}

.cdv-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.cdv-mode-btn:hover {
  color: var(--color-text);
}

.cdv-mode-btn--active {
  background: var(--color-bg-secondary);
  color: var(--color-accent);
  box-shadow: var(--shadow-xs);
}

.cdv-truncated {
  padding: 8px 16px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  text-align: center;
  font-style: italic;
}

.cdv-load-more {
  padding: 12px 16px;
  font-size: var(--text-base);
  color: var(--color-text-muted);
  text-align: center;
}

.cdv-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
}
</style>
