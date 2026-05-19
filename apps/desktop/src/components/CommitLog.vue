<script setup lang="ts">
import { computed, ref, watch, inject, nextTick, onMounted, onUnmounted, type Ref } from "vue";
import type { GitLogEntry } from "../utils/backend";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { useI18n } from "../composables/useI18n";
import { useAIProvider } from "../composables/useAIProvider";
import { useCommitSearch, filterCommitsLocal, type CommitMatch } from "../composables/useCommitSearch";
import { LOG_FOCUS_SEARCH_KEY } from "../composables/branchPickerBridge";
import AiSparkle from "./AiSparkle.vue";
import CommitContextMenu from "./CommitContextMenu.vue";
const { t, locale } = useI18n();

const props = defineProps<{
  entries: GitLogEntry[];
  loading: boolean;
  selectedHash: string | null;
  aheadCount?: number;
  /**
   * True when the current branch has no upstream configured yet.
   * In that case every local commit is effectively "unpushed" because
   * origin does not know about this branch at all.
   */
  needsPublish?: boolean;
  /** True when more commits exist beyond the current page. */
  hasMore?: boolean;
  /** True while the next page is being loaded. */
  loadingMore?: boolean;
}>();

/**
 * Effective count of unpushed commits used for styling:
 * - when the branch has no upstream, every local commit is unpushed
 * - otherwise, use aheadCount reported by git status
 */
const effectiveAhead = computed(() =>
  props.needsPublish ? props.entries.length : (props.aheadCount ?? 0),
);

// ─── Virtual scroll ─────────────────────────────────────
const scrollContainerRef = ref<HTMLDivElement | null>(null);

type RowSection =
  | { type: "section-unpushed" }
  | { type: "section-unpublished" }
  | { type: "section-pushed" };

type RowCommit = { type: "commit"; entry: GitLogEntry; originalIndex: number };
type Row = RowSection | RowCommit;

const rows = computed<Row[]>(() => {
  const entries = displayedEntries.value;
  const ahead = effectiveAhead.value;
  const searchActive = isSearchActive.value;
  const showUnpushed = !searchActive && ahead > 0;
  const showPushed = showUnpushed && !props.needsPublish;

  const items: Row[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (showUnpushed && i === 0) {
      items.push(props.needsPublish
        ? { type: "section-unpublished" }
        : { type: "section-unpushed" });
    }
    if (showPushed && i === ahead) {
      items.push({ type: "section-pushed" });
    }
    items.push({ type: "commit", entry: entries[i], originalIndex: i });
  }
  return items;
});

// Row heights — must match the CSS values (.log-section-label padding
// + font + border = ~24px, .log-commit-row = 72px). The estimate is
// per-index so section labels don't inherit the commit-row height
// (visible regression: legends "unpushed" / "pushed" rendered at 72px).
const COMMIT_ROW_H = 72;
const SECTION_ROW_H = 24;

const virtualizer = useVirtualizer({
  count: 0,
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: (index: number) => {
    const row = rows.value[index];
    return row && row.type !== "commit" ? SECTION_ROW_H : COMMIT_ROW_H;
  },
  overscan: 5,
});

function isSectionRow(row: Row): boolean {
  return row.type !== "commit";
}

function sectionLabelClass(row: Row): string {
  if (row.type === "section-unpublished") return "log-section-label--unpublished";
  if (row.type === "section-unpushed")    return "log-section-label--unpushed";
  if (row.type === "section-pushed")      return "log-section-label--pushed";
  return "";
}

function sectionLabelText(row: Row): string {
  if (row.type === "section-unpublished") return t("log.unpublishedBranch");
  if (row.type === "section-unpushed")    return `${effectiveAhead.value} ${effectiveAhead.value === 1 ? t("log.unpushedOne") : t("log.unpushedMany")}`;
  if (row.type === "section-pushed")      return t("log.pushed");
  return "";
}

function vrStyle(vr: { start: number; size: number }) {
  return {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: vr.size + "px",
    transform: "translateY(" + vr.start + "px)",
  };
}

/** Get commit entry from row index (only use inside v-else where row is guaranteed commit). */
function c(index: number): GitLogEntry {
  return (rows.value[index] as RowCommit).entry;
}

/** Get original displayedEntries index from row index. */
function oi(index: number): number {
  return (rows.value[index] as RowCommit).originalIndex;
}

const emit = defineEmits<{
  selectCommit: [hash: string];
  editCommit: [entry: GitLogEntry];
  splitCommit: [entry: GitLogEntry];
  // v1.9 — commit context menu
  checkoutCommit: [entry: GitLogEntry];
  resetToCommit: [entry: GitLogEntry, mode?: "soft" | "mixed" | "hard"];
  revertCommit: [entry: GitLogEntry];
  createBranchFromCommit: [entry: GitLogEntry];
  tagCommit: [entry: GitLogEntry];
  cherryPickCommit: [entry: GitLogEntry];
  viewOnForge: [entry: GitLogEntry];
  /** User scrolled near the bottom — request more commits. */
  loadMore: [];
}>();

// ─── Context menu on commit items ─────────────────────────
interface CommitCtxMenu {
  visible: boolean;
  x: number;
  y: number;
  entry: GitLogEntry | null;
  /** Index in the displayed list — used to restrict some actions to HEAD. */
  idx: number;
}
const ctxMenu = ref<CommitCtxMenu>({ visible: false, x: 0, y: 0, entry: null, idx: -1 });

function openCommitContextMenu(e: MouseEvent, entry: GitLogEntry, idx: number) {
  e.preventDefault();
  e.stopPropagation();
  // Select the commit first — the user expects the diff view to reflect what
  // they right-clicked on.
  emit("selectCommit", entry.hashFull);
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, entry, idx };
}

function closeCommitContextMenu() {
  ctxMenu.value.visible = false;
}

onMounted(() => {
  window.addEventListener("click", closeCommitContextMenu);
  window.addEventListener("contextmenu", closeCommitContextMenu, { capture: false });
  window.addEventListener("keydown", onCtxKey);
});
onUnmounted(() => {
  window.removeEventListener("click", closeCommitContextMenu);
  window.removeEventListener("contextmenu", closeCommitContextMenu, { capture: false } as EventListenerOptions);
  window.removeEventListener("keydown", onCtxKey);
});

function onCtxKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeCommitContextMenu();
}

// ─── Infinite scroll — load next page when user reaches the bottom ─
let _loadMorePending = false;

function onLogScroll() {
  if (!props.hasMore || props.loadingMore || _loadMorePending) return;
  const el = scrollContainerRef.value;
  if (!el) return;
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remaining < 200) {
    _loadMorePending = true;
    emit("loadMore");
  }
}

watch(() => props.entries.length, () => {
  _loadMorePending = false;
});

// ─── Search (Phase 1.3.4) ─────────────────────────────────
const ai = useAIProvider();
const { isSearching: isAiSearching, searchAI, lastError: aiSearchError } = useCommitSearch();
const searchQuery = ref("");
const aiMatches = ref<CommitMatch[] | null>(null);
const searchInputEl = ref<HTMLInputElement | null>(null);

const focusRequest = inject<Ref<number> | null>(LOG_FOCUS_SEARCH_KEY, null);
if (focusRequest) {
  watch(focusRequest, () => {
    nextTick(() => {
      const el = searchInputEl.value;
      if (!el) return;
      el.focus();
      el.select();
    });
  });
}

const displayedEntries = computed<GitLogEntry[]>(() => {
  if (aiMatches.value !== null) return aiMatches.value.map((m) => m.entry);
  return filterCommitsLocal(props.entries, searchQuery.value);
});

const isSearchActive = computed(
  () => aiMatches.value !== null || searchQuery.value.trim().length > 0,
);

// ─── virtualizer sync (post-decl) ─────────────────────────
watch(() => rows.value.length, (count) => {
  virtualizer.value?.setOptions({
    ...virtualizer.value.options,
    count,
  });
}, { immediate: true });

/** Hashes of the commits considered "unpushed" in the original list. */
const unpushedHashes = computed<Set<string>>(() => {
  const set = new Set<string>();
  const ahead = props.needsPublish ? props.entries.length : (props.aheadCount ?? 0);
  for (let i = 0; i < ahead; i++) {
    const e = props.entries[i];
    if (e) set.add(e.hashFull);
  }
  return set;
});

function isUnpushed(entry: GitLogEntry): boolean {
  return unpushedHashes.value.has(entry.hashFull);
}

const reasonByHash = computed(() => {
  const map = new Map<string, string>();
  if (aiMatches.value) {
    for (const m of aiMatches.value) {
      if (m.reason) map.set(m.entry.hashFull, m.reason);
    }
  }
  return map;
});

async function runAiSearch() {
  if (!searchQuery.value.trim()) return;
  try {
    const matches = await searchAI(searchQuery.value, props.entries, {
      locale: locale.value,
    });
    aiMatches.value = matches;
  } catch {
    // surfaced via aiSearchError
  }
}

function clearSearch() {
  searchQuery.value = "";
  aiMatches.value = null;
}

watch(searchQuery, () => {
  aiMatches.value = null;
});

interface RefBadge { type: "head" | "branch" | "remote" | "tag"; label: string; }

function parseRefBadges(refs: string): RefBadge[] {
  if (!refs) return [];
  return refs.split(",").map(r => r.trim()).filter(Boolean).map(r => {
    if (r.startsWith("HEAD -> ")) return { type: "head" as const, label: r.slice(8) };
    if (r === "HEAD") return { type: "head" as const, label: "HEAD" };
    if (r.startsWith("tag: ")) return { type: "tag" as const, label: r.slice(5) };
    if (r.includes("/")) return { type: "remote" as const, label: r };
    return { type: "branch" as const, label: r };
  });
}

function relativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return t('date.now');
  if (diffMin < 60) return t('date.minutesAgo', diffMin);
  if (diffHour < 24) return t('date.hoursAgo', diffHour);
  if (diffDay < 7) return t('date.daysAgo', diffDay);
  if (diffDay < 30) return t('date.weeksAgo', Math.floor(diffDay / 7));
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function authorColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}
</script>

<template>
  <div class="commit-log">
    <!-- Search bar -->
    <div v-if="entries.length > 0" class="log-search">
      <svg class="log-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/>
        <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      <input
        ref="searchInputEl"
        v-model="searchQuery"
        type="text"
        class="log-search-input"
        :placeholder="t('log.searchPlaceholder')"
        @keydown.enter.prevent="runAiSearch"
        @keydown.esc.prevent="clearSearch"
      />
      <button
        v-if="ai.isAvailable.value && searchQuery.trim()"
        type="button"
        class="btn btn--ai btn--icon"
        :disabled="isAiSearching"
        :title="t('log.searchAiHint')"
        :aria-label="t('log.searchAiHint')"
        @click="runAiSearch"
      >
        <span v-if="isAiSearching">…</span>
        <AiSparkle v-else :size="16" />
      </button>
      <button
        v-if="searchQuery || aiMatches !== null"
        type="button"
        class="log-search-clear"
        :title="t('common.close')"
        @click="clearSearch"
      >✕</button>
    </div>
    <p v-if="aiSearchError" class="log-search-error">{{ aiSearchError }}</p>
    <p v-if="aiMatches !== null" class="log-search-status">
      <AiSparkle :size="13" :animated="false" />
      {{ t('log.aiSearchResults', displayedEntries.length) }}
    </p>

    <div class="log-loading" v-if="loading">
      <div class="loading-spinner"></div>
      <span class="muted">{{ t('common.loading') }}</span>
    </div>

    <div ref="scrollContainerRef" class="log-list" v-else-if="displayedEntries.length > 0" @scroll.passive="onLogScroll">
      <div :style="{ height: virtualizer.getTotalSize() + 'px', position: 'relative', width: '100%' }">
        <div v-for="vr in virtualizer.getVirtualItems()" :key="'' + vr.key" :style="vrStyle(vr)">
          <template v-if="isSectionRow(rows[vr.index])">
            <div class="log-section-label" :class="sectionLabelClass(rows[vr.index])">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 13V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{{ sectionLabelText(rows[vr.index]) }}</span>
            </div>
          </template>
          <template v-else>
            <div
              class="commit-item"
              :class="{
                'commit-item--selected': selectedHash === c(vr.index).hashFull,
                'commit-item--unpushed': isUnpushed(c(vr.index)),
              }"
              @click="emit('selectCommit', c(vr.index).hashFull)"
              @contextmenu="openCommitContextMenu($event, c(vr.index), oi(vr.index))"
              tabindex="0"
              @keydown.enter="emit('selectCommit', c(vr.index).hashFull)"
            >
              <div class="commit-avatar" :style="{ background: authorColor(c(vr.index).author) }">
                {{ authorInitials(c(vr.index).author) }}
              </div>
              <div class="commit-info">
                <div class="commit-message">
                  {{ c(vr.index).message }}
                  <span v-if="isUnpushed(c(vr.index))" class="unpushed-badge">{{ needsPublish ? t('log.unpublishedBadge') : 'unpushed' }}</span>
                </div>
                <div v-if="reasonByHash.get(c(vr.index).hashFull)" class="commit-ai-reason">
                  <AiSparkle :size="12" :animated="false" />
                  <span>{{ reasonByHash.get(c(vr.index).hashFull) }}</span>
                </div>
                <div class="commit-meta">
                  <span class="commit-hash mono">{{ c(vr.index).hash }}</span>
                  <span class="commit-separator" aria-hidden="true">&middot;</span>
                  <span class="commit-author">{{ c(vr.index).author }}</span>
                  <span class="commit-separator" aria-hidden="true">&middot;</span>
                  <time class="commit-date" :datetime="c(vr.index).date">{{ relativeDate(c(vr.index).date) }}</time>
                </div>
                <div v-if="!isSearchActive && c(vr.index).refs" class="commit-refs">
                  <span
                    v-for="badge in parseRefBadges(c(vr.index).refs)"
                    :key="badge.label"
                    class="commit-ref-badge"
                    :class="`commit-ref-badge--${badge.type}`"
                  >{{ badge.label }}</span>
                </div>
              </div>
              <button
                v-if="!isSearchActive && aheadCount != null && oi(vr.index) === 0"
                class="commit-edit-btn"
                @click.stop="emit('editCommit', c(vr.index))"
                :title="t('log.editMessage')"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </template>
        </div>
      </div>
      <!-- Load-more sentinel (v2.11): shown below virtual list when more pages exist -->
      <div v-if="hasMore" class="log-load-more">
        <span v-if="loadingMore" class="log-load-more__spinner" aria-label="Loading more commits"></span>
        <span class="muted" style="font-size:11px">{{ loadingMore ? 'Loading more…' : 'Scroll for more' }}</span>
      </div>
    </div>

    <div class="log-empty" v-else>
      <span class="muted">{{ t('log.noCommit') }}</span>
    </div>

    <!-- Context menu for commit items (right-click) -->
    <CommitContextMenu
      v-if="ctxMenu.visible && ctxMenu.entry"
      :entry="ctxMenu.entry"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :idx="ctxMenu.idx"
      :is-search-active="isSearchActive"
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
</template>

<style scoped>
.commit-log {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.log-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-8);
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.log-list {
  list-style: none;
  flex: 1;
  overflow-y: auto;
}

/* ─── Section labels ──────────────────────────────────── */

.log-section-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-4);
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.log-section-label--unpushed {
  color: var(--color-warning);
  background: var(--color-bg-secondary);
  border-left: 3px solid var(--color-warning);
}

.log-section-label--unpublished {
  color: var(--color-accent);
  background: var(--color-bg-secondary);
  border-left: 3px solid var(--color-accent);
}

.log-section-label--pushed {
  color: var(--color-success);
  background: var(--color-bg-secondary);
  border-left: 3px solid var(--color-success);
}

/* ─── Commit item ─────────────────────────────────────── */

.commit-item {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background var(--transition-fast);
  border-left: 3px solid transparent;
}

.commit-item--unpushed {
  border-left-color: var(--color-warning);
  background: var(--color-warning-soft);
}

.commit-item--unpushed:hover {
  background: var(--color-warning-soft);
  opacity: 0.9;
}

.unpushed-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: var(--radius-pill);
  background: var(--color-warning-soft);
  color: var(--color-warning);
  margin-left: var(--space-1);
  vertical-align: middle;
}

.commit-item:hover {
  background: var(--color-bg-tertiary);
}

.commit-item--selected {
  background: var(--color-bg-tertiary);
  border-left-color: var(--color-accent);
}

.commit-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.commit-item:last-child {
  border-bottom: none;
}

.commit-edit-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: none;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
  align-self: center;
}

.commit-item:hover .commit-edit-btn {
  opacity: 0.7;
}

.commit-edit-btn:hover {
  opacity: 1 !important;
  color: var(--color-accent);
  background: var(--color-bg);
}

.commit-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  color: var(--color-accent-text);
  flex-shrink: 0;
  margin-top: 2px;
}

.commit-info {
  flex: 1;
  min-width: 0;
}

.commit-message {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: 3px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.commit-hash {
  font-size: var(--font-size-xs);
  color: var(--color-accent);
}

.commit-separator {
  opacity: 0.4;
}

.commit-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-date {
  flex-shrink: 0;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-10);
}

/* ─── Search bar (Phase 1.3.4) ────────────────────────────── */
.log-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.log-search-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.log-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  padding: 2px 0;
}

.log-search-input::placeholder {
  color: var(--color-text-muted);
}

.log-search-clear {
  flex-shrink: 0;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
}

.log-search-clear:hover {
  color: var(--color-text);
  background: var(--color-bg-hover);
}

.log-search-error,
.log-search-status {
  margin: 0;
  padding: 6px var(--space-3);
  font-size: var(--font-size-xs);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-search-error {
  color: var(--color-danger, #ef4444);
  background: var(--color-danger-soft, rgba(239, 68, 68, 0.06));
}

.log-search-status {
  color: var(--color-accent);
  background: var(--color-accent-soft, rgba(139, 92, 246, 0.06));
}

.commit-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 3px;
}

.commit-ref-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.commit-ref-badge--head,
.commit-ref-badge--branch {
  background: var(--color-accent-soft, rgba(124, 58, 237, 0.12));
  color: var(--color-accent);
}

.commit-ref-badge--tag {
  background: var(--color-warning-soft, rgba(245, 158, 11, 0.12));
  color: var(--color-warning, #f59e0b);
}

.commit-ref-badge--remote {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.commit-ai-reason {
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  line-height: 1.3;
  display: flex;
  align-items: flex-start;
  gap: 5px;
}

/* ─── Load-more sentinel (v2.11) ───────────────────────── */
.log-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0 12px;
}

.log-load-more__spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ll-spin 0.7s linear infinite;
  opacity: 0.5;
}

@keyframes ll-spin { to { transform: rotate(360deg); } }
</style>
