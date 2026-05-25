<script setup lang="ts">
/**
 * BranchMenu — secondary "Branch" dropdown in the header.
 *
 * Groups all branch-level operations that used to live as individual header
 * buttons (merge, worktrees, submodules, rebase, rewind) plus two new ones
 * (rename, delete) behind a single dropdown. Keeps the header uncluttered
 * and gives each action a full label instead of a mystery icon.
 *
 * UX model
 * ─────────
 *  - One trigger button (chevron). Click opens the menu.
 *  - Items emit semantic events; the parent (AppHeader / App) owns the
 *    actual git operations and the actual dialogs.
 *  - Rename and Delete both open proper modals (owned by App.vue) —
 *    BranchMenu just signals intent and closes. We used to do an inline
 *    rename panel + window.confirm for delete, but both were pulled out
 *    for a consistent modal UX with a type-the-name guard on delete.
 *  - "Advanced" expands to reveal Worktrees + Submodules. We avoid a real
 *    submenu (flyout positioning is fiddly with overflow) and just
 *    disclose inline, accordion-style.
 *
 * All labels come from the `branchMenu.*` locale group.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "../../composables/useI18n";

const props = defineProps<{
  /** Name of the currently-checked-out branch. Used in rename/delete copy. */
  currentBranch: string | null;
  /** Disable the whole menu while heavy ops are running. */
  disabled?: boolean;
  /** Whether there are uncommitted changes (drives the discard action). */
  hasChanges?: boolean;
  /** Number of commits current HEAD is ahead of main (for action gating). */
  mainCommitCount?: number;
}>();

const emit = defineEmits<{
  openMergePicker: [];
  openRebasePicker: [];
  /** User clicked "Rename…" — parent should pop the rename modal. */
  openRenameModal: [];
  /** User clicked "Delete…" — parent should pop the delete modal. */
  openDeleteModal: [];
  openRewind: [];
  openWorktrees: [];
  openSubmodules: [];
  discardAll: [];
}>();

const { t } = useI18n();

// ─── Menu open/close ───────────────────────────────────────────────
const showMenu = ref(false);
const showAdvanced = ref(false);

const wrapperRef = ref<HTMLElement | null>(null);

function toggleMenu() {
  if (props.disabled) return;
  showMenu.value = !showMenu.value;
  if (!showMenu.value) {
    showAdvanced.value = false;
  }
}

function closeMenu() {
  showMenu.value = false;
  showAdvanced.value = false;
}

function onDocClick(ev: MouseEvent) {
  if (!showMenu.value) return;
  const el = wrapperRef.value;
  if (el && ev.target instanceof Node && !el.contains(ev.target)) {
    closeMenu();
  }
}

function onEsc(ev: KeyboardEvent) {
  if (ev.key !== "Escape" || !showMenu.value) return;
  // Escape unwinds one level at a time: if the Advanced accordion is
  // open, close it first; next Escape closes the whole menu.
  if (showAdvanced.value) {
    showAdvanced.value = false;
    return;
  }
  closeMenu();
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onEsc);
});

// ─── Item handlers ─────────────────────────────────────────────────
function onMergeInto() {
  closeMenu();
  emit("openMergePicker");
}

function onRebaseOnto() {
  closeMenu();
  emit("openRebasePicker");
}

function onRewind() {
  closeMenu();
  emit("openRewind");
}

function onWorktrees() {
  closeMenu();
  emit("openWorktrees");
}

function onSubmodules() {
  closeMenu();
  emit("openSubmodules");
}

function onRenameClick() {
  if (!props.currentBranch) return;
  closeMenu();
  emit("openRenameModal");
}

function onDeleteClick() {
  if (!props.currentBranch) return;
  closeMenu();
  emit("openDeleteModal");
}

function onDiscardAll() {
  closeMenu();
  emit("discardAll");
}

// ─── Derived state ─────────────────────────────────────────────────
const hasBranch = computed(() => !!props.currentBranch);
</script>

<template>
  <div ref="wrapperRef" class="branch-menu">
    <button
      type="button"
      class="btn btn--sync branch-menu__trigger"
      :class="{ 'branch-menu__trigger--open': showMenu }"
      :disabled="disabled"
      :aria-haspopup="'menu'"
      :aria-expanded="showMenu ? 'true' : 'false'"
      :title="t('branchMenu.title')"
      @click.stop="toggleMenu"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <!-- branch glyph: same 3-dot shape used elsewhere in the header -->
        <circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.3" />
        <circle cx="5" cy="12" r="2" stroke="currentColor" stroke-width="1.3" />
        <circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
        <path d="M5 6v4M10 8H7c-1.1 0-2-.9-2-2" stroke="currentColor" stroke-width="1.3" />
      </svg>
      <span>{{ t('branchMenu.title') }}</span>
      <svg class="branch-menu__chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="showMenu" class="branch-menu__panel" role="menu">
      <button
        type="button"
        role="menuitem"
        class="branch-menu__item"
        :disabled="!hasBranch || mainCommitCount === 0"
        @click="onMergeInto"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.3" />
          <circle cx="5" cy="12" r="2" stroke="currentColor" stroke-width="1.3" />
          <circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
          <path d="M5 6v4M10 8H7c-1.1 0-2-.9-2-2" stroke="currentColor" stroke-width="1.3" />
        </svg>
        <span>{{ t('branchMenu.mergeInto') }}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        class="branch-menu__item"
        :disabled="!hasBranch || mainCommitCount === 0"
        @click="onRebaseOnto"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 3v6a3 3 0 003 3h5M9 9l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ t('branchMenu.rebaseOnto') }}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        class="branch-menu__item"
        :disabled="!hasBranch"
        @click="onRenameClick"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 11l7-7 3 3-7 7H2v-3zM9 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ t('branchMenu.rename') }}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        class="branch-menu__item branch-menu__item--danger"
        :disabled="!hasChanges"
        @click="onDiscardAll"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('sidebar.discardAll') }}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        class="branch-menu__item branch-menu__item--danger"
        :disabled="!hasBranch"
        @click="onDeleteClick"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('branchMenu.deleteLabel') }}</span>
      </button>

      <div class="branch-menu__separator" role="separator"></div>

      <button
        type="button"
        role="menuitem"
        class="branch-menu__item"
        @click="onRewind"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 3L2 8l5 5M14 3L9 8l5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ t('branchMenu.rewind') }}</span>
      </button>

      <!-- ── Advanced (disclosure) ───────────────────────────── -->
      <button
        type="button"
        role="menuitem"
        class="branch-menu__item branch-menu__item--toggle"
        :aria-expanded="showAdvanced ? 'true' : 'false'"
        @click="showAdvanced = !showAdvanced"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <span>{{ t('branchMenu.advanced') }}</span>
        <svg class="branch-menu__item-chevron" :class="{ 'branch-menu__item-chevron--open': showAdvanced }" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <div v-if="showAdvanced" class="branch-menu__nested">
        <button
          type="button"
          role="menuitem"
          class="branch-menu__item branch-menu__item--nested"
          @click="onWorktrees"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
            <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
            <rect x="5.5" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none" />
            <path d="M4.5 7v1.5M11.5 7v1.5M4.5 8.5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          <span>{{ t('worktree.title') }}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          class="branch-menu__item branch-menu__item--nested"
          @click="onSubmodules"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none" />
            <rect x="6" y="6" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1.3" fill="none" />
          </svg>
          <span>{{ t('submodule.title') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.branch-menu {
  position: relative;
  display: inline-flex;
}

.branch-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.branch-menu__chevron {
  transition: transform var(--transition-base);
}

.branch-menu__trigger--open .branch-menu__chevron {
  transform: rotate(180deg);
}

.branch-menu__panel {
  position: absolute;
  top: calc(100% + var(--space-3));
  left: 0;
  min-width: 240px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  z-index: 50;
  animation: branchMenuSlide var(--transition-slow);
}

@keyframes branchMenuSlide {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.branch-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: transparent;
  border: 0;
  color: var(--color-text);
  font-size: var(--font-size-md);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  width: 100%;
}

.branch-menu__item:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
}

.branch-menu__item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.branch-menu__item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.branch-menu__item--danger {
  color: var(--color-danger, #d03a3a);
}
.branch-menu__item--danger:hover:not(:disabled) {
  background: var(--color-danger-soft, rgba(208, 58, 58, 0.12));
}

.branch-menu__separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-2) var(--space-3);
}

.branch-menu__item--toggle {
  justify-content: flex-start;
}

.branch-menu__item-chevron {
  margin-left: auto;
  transition: transform var(--transition-base);
  opacity: 0.7;
}
.branch-menu__item-chevron--open {
  transform: rotate(180deg);
}

.branch-menu__nested {
  display: flex;
  flex-direction: column;
  padding-left: var(--space-3);
  margin-top: var(--space-1);
  border-left: 1px solid var(--color-border);
  margin-left: var(--space-4);
}

.branch-menu__item--nested {
  padding: var(--space-2) var(--space-4);
}
</style>
