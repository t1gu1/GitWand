<script setup lang="ts">
/**
 * SearchPalette — global command palette (Cmd/Ctrl+K).
 *
 * MVP scope: branches + recent commits + actions, all filtered by a
 * single substring query. No AI, no fuzzy matching — just case-insensitive
 * `includes()` against the item's searchable text. Good enough to be
 * useful immediately, easy to replace later with a proper matcher.
 *
 * Built on BaseModal (top-anchored, chrome-less: hide-header + body-flush).
 * BaseModal owns the overlay, blur backdrop, Escape-to-close, and focus
 * management. We keep ArrowUp/Down/Enter at the document level so the
 * input doesn't have to own focus forever.
 *
 * Keyboard
 * ────────
 *   - Escape → close (handled by BaseModal)
 *   - ArrowUp / ArrowDown → move selection (wraps at ends)
 *   - Ctrl/Meta+N / +P → same as ArrowDown / ArrowUp
 *   - Enter → fire the selected item's event
 */
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import type { GitBranch, GitLogEntry } from "../../utils/backend";
import { useI18n } from "../../composables/useI18n";
import BaseModal from "../BaseModal.vue";

const { t } = useI18n();

export interface PaletteAction {
  /** Stable action id, routed back through the `runAction` event. */
  id: string;
  /** Display label (already localized by the parent). */
  label: string;
  /** Optional secondary text shown dim next to the label. */
  hint?: string;
}

const props = defineProps<{
  branches: GitBranch[];
  commits: GitLogEntry[];
  actions: PaletteAction[];
}>();

const emit = defineEmits<{
  close: [];
  switchBranch: [name: string];
  selectCommit: [hash: string];
  runAction: [id: string];
}>();

const query = ref("");
const selectedIndex = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLDivElement | null>(null);

// ─── Filtering ───────────────────────────────────────────────────
const DEFAULT_BRANCHES = 20;
const DEFAULT_COMMITS = 10;

const filteredBranches = computed<GitBranch[]>(() => {
  const q = query.value.trim().toLowerCase();
  const pool = props.branches.filter((b) => !b.isCurrent);
  if (!q) return pool.slice(0, DEFAULT_BRANCHES);
  return pool.filter((b) => b.name.toLowerCase().includes(q));
});

const filteredCommits = computed<GitLogEntry[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.commits.slice(0, DEFAULT_COMMITS);
  return props.commits.filter((c) => {
    const haystack = `${c.message} ${c.hash}`.toLowerCase();
    return haystack.includes(q);
  });
});

const filteredActions = computed<PaletteAction[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.actions;
  return props.actions.filter((a) => {
    const haystack = `${a.label} ${a.hint ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
});

type FlatItem =
  | { kind: "branch"; payload: GitBranch }
  | { kind: "commit"; payload: GitLogEntry }
  | { kind: "action"; payload: PaletteAction };

const flatItems = computed<FlatItem[]>(() => {
  const out: FlatItem[] = [];
  for (const b of filteredBranches.value) out.push({ kind: "branch", payload: b });
  for (const c of filteredCommits.value) out.push({ kind: "commit", payload: c });
  for (const a of filteredActions.value) out.push({ kind: "action", payload: a });
  return out;
});

const hasResults = computed(() => flatItems.value.length > 0);

watch(flatItems, (items) => {
  if (selectedIndex.value >= items.length) {
    selectedIndex.value = Math.max(0, items.length - 1);
  } else if (selectedIndex.value < 0 && items.length > 0) {
    selectedIndex.value = 0;
  }
});

watch(query, () => {
  selectedIndex.value = 0;
});

const branchOffset = computed(() => 0);
const commitOffset = computed(() => filteredBranches.value.length);
const actionOffset = computed(
  () => filteredBranches.value.length + filteredCommits.value.length,
);

function activate(index: number) {
  const item = flatItems.value[index];
  if (!item) return;
  if (item.kind === "branch") {
    const name = item.payload.isRemote
      ? item.payload.name.replace(/^origin\//, "")
      : item.payload.name;
    emit("switchBranch", name);
  } else if (item.kind === "commit") {
    emit("selectCommit", item.payload.hashFull);
  } else {
    emit("runAction", item.payload.id);
  }
  emit("close");
}

// ─── Keyboard handling ──────────────────────────────────────────
// Escape is owned by BaseModal; we only intercept navigation keys.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || (e.key === "n" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    if (flatItems.value.length === 0) return;
    selectedIndex.value = (selectedIndex.value + 1) % flatItems.value.length;
    scrollSelectedIntoView();
    return;
  }
  if (e.key === "ArrowUp" || (e.key === "p" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    if (flatItems.value.length === 0) return;
    selectedIndex.value =
      (selectedIndex.value - 1 + flatItems.value.length) % flatItems.value.length;
    scrollSelectedIntoView();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (hasResults.value) activate(selectedIndex.value);
    return;
  }
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const active = listEl.value?.querySelector<HTMLElement>(".palette-item--active");
    active?.scrollIntoView({ block: "nearest" });
  });
}

onMounted(() => {
  nextTick(() => inputEl.value?.focus());
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
});

function shortHash(h: string): string {
  return h.slice(0, 7);
}

function formatDate(d: string): string {
  return d;
}
</script>

<template>
  <BaseModal
    size="lg"
    position="top"
    :aria-label="t('header.searchAriaLabel')"
    hide-header
    body-flush
    scroll-own
    @close="emit('close')"
  >
    <div class="palette-input-wrap">
      <svg class="palette-input-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5" fill="none" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input
        ref="inputEl"
        v-model="query"
        class="palette-input"
        type="text"
        :placeholder="t('header.searchInputPlaceholder')"
        :aria-label="t('header.searchAriaLabel')"
        autocomplete="off"
        spellcheck="false"
      />
      <kbd class="palette-esc" aria-hidden="true">esc</kbd>
    </div>

    <div ref="listEl" class="palette-list">
      <!-- Branches section -->
      <template v-if="filteredBranches.length > 0">
        <div class="palette-section-label">{{ t('header.paletteSectionBranches') }}</div>
        <button
          v-for="(branch, i) in filteredBranches"
          :key="`b-${branch.name}`"
          class="palette-item"
          :class="{ 'palette-item--active': selectedIndex === branchOffset + i }"
          @click="activate(branchOffset + i)"
          @mouseenter="selectedIndex = branchOffset + i"
        >
          <svg class="palette-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.3" />
            <circle cx="5" cy="12" r="2" stroke="currentColor" stroke-width="1.3" />
            <circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
            <path d="M5 6v4M7 4h3c1.1 0 2 .9 2 2v0" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="palette-item-label mono">{{ branch.name }}</span>
          <span v-if="branch.isRemote" class="palette-item-tag">remote</span>
          <span v-else-if="branch.ahead > 0 || branch.behind > 0" class="palette-item-hint">
            <span v-if="branch.ahead > 0">&uarr;{{ branch.ahead }}</span>
            <span v-if="branch.behind > 0">&darr;{{ branch.behind }}</span>
          </span>
        </button>
      </template>

      <!-- Recent commits -->
      <template v-if="filteredCommits.length > 0">
        <div class="palette-section-label">{{ t('header.paletteSectionCommits') }}</div>
        <button
          v-for="(commit, i) in filteredCommits"
          :key="`c-${commit.hashFull}`"
          class="palette-item"
          :class="{ 'palette-item--active': selectedIndex === commitOffset + i }"
          @click="activate(commitOffset + i)"
          @mouseenter="selectedIndex = commitOffset + i"
        >
          <svg class="palette-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
            <path d="M1 8h4M11 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span class="palette-item-label">{{ commit.message }}</span>
          <span class="palette-item-hint mono">{{ shortHash(commit.hash) }}</span>
          <span class="palette-item-sub muted">{{ formatDate(commit.date) }}</span>
        </button>
      </template>

      <!-- Actions -->
      <template v-if="filteredActions.length > 0">
        <div class="palette-section-label">{{ t('header.paletteSectionActions') }}</div>
        <button
          v-for="(action, i) in filteredActions"
          :key="`a-${action.id}`"
          class="palette-item"
          :class="{ 'palette-item--active': selectedIndex === actionOffset + i }"
          @click="activate(actionOffset + i)"
          @mouseenter="selectedIndex = actionOffset + i"
        >
          <svg class="palette-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5 3l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="palette-item-label">{{ action.label }}</span>
          <span v-if="action.hint" class="palette-item-hint">{{ action.hint }}</span>
        </button>
      </template>

      <!-- Empty state -->
      <div v-if="!hasResults" class="palette-empty">
        {{ t('header.paletteNoResults') }}
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
/* ─── Input ─────────────────────────────────────────────── */
.palette-input-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.palette-input-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.palette-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  font-family: inherit;
  font-size: var(--font-size-lg, 15px);
  color: var(--color-text);
}
.palette-input::placeholder {
  color: var(--color-text-muted);
}

.palette-esc {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

/* ─── List ──────────────────────────────────────────────── */
.palette-list {
  max-height: 52vh;
  overflow-y: auto;
  padding: var(--space-2) 0;
}

.palette-section-label {
  padding: var(--space-3) var(--space-5) var(--space-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.palette-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-5);
  background: transparent;
  border: 0;
  color: var(--color-text);
  font-size: var(--font-size-base);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.palette-item--active {
  background: var(--color-accent-soft);
  color: var(--color-text);
}

.palette-item-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}
.palette-item--active .palette-item-icon {
  color: var(--color-accent);
}

.palette-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}

.palette-item-hint {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.palette-item-tag {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.palette-item-sub {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-empty {
  padding: var(--space-7) var(--space-5);
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
}
</style>
