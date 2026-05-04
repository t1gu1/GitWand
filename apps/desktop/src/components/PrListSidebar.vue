<script setup lang="ts">
/**
 * PrListSidebar.vue
 *
 * Compact PR list rendered inside RepoSidebar when viewMode === "prs".
 * Injects the shared usePrPanel state via provide/inject.
 *
 * Visual language:
 * - Pill-style segmented filter (Open / Closed / All)
 * - Cards with a colored left rail matching the PR state
 * - Hover-lift + active accent border, matching the rest of the app
 */
import { computed, inject, onMounted } from "vue";
import { PR_PANEL_KEY, type PrPanelState } from "../composables/usePrPanel";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const panel = inject<PrPanelState>(PR_PANEL_KEY)!;

onMounted(() => {
  panel.init();
});

type StateCls = "pls-state--open" | "pls-state--merged" | "pls-state--closed";

function stateInfo(state: string): { label: string; cls: StateCls } {
  const s = state.toUpperCase();
  if (s === "OPEN") return { label: t("pr.list.stateOpen"), cls: "pls-state--open" };
  if (s === "MERGED") return { label: t("pr.list.stateMerged"), cls: "pls-state--merged" };
  return { label: t("pr.list.stateClosed"), cls: "pls-state--closed" };
}

/** Total count shown as a subtle pill next to the title. */
const totalCount = computed(() => panel.displayedPrs.value.length);

const filterOptions = [
  { value: "open" as const, labelKey: "pr.list.filterOpen" as const },
  { value: "closed" as const, labelKey: "pr.list.filterClosed" as const },
  { value: "all" as const, labelKey: "pr.list.filterAll" as const },
];

function setFilter(v: "open" | "closed" | "all") {
  panel.filterState.value = v;
  panel.loadPrs();
}

function setUserFilter(mode: 'all' | 'assigned' | 'reviews') {
  panel.filterMode.value = mode;
}
</script>

<template>
  <div class="pls-root">
    <!-- Header : title + count + refresh -->
    <header class="pls-header">
      <div class="pls-title-row">
        <svg class="pls-title-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" y1="9" x2="6" y2="21" />
        </svg>
        <span class="pls-title">{{ t('pr.list.title') }}</span>
        <span v-if="!panel.loading.value && totalCount > 0" class="pls-count-pill">{{ totalCount }}</span>
        <button class="pls-icon-btn" @click="panel.loadPrs" :title="t('pr.list.refresh')" aria-label="Refresh">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" />
            <path d="M13.5 2.5v3h-3" />
          </svg>
        </button>
      </div>

      <!-- State filter -->
      <div class="pls-segmented" role="tablist" :aria-label="t('pr.list.title')">
        <button
          v-for="opt in filterOptions"
          :key="opt.value"
          type="button"
          role="tab"
          :aria-selected="panel.filterState.value === opt.value"
          :class="['pls-seg', { 'pls-seg--active': panel.filterState.value === opt.value }]"
          @click="setFilter(opt.value)"
        >
          {{ t(opt.labelKey) }}
        </button>
      </div>
      <!-- User filter: All / Assigned / Reviews -->
      <div class="pls-user-filter" role="tablist" :aria-label="t('pr.list.userFilterLabel')">
        <button
          type="button"
          role="tab"
          :aria-selected="panel.filterMode.value === 'all'"
          :class="['pls-uf-btn', { 'pls-uf-btn--active': panel.filterMode.value === 'all' }]"
          @click="setUserFilter('all')"
        >{{ t('pr.list.filterAll2') }}</button>
        <button
          type="button"
          role="tab"
          :aria-selected="panel.filterMode.value === 'assigned'"
          :class="['pls-uf-btn', { 'pls-uf-btn--active': panel.filterMode.value === 'assigned' }]"
          :title="t('pr.list.filterAssignedTitle')"
          @click="setUserFilter('assigned')"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          {{ t('pr.list.filterAssigned') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="panel.filterMode.value === 'reviews'"
          :class="['pls-uf-btn', { 'pls-uf-btn--active': panel.filterMode.value === 'reviews' }]"
          :title="t('pr.list.filterReviewsTitle')"
          @click="setUserFilter('reviews')"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          {{ t('pr.list.filterReviews') }}
        </button>
      </div>
    </header>

    <!-- New PR CTA -->
    <button
      class="pls-new-btn"
      :class="{ 'pls-new-btn--active': panel.showCreateForm.value }"
      @click="panel.showCreateForm.value = true"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M8 3v10M3 8h10" />
      </svg>
      <span>{{ t('pr.list.newBtn').replace(/^\+\s*/, '') }}</span>
    </button>

    <!-- Messages -->
    <div v-if="panel.error.value" class="pls-msg pls-msg--error">
      <span>{{ panel.error.value }}</span>
      <button class="pls-msg-action" @click="panel.loadPrs">{{ t('pr.error.retry') }}</button>
    </div>
    <div
      v-if="panel.success.value"
      class="pls-msg pls-msg--success"
      @click="panel.success.value = null"
    >{{ panel.success.value }}</div>

    <!-- Identity loading/error banner (only shown when a user filter is active) -->
    <div
      v-if="panel.filterMode.value !== 'all' && !panel.currentUser.value"
      class="pls-identity-banner"
    >
      <template v-if="panel.currentUserLoading.value">
        <div class="pls-spinner pls-spinner--sm" aria-hidden="true"></div>
        <span>{{ t('pr.list.identityLoading') }}</span>
      </template>
      <template v-else-if="panel.currentUserError.value">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span :title="panel.currentUserError.value">{{ t('pr.list.identityError') }}</span>
        <button class="pls-identity-retry" @click="panel.loadCurrentUser()">{{ t('pr.list.identityRetry') }}</button>
      </template>
    </div>

    <!-- List -->
    <div v-if="panel.loading.value" class="pls-placeholder">
      <div class="pls-spinner" aria-hidden="true"></div>
      <span>{{ t('pr.list.loading') }}</span>
    </div>
    <div v-else-if="panel.displayedPrs.value.length === 0 && (panel.filterMode.value === 'all' || panel.currentUser.value)" class="pls-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.4" aria-hidden="true">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M6 9v6M18 15V9a3 3 0 0 0-3-3H9" />
      </svg>
      <span>{{
        panel.filterMode.value === 'assigned' ? t('pr.list.emptyAssigned') :
        panel.filterMode.value === 'reviews'  ? t('pr.list.emptyReviews') :
        t('pr.list.empty')
      }}</span>
    </div>
    <div v-else class="pls-list">
      <button
        v-for="pr in panel.displayedPrs.value"
        :key="pr.number"
        class="pls-item"
        :class="[
          stateInfo(pr.state).cls,
          { 'pls-item--active': panel.selectedPr.value?.number === pr.number },
        ]"
        @click="panel.selectPr(pr)"
      >
        <!-- Row 1: num + state badge + draft + time -->
        <div class="pls-row-top">
          <span class="pls-num">#{{ pr.number }}</span>
          <span class="pls-state-chip" :class="stateInfo(pr.state).cls">
            <span class="pls-state-dot" aria-hidden="true"></span>
            {{ stateInfo(pr.state).label }}
          </span>
          <span v-if="pr.draft" class="pls-draft-chip">{{ t('pr.list.draft') }}</span>
          <span class="pls-time">{{ panel.timeAgo(pr.updatedAt || pr.createdAt) }}</span>
        </div>

        <!-- Row 2: title -->
        <div class="pls-title-text">{{ pr.title }}</div>

        <!-- Row 3: author + branch path -->
        <div class="pls-meta">
          <span class="pls-author">{{ pr.author }}</span>
          <span class="pls-branch mono" :title="`${pr.branch} → ${pr.base}`">
            <span class="pls-branch-from">{{ pr.branch }}</span>
            <svg class="pls-branch-arrow" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
            <span class="pls-branch-to">{{ pr.base }}</span>
          </span>
        </div>

        <!-- Row 4: stats -->
        <div class="pls-stats">
          <span class="pls-add">+{{ pr.additions }}</span>
          <span class="pls-del">−{{ pr.deletions }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ─── Shell ──────────────────────────────────────────────── */
.pls-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ─── Header ─────────────────────────────────────────────── */
.pls-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-5) var(--space-4);
  flex-shrink: 0;
}

.pls-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.pls-title-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.pls-title {
  flex: 1;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}

.pls-count-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 var(--space-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
}

.pls-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}
.pls-icon-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text);
}

/* ─── Segmented filter ───────────────────────────────────── */
.pls-segmented {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 2px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.pls-seg {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
}

.pls-seg:hover {
  color: var(--color-text);
}

.pls-seg--active {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

/* ─── User filter row (All / Assigned / Reviews) ─── */
.pls-user-filter {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 2px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.pls-uf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.pls-uf-btn:hover {
  color: var(--color-text);
}
.pls-uf-btn--active {
  background: var(--color-bg-secondary);
  color: var(--color-accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
}

/* ─── Identity banner ────────────────────────────────────── */
.pls-identity-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-5) var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  flex-shrink: 0;
}
.pls-spinner--sm {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
  flex-shrink: 0;
}
.pls-identity-retry {
  margin-left: auto;
  padding: 1px 6px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  cursor: pointer;
  white-space: nowrap;
}
.pls-identity-retry:hover {
  color: var(--color-text);
  border-color: var(--color-text-subtle);
}

/* ─── New PR button ──────────────────────────────────────── */
.pls-new-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin: 0 var(--space-5) var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  flex-shrink: 0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0 var(--color-accent-soft);
  transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}
.pls-new-btn:hover {
  background: var(--color-accent-hover);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22), 0 0 0 3px var(--color-accent-soft);
  transform: translateY(-1px);
}
.pls-new-btn:active {
  transform: translateY(0);
}
.pls-new-btn--active {
  box-shadow: 0 0 0 2px var(--color-accent-hover) inset, 0 2px 8px rgba(0, 0, 0, 0.22);
}

/* ─── Messages ───────────────────────────────────────────── */
.pls-msg {
  margin: 0 var(--space-5) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  line-height: var(--line-height-snug);
}
.pls-msg--error {
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border: 1px solid var(--color-danger);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pls-msg-action {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 2px var(--space-3);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.pls-msg-action:hover {
  background: var(--color-danger);
  color: #fff;
}
.pls-msg--success {
  background: var(--color-success-soft);
  color: var(--color-success);
  border: 1px solid var(--color-success);
  cursor: pointer;
}

/* ─── Placeholder ────────────────────────────────────────── */
.pls-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  font-size: var(--font-size-base);
  color: var(--color-text-muted);
  padding: var(--space-8);
  text-align: center;
}

.pls-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: pls-spin 0.8s linear infinite;
}

@keyframes pls-spin {
  to { transform: rotate(360deg); }
}

/* ─── List ───────────────────────────────────────────────── */
.pls-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-5);
}

.pls-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  padding-left: calc(var(--space-4) + 1px); /* rail sits on the inside of the 3px border */
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-text-muted);
  cursor: pointer;
  text-align: left;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  transition: background var(--transition-fast), border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
  width: 100%;
  flex-shrink: 0; /* prevent flex parent from crushing the card when many items overflow */
  overflow: hidden;
}

.pls-item:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border-strong);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.pls-item--active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent) inset;
}
.pls-item--active:hover {
  transform: none;
}

/* Colored left rail, driven by state class (overrides base border-left) */
.pls-item.pls-state--open   { border-left-color: var(--color-success); }
.pls-item.pls-state--merged { border-left-color: var(--color-accent); }
.pls-item.pls-state--closed { border-left-color: var(--color-danger); }

/* Row 1 */
.pls-row-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.pls-num {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-accent);
  font-family: var(--font-mono);
}

.pls-state-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 1px var(--space-3);
  border-radius: var(--radius-pill);
  border: 1px solid;
  line-height: 1.5;
}

.pls-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.pls-state-chip.pls-state--open {
  color: var(--color-success);
  background: var(--color-success-soft);
  border-color: transparent;
}
.pls-state-chip.pls-state--merged {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: transparent;
}
.pls-state-chip.pls-state--closed {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: transparent;
}

.pls-draft-chip {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  padding: 1px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  border: 1px dashed var(--color-border-strong);
  line-height: 1.5;
}

.pls-time {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  white-space: nowrap;
}

/* Row 2 */
.pls-title-text {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  line-height: var(--line-height-snug);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

/* Row 3 */
.pls-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow: hidden;
}

.pls-author {
  flex-shrink: 0;
  font-weight: var(--font-weight-medium);
  max-width: 100px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pls-branch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  min-width: 0;
  overflow: hidden;
}

.pls-branch-from,
.pls-branch-to {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
}
.pls-branch-arrow {
  color: var(--color-text-subtle);
  flex-shrink: 0;
}

/* Row 4 */
.pls-stats {
  display: flex;
  gap: var(--space-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  font-family: var(--font-mono);
}

.pls-add { color: var(--color-success); }
.pls-del { color: var(--color-danger); }

.mono { font-family: var(--font-mono); }

@media (prefers-reduced-motion: reduce) {
  .pls-item,
  .pls-new-btn {
    transition: none;
  }
  .pls-item:hover,
  .pls-new-btn:hover {
    transform: none;
  }
  .pls-spinner {
    animation: none;
  }
}
</style>
