<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import type { GitLogEntry } from "../utils/backend";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const props = defineProps<{
  entry: GitLogEntry;
  x: number;
  y: number;
  /** Index in the displayed list — used to restrict some actions to HEAD. */
  idx: number;
  /** True when search is active (idx=0 might not be HEAD). */
  isSearchActive?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  checkout: [entry: GitLogEntry];
  reset: [entry: GitLogEntry, mode: "soft" | "mixed" | "hard"];
  revert: [entry: GitLogEntry];
  createBranch: [entry: GitLogEntry];
  tag: [entry: GitLogEntry];
  cherryPick: [entry: GitLogEntry];
  viewOnForge: [entry: GitLogEntry];
  editCommit: [entry: GitLogEntry];
  splitCommit: [entry: GitLogEntry];
  copySha: [sha: string];
  copyMessage: [entry: GitLogEntry];
}>();

/** True when the commit under the context menu is a merge (>1 parent). */
const isMerge = computed(() => (props.entry.parents?.length ?? 0) > 1);

/** True when the commit is the topmost entry and no search is active. */
const isHead = computed(() => !props.isSearchActive && props.idx === 0);

// ─── Sub-menu state ──────────────────────────────────────
const activeSubMenu = ref<"reset" | null>(null);

function onResetClick(mode: "soft" | "mixed" | "hard") {
  emit("reset", props.entry, mode);
  emit("close");
}

async function onCopySha(full: boolean) {
  const sha = full ? props.entry.hashFull : props.entry.hash;
  if (sha) {
    await navigator.clipboard.writeText(sha);
    emit("copySha", sha);
  }
  emit("close");
}

async function onCopyMessage() {
  const text = props.entry.body ? `${props.entry.message}\n\n${props.entry.body}` : props.entry.message;
  await navigator.clipboard.writeText(text);
  emit("copyMessage", props.entry);
  emit("close");
}

// ─── Click outside ───────────────────────────────────────
onMounted(() => {
  window.addEventListener("click", () => emit("close"));
  window.addEventListener("contextmenu", () => emit("close"));
});
</script>

<template>
  <Teleport to="body">
    <ul
      class="commit-ctx-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      role="menu"
      @click.stop
      @contextmenu.prevent
    >
      <!-- Checkout -->
      <li
        class="commit-ctx-menu-item"
        :class="{ 'commit-ctx-menu-item--disabled': isHead }"
        role="menuitem"
        :title="isHead ? t('commitCtx.checkoutHeadDisabled') : t('commitCtx.checkoutHint')"
        @click="!isHead && (emit('checkout', entry), emit('close'))"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.checkout') }}</span>
      </li>

      <!-- Reset (with Sub-menu) -->
      <li
        class="commit-ctx-menu-item commit-ctx-menu-item--has-sub"
        role="menuitem"
        @mouseenter="activeSubMenu = 'reset'"
        @mouseleave="activeSubMenu = null"
      >
        <div class="commit-ctx-menu-item-main" @click="onResetClick('mixed')">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8a5 5 0 1 0 1.5-3.5L2 2v4h4L4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('commitCtx.reset') }}</span>
        </div>
        <svg class="sub-arrow" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 12l4-4-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>

        <!-- Reset Sub-menu -->
        <ul v-if="activeSubMenu === 'reset'" class="commit-ctx-submenu">
          <li class="commit-ctx-menu-item" @click.stop="onResetClick('soft')">
            <span>Soft</span>
            <small class="muted">{{ t('commitCtx.resetSoftHint') }}</small>
          </li>
          <li class="commit-ctx-menu-item" @click.stop="onResetClick('mixed')">
            <span>Mixed</span>
            <small class="muted">{{ t('commitCtx.resetMixedHint') }}</small>
          </li>
          <li class="commit-ctx-menu-item" @click.stop="onResetClick('hard')">
            <span>Hard</span>
            <small class="muted" style="color: var(--color-danger)">{{ t('commitCtx.resetHardHint') }}</small>
          </li>
        </ul>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Branching -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="emit('createBranch', entry), emit('close')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2v8m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8-4a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 0v2a2 2 0 0 1-2 2H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.createBranch') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="emit('tag', entry), emit('close')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 2h6l6 6-6 6-6-6V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>
        </svg>
        <span>{{ t('commitCtx.tag') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        :class="{ 'commit-ctx-menu-item--disabled': isHead }"
        role="menuitem"
        :title="isHead ? t('commitCtx.cherryPickHeadDisabled') : undefined"
        @click="!isHead && (emit('cherryPick', entry), emit('close'))"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="5" cy="13" r="2" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="11" cy="13" r="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M5 11V7a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 4V1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.cherryPick') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- History operations -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="emit('revert', entry), emit('close')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M5 1L2 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.revert') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        :class="{ 'commit-ctx-menu-item--disabled': !isHead }"
        role="menuitem"
        :title="!isHead ? t('commitCtx.amendHeadOnly') : undefined"
        @click="isHead && (emit('editCommit', entry), emit('close'))"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('commitCtx.amend') }}</span>
      </li>
      <li
        class="commit-ctx-menu-item"
        :class="{ 'commit-ctx-menu-item--disabled': isMerge || !isHead }"
        role="menuitem"
        :title="isMerge ? t('splitCommit.errorMergeCommit') : !isHead ? t('commitCtx.splitHeadOnly') : undefined"
        @click="!isMerge && isHead && (emit('splitCommit', entry), emit('close'))"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v5m0 0l-3-3m3 3l3-3M3 10h10M5 14h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('splitCommit.contextMenuAction') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Clipboard -->
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCopySha(false)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5" y="4" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyShortSha') }}</span>
      </li>
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCopySha(true)">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5" y="4" width="9" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 8h3M8 11h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyFullSha') }}</span>
      </li>
      <li class="commit-ctx-menu-item" role="menuitem" @click="onCopyMessage">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12v8H2z" rx="1" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.copyMessage') }}</span>
      </li>

      <li class="commit-ctx-menu-sep" role="separator"></li>

      <!-- Forge -->
      <li
        class="commit-ctx-menu-item"
        role="menuitem"
        @click="emit('viewOnForge', entry), emit('close')"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 2h4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M14 2L8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span>{{ t('commitCtx.viewOnForge') }}</span>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
.commit-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
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
  position: relative;
}

.commit-ctx-menu-item:hover {
  background: var(--color-bg-tertiary);
}

.commit-ctx-menu-item svg {
  color: var(--color-text-muted);
  flex-shrink: 0;
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

/* ─── Sub-menu ────────────────────────────────────────── */

.commit-ctx-menu-item--has-sub {
  justify-content: space-between;
}

.commit-ctx-menu-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.sub-arrow {
  opacity: 0.5;
}

.commit-ctx-submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 220px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 8px 20px rgba(0, 0, 0, 0.18));
  padding: 4px;
  list-style: none;
}

.commit-ctx-submenu .commit-ctx-menu-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.commit-ctx-submenu small {
  font-size: 10px;
  display: block;
  line-height: 1.2;
}
</style>
