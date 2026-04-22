<script setup lang="ts">
/**
 * RepoTabStrip — replaces RepoTabBar in the new header layout.
 *
 * What changes vs. RepoTabBar
 * ───────────────────────────
 *  - Always visible when ≥ 1 tab is open (same as before, unchanged).
 *  - "+" button sits immediately after the last tab, browser-tab style —
 *    no more `margin-left: auto` pushing it to the far right.
 *  - Intended to live ABOVE the logo/header row (stacking), so the
 *    component now renders a plain inline strip instead of a full-width
 *    bar with its own background. The parent owns the wrapping bar.
 *
 * Behaviour kept from RepoTabBar
 * ──────────────────────────────
 *  - Middle-click closes a tab.
 *  - `closeOtherTabs` event kept for forwards-compat even though the
 *    context menu isn't wired yet — removing the event would be an
 *    unrelated breaking change.
 *
 * Behaviour changed from RepoTabBar
 * ─────────────────────────────────
 *  - The active tab chip is rendered even in single-tab mode (browser-
 *    style), instead of showing just the "+". This keeps the current
 *    repo visible in the header and makes the close affordance reachable
 *    without requiring the user to first open a second tab.
 */
import { computed } from "vue";
import type { RepoTab } from "../../composables/useRepoTabs";

const props = defineProps<{
  tabs: RepoTab[];
  activeTabId: number | null;
}>();

const emit = defineEmits<{
  switchTab: [tabId: number];
  closeTab: [tabId: number];
  newTab: [];
  closeOtherTabs: [tabId: number];
}>();

/**
 * Strip renders as soon as at least one repo is open. Unlike the old
 * RepoTabBar, we also render the active tab's chip in single-tab mode —
 * the browser-tab aesthetic is all about "you can see your context even
 * when there's just one" and it makes multi-repo support discoverable
 * without requiring a click on "+".
 */
const showStrip = computed(() => props.tabs.length >= 1);
const showTabs = computed(() => props.tabs.length >= 1);

function onMiddleClick(e: MouseEvent, tabId: number) {
  if (e.button === 1) {
    e.preventDefault();
    emit("closeTab", tabId);
  }
}

function onCloseClick(e: MouseEvent, tabId: number) {
  e.stopPropagation();
  emit("closeTab", tabId);
}
</script>

<template>
  <div v-if="showStrip" class="repo-tab-strip" role="tablist">
    <!-- Tabs — rendered only when there are multiple repos -->
    <template v-if="showTabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="repo-tab"
        :class="{ 'repo-tab--active': tab.id === activeTabId }"
        :aria-selected="tab.id === activeTabId ? 'true' : 'false'"
        :title="tab.path"
        @click="emit('switchTab', tab.id)"
        @mousedown="(e) => onMiddleClick(e, tab.id)"
      >
        <svg class="repo-tab__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 3.5A1.5 1.5 0 013.5 2h3.586a1.5 1.5 0 011.06.44l.915.914a1 1 0 00.707.293H12.5A1.5 1.5 0 0114 5.147V12.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span class="repo-tab__name">{{ tab.name }}</span>
        <span
          class="repo-tab__close"
          role="button"
          tabindex="-1"
          aria-label="Close tab"
          @click="(e) => onCloseClick(e, tab.id)"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
            <path d="M2.354 2.354a.5.5 0 01.707 0L5 4.293l1.94-1.94a.5.5 0 01.706.708L5.707 5l1.94 1.94a.5.5 0 01-.707.706L5 5.707l-1.94 1.94a.5.5 0 01-.706-.707L4.293 5l-1.94-1.94a.5.5 0 010-.706z" />
          </svg>
        </span>
      </button>
    </template>

    <!-- + button: immediately after the last tab (browser-tab style) -->
    <button
      type="button"
      class="repo-tab-new"
      :title="'Open new repo tab'"
      aria-label="Open new repo tab"
      @click="emit('newTab')"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
        <path d="M7 1.5a.5.5 0 01.5.5v4.5H12a.5.5 0 010 1H7.5V12a.5.5 0 01-1 0V7.5H2a.5.5 0 010-1h4.5V2a.5.5 0 01.5-.5z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* The strip is an inline container; the parent (AppHeader) owns the
   surrounding bar's background, padding and border. Keeping this
   component chrome-less lets the parent compose tabs + logo + header
   row without fighting nested backgrounds. */
.repo-tab-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  /* Horizontal scroll when many tabs accumulate — prevents the strip
     from pushing the "+" off-screen. */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

/* Tabs are pills, matching the rest of the header's chip vocabulary
   (branch-trigger, action buttons). The old "browser-tab" bottom-edge
   trick is out — it fought the parent bar's own border and looked
   floating on dark backgrounds. Active state is marked with a tinted
   background + accent color, same language as segmented controls. */
.repo-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color var(--transition-base), background var(--transition-base);
  max-width: 200px;
  min-width: 0;
  flex-shrink: 1;
  user-select: none;
  white-space: nowrap;
}

.repo-tab:hover {
  color: var(--color-text);
  background: var(--color-bg-tertiary);
}

.repo-tab--active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.repo-tab__icon {
  flex-shrink: 0;
  opacity: 0.65;
}

.repo-tab--active .repo-tab__icon {
  opacity: 1;
  color: var(--color-accent);
}

.repo-tab__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* Close affordance — only visible on hover / active, like browser tabs */
.repo-tab__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
  padding: 0;
}

.repo-tab:hover .repo-tab__close,
.repo-tab--active .repo-tab__close {
  opacity: 0.7;
}

.repo-tab__close:hover {
  opacity: 1 !important;
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.repo-tab-new {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: var(--space-1);
  border-radius: var(--radius-pill);
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.repo-tab-new:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}
</style>
