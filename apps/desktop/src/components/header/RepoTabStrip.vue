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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { RepoTab } from "../../composables/useRepoTabs";
import { useI18n } from "../../composables/useI18n";
import { useFolderHistory } from "../../composables/useFolderHistory";

const { t } = useI18n();
const { history: repoHistory } = useFolderHistory();

const props = defineProps<{
  tabs: RepoTab[];
  activeTabId: number | null;
}>();

const emit = defineEmits<{
  switchTab: [tabId: number];
  closeTab: [tabId: number];
  newTab: [];
  openClone: [];
  openFork: [];
  openRecent: [path: string];
  closeOtherTabs: [tabId: number];
}>();

// Pinned and recent repos shown in the + dropdown (excludes repos already
// open in a tab). Capped at 8 combined entries so the menu stays compact;
// pinned items always win a slot, the remainder goes to recents.
const MAX_DROPDOWN_ENTRIES = 8;

const dropdownEntries = computed(() => {
  const openPaths = new Set(props.tabs.map((t) => t.path));
  const eligible = repoHistory.value.filter((e) => !openPaths.has(e.path));
  const pinned = eligible.filter((e) => e.pinned);
  const recent = eligible.filter((e) => !e.pinned);
  const pinnedSlice = pinned.slice(0, MAX_DROPDOWN_ENTRIES);
  const recentSlice = recent.slice(0, MAX_DROPDOWN_ENTRIES - pinnedSlice.length);
  return { pinned: pinnedSlice, recent: recentSlice };
});

const pinnedRepos = computed(() => dropdownEntries.value.pinned);
const recentRepos = computed(() => dropdownEntries.value.recent);
const hasAnyRepo = computed(
  () => pinnedRepos.value.length > 0 || recentRepos.value.length > 0,
);

// ─── + button dropdown (v2.0) ────────────────────────────
//
// The strip itself sets `overflow-x: auto` for horizontal tab scrolling,
// which forces a `overflow-y` clip too — meaning a regular absolute-positioned
// dropdown anchored to the + button is silently clipped (the menu opens but
// is invisible because it falls below the strip's content edge). Fix:
// teleport the menu to <body>, position it via getBoundingClientRect, and
// extend the click-outside test to count the (now-detached) menu as inside.
const showMenu = ref(false);
const wrapperEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

function updateMenuPosition() {
  const el = wrapperEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  menuStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
  };
}

function toggleMenu() {
  showMenu.value = !showMenu.value;
}

function closeMenu() {
  showMenu.value = false;
}

function pickAction(action: "newTab" | "openClone" | "openFork") {
  closeMenu();
  if (action === "newTab") emit("newTab");
  else if (action === "openClone") emit("openClone");
  else emit("openFork");
}

function onDocumentClick(e: MouseEvent) {
  if (!showMenu.value) return;
  const target = e.target as Node | null;
  if (!target) return;
  // Click is "inside" if it's on the trigger wrapper or anywhere in the
  // teleported menu — treat both as in-bounds so the menu doesn't close
  // before the item's @click handler fires.
  if (wrapperEl.value?.contains(target)) return;
  if (menuEl.value?.contains(target)) return;
  closeMenu();
}

function onDocumentKey(e: KeyboardEvent) {
  if (e.key === "Escape" && showMenu.value) {
    closeMenu();
  }
}

// Reposition when the menu opens — and close on resize / strip scroll
// rather than trying to re-anchor mid-flight (would feel jittery).
watch(showMenu, (open) => {
  if (open) nextTick(() => updateMenuPosition());
});

function onWindowChange() {
  if (showMenu.value) closeMenu();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentClick);
  document.addEventListener("keydown", onDocumentKey);
  window.addEventListener("resize", onWindowChange);
  window.addEventListener("scroll", onWindowChange, true);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKey);
  window.removeEventListener("resize", onWindowChange);
  window.removeEventListener("scroll", onWindowChange, true);
});

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

    <!-- + button: opens a dropdown with Open folder / Clone / Fork (v2.0) -->
    <div ref="wrapperEl" class="repo-tab-new-wrap">
      <button
        type="button"
        class="repo-tab-new"
        :class="{ 'repo-tab-new--open': showMenu }"
        :title="t('header.tabStripAddTitle')"
        :aria-label="t('header.tabStripAddTitle')"
        :aria-expanded="showMenu"
        aria-haspopup="menu"
        @click="toggleMenu"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
          <path d="M7 1.5a.5.5 0 01.5.5v4.5H12a.5.5 0 010 1H7.5V12a.5.5 0 01-1 0V7.5H2a.5.5 0 010-1h4.5V2a.5.5 0 01.5-.5z" />
        </svg>
      </button>
    </div>
    <!-- Dropdown menu — teleported to <body> to escape the tab strip's
         overflow clipping. Positioned via inline style relative to the
         button wrapper's bounding rect (recomputed on open). -->
    <Teleport to="body">
      <div
        v-if="showMenu"
        ref="menuEl"
        class="repo-tab-new-menu"
        role="menu"
        :style="menuStyle"
      >
        <button
          type="button"
          role="menuitem"
          class="repo-tab-new-item"
          @click="pickAction('newTab')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 013.5 2H6l1.5 2H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" stroke-width="1.5" />
          </svg>
          {{ t('header.tabStripOpenFolder') }}
        </button>
        <button
          type="button"
          role="menuitem"
          class="repo-tab-new-item"
          @click="pickAction('openClone')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ t('header.tabStripClone') }}
        </button>
        <button
          type="button"
          role="menuitem"
          class="repo-tab-new-item"
          @click="pickAction('openFork')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="6" cy="5" r="2.2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="18" cy="5" r="2.2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="12" cy="19" r="2.2" stroke="currentColor" stroke-width="1.6" />
            <path d="M6 7.2v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            <path d="M12 13.2v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          {{ t('header.tabStripFork') }}
        </button>

        <!--
          Pinned + Recent sections. The separator + label combo is rendered
          only if the corresponding list is non-empty, so we never leak an
          orphan <hr> when the user has no history yet. Pinned comes first,
          then a secondary separator before recents (only if both exist).
        -->
        <template v-if="hasAnyRepo">
          <div class="repo-tab-new-separator" role="separator" aria-hidden="true"></div>
          <div v-if="pinnedRepos.length > 0" class="repo-tab-new-section">
            <div class="repo-tab-new-section-label">{{ t('header.tabStripPinnedSection') }}</div>
            <button
              v-for="entry in pinnedRepos"
              :key="entry.path"
              type="button"
              role="menuitem"
              class="repo-tab-new-item repo-tab-new-item--recent"
              :title="entry.path"
              @click="closeMenu(); emit('openRecent', entry.path)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 3.5A1.5 1.5 0 013.5 2h3.586a1.5 1.5 0 011.06.44l.915.914a1 1 0 00.707.293H12.5A1.5 1.5 0 0114 5.147V12.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" stroke-width="1.2" />
              </svg>
              <span class="repo-tab-new-item__text">
                <span class="repo-tab-new-item__name">{{ entry.name }}</span>
                <span class="repo-tab-new-item__path">{{ entry.path }}</span>
              </span>
              <span class="repo-tab-new-item__pin" aria-hidden="true">★</span>
            </button>
          </div>
          <div
            v-if="pinnedRepos.length > 0 && recentRepos.length > 0"
            class="repo-tab-new-separator repo-tab-new-separator--inner"
            role="separator"
            aria-hidden="true"
          ></div>
          <div v-if="recentRepos.length > 0" class="repo-tab-new-section">
            <div class="repo-tab-new-section-label">{{ t('header.tabStripRecentSection') }}</div>
            <button
              v-for="entry in recentRepos"
              :key="entry.path"
              type="button"
              role="menuitem"
              class="repo-tab-new-item repo-tab-new-item--recent"
              :title="entry.path"
              @click="closeMenu(); emit('openRecent', entry.path)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 3.5A1.5 1.5 0 013.5 2h3.586a1.5 1.5 0 011.06.44l.915.914a1 1 0 00.707.293H12.5A1.5 1.5 0 0114 5.147V12.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-9z" stroke="currentColor" stroke-width="1.2" />
              </svg>
              <span class="repo-tab-new-item__text">
                <span class="repo-tab-new-item__name">{{ entry.name }}</span>
                <span class="repo-tab-new-item__path">{{ entry.path }}</span>
              </span>
            </button>
          </div>
        </template>
      </div>
    </Teleport>
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

.repo-tab-new-wrap {
  position: relative;
  display: inline-flex;
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

.repo-tab-new:hover,
.repo-tab-new--open {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* Dropdown menu — teleported to body, so position: fixed (top/left set
   inline from the trigger's bounding rect). Scoped CSS still applies via
   the data-v attribute that Vue keeps on the teleported root element. */
.repo-tab-new-menu {
  position: fixed;
  min-width: 240px;
  max-width: 320px;
  max-height: 360px;
  overflow-y: auto;
  padding: var(--space-2);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
}

.repo-tab-new-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: transparent;
  border: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.repo-tab-new-item:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.repo-tab-new-item svg {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.repo-tab-new-item:hover svg {
  color: var(--color-accent);
}

/* ─── Pinned + Recent sections ──────────────────────────
   Two adjacent sub-sections, each with its own header. The
   `inner` separator visually splits pinned/recent when both
   exist, while the top-level separator splits actions from
   the history block. */
.repo-tab-new-separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-2) 0;
}

.repo-tab-new-separator--inner {
  margin: var(--space-1) 0;
}

.repo-tab-new-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.repo-tab-new-section-label {
  padding: var(--space-1) var(--space-4);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

/* History entries show name + truncated path stacked vertically.
   `__text` is the flex column wrapper that owns the ellipsis on
   both lines — the parent .repo-tab-new-item provides the row
   layout (icon | text | optional pin star). */
.repo-tab-new-item--recent {
  align-items: center;
}

.repo-tab-new-item__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  gap: 1px;
}

.repo-tab-new-item__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-tab-new-item__path {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-normal);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-tab-new-item--recent:hover .repo-tab-new-item__path {
  color: var(--color-accent);
  opacity: 0.8;
}

.repo-tab-new-item__pin {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--color-accent);
}
</style>
