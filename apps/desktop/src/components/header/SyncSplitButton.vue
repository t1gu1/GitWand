<script setup lang="ts">
/**
 * SyncSplitButton — state-aware primary action for the header.
 *
 * Derives its label, action and dropdown from `computeSyncAction` based on
 * ahead/behind counters + needsPublish. One button with one spinner and one
 * chevron: the chevron only appears when the state offers secondary actions
 * (ahead / behind / diverged / publish). Clean state is a plain button.
 *
 * All translation keys live under `syncAction.*` in the locale files.
 */
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "../../composables/useI18n";
import { computeSyncAction, type SyncAction } from "../../composables/useSyncAction";
import type { LocaleKey } from "../../locales/en";

const props = defineProps<{
  aheadCount: number;
  behindCount: number;
  needsPublish: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isFetching: boolean;
  canPush: boolean;
  canPull: boolean;
}>();

const emit = defineEmits<{
  push: [];
  pull: [];
  sync: [];
  fetch: [];
  publish: [];
  rebaseOntoRemote: [];
  mergeRemote: [];
}>();

const { t } = useI18n();

const action = computed(() =>
  computeSyncAction({
    aheadCount: props.aheadCount,
    behindCount: props.behindCount,
    needsPublish: props.needsPublish,
  }),
);

// Label with optional count interpolation. The syncAction.pushN / pullN keys
// use {0} for count; the singular variants (pushOne / pullOne) take no params.
const primaryLabel = computed(() => {
  const a = action.value;
  const n = a.primaryLabelParams?.n;
  // labelKey values are hand-authored in useSyncAction and correspond to real
  // entries in the locale files; cast is safe.
  const key = a.primary.labelKey as LocaleKey;
  return n === undefined ? t(key) : t(key, n);
});

// Which badge count to show on the primary button (if any).
const badgeCount = computed(() => {
  const a = action.value;
  if (a.state === "ahead") return props.aheadCount;
  if (a.state === "behind") return props.behindCount;
  return null;
});

// The primary is visually "active" (filled) when there's work to do.
const isPrimaryActive = computed(() => action.value.state !== "clean");

// Disable rules.
const isBusy = computed(() => props.isPushing || props.isPulling || props.isFetching);

const primaryDisabled = computed(() => {
  if (isBusy.value) return true;
  const a = action.value;
  if (a.state === "publish") return !props.canPush;
  if (a.state === "ahead") return !props.canPush;
  if (a.state === "behind") return !props.canPull;
  if (a.state === "diverged") return !(props.canPush && props.canPull);
  // clean: always clickable (triggers a fetch)
  return false;
});

// Show spinner in the icon slot when the matching op is in flight.
const showSpinner = computed(() => {
  const id = action.value.primary.id;
  if (id === "push" || id === "publish" || id === "sync") return props.isPushing || props.isPulling;
  if (id === "pull") return props.isPulling;
  if (id === "fetch") return props.isFetching;
  return false;
});

function runAction(id: SyncAction) {
  switch (id) {
    case "push":
    case "publish":
      emit(id === "publish" ? "publish" : "push");
      break;
    case "pull":
      emit("pull");
      break;
    case "sync":
      emit("sync");
      break;
    case "fetch":
      emit("fetch");
      break;
    case "rebaseOntoRemote":
      emit("rebaseOntoRemote");
      break;
    case "mergeRemote":
      emit("mergeRemote");
      break;
  }
}

function onPrimaryClick() {
  runAction(action.value.primary.id);
}

// ─── Dropdown ────────────────────────────────────────────
const showDropdown = ref(false);

function toggleDropdown() {
  showDropdown.value = !showDropdown.value;
}

function onDropdownItemClick(id: SyncAction) {
  showDropdown.value = false;
  runAction(id);
}

// Close on outside click.
const wrapperRef = ref<HTMLElement | null>(null);

function onDocClick(ev: MouseEvent) {
  if (!showDropdown.value) return;
  const el = wrapperRef.value;
  if (el && ev.target instanceof Node && !el.contains(ev.target)) {
    showDropdown.value = false;
  }
}

function onEsc(ev: KeyboardEvent) {
  if (ev.key === "Escape" && showDropdown.value) {
    showDropdown.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onEsc);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onEsc);
});

// Tooltip: varies by state.
const primaryTitle = computed(() => {
  const a = action.value;
  if (a.state === "clean") return t("syncAction.tooltipClean");
  if (a.state === "diverged") return t("syncAction.tooltipDiverged");
  return primaryLabel.value;
});
</script>

<template>
  <div ref="wrapperRef" class="sync-split" :class="{ 'sync-split--has-dropdown': action.dropdown.length > 0 }">
    <button
      type="button"
      class="btn btn--sync sync-split__primary"
      :class="{
        'btn--sync-active': isPrimaryActive,
        'sync-split__primary--has-chevron': action.dropdown.length > 0,
      }"
      :disabled="primaryDisabled"
      :title="primaryTitle"
      @click="onPrimaryClick"
    >
      <!-- Spinner while the primary op is in-flight -->
      <svg
        v-if="showSpinner"
        class="btn-spinner"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3" />
        <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
      </svg>
      <!-- Otherwise a state-appropriate icon -->
      <svg
        v-else-if="action.state === 'clean'"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <!-- Refresh / up-to-date icon -->
        <path
          d="M3 8a5 5 0 018.5-3.5M13 8a5 5 0 01-8.5 3.5M11 2v3h-3M5 14v-3h3"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg
        v-else-if="action.state === 'ahead' || action.state === 'publish'"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <!-- Push arrow (up) -->
        <path d="M8 13V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg
        v-else-if="action.state === 'behind'"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <!-- Pull arrow (down) -->
        <path d="M8 3v10M5 10l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <svg
        v-else
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <!-- Diverged: two arrows -->
        <path d="M4 3v10M1 6l3-3 3 3M12 13V3M9 10l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>

      <span>{{ primaryLabel }}</span>

      <span v-if="badgeCount !== null" class="sync-badge" :class="action.state === 'ahead' ? 'sync-badge--push' : 'sync-badge--pull'">
        {{ badgeCount }}
      </span>
    </button>

    <button
      v-if="action.dropdown.length > 0"
      type="button"
      class="btn btn--sync sync-split__chevron"
      :class="{ 'btn--sync-active': isPrimaryActive, 'sync-split__chevron--open': showDropdown }"
      :disabled="isBusy"
      :aria-label="t('syncAction.fetch')"
      aria-haspopup="menu"
      :aria-expanded="showDropdown ? 'true' : 'false'"
      @click.stop="toggleDropdown"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="showDropdown && action.dropdown.length > 0" class="sync-split__menu" role="menu">
      <button
        v-for="item in action.dropdown"
        :key="item.id"
        type="button"
        role="menuitem"
        class="sync-split__menu-item"
        @click="onDropdownItemClick(item.id)"
      >
        {{ t(item.labelKey as LocaleKey) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sync-split {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}

/* When there's a chevron, glue the two buttons together visually. */
.sync-split--has-dropdown .sync-split__primary {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  /* Hairline separator between primary and chevron */
  box-shadow: inset -1px 0 0 var(--color-border);
}

.sync-split--has-dropdown .sync-split__chevron {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding-left: var(--space-3);
  padding-right: var(--space-3);
  min-width: 28px;
}

.sync-split__primary--has-chevron.btn--sync-active {
  /* Separator stays visible on the active / filled state. */
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.3);
}

.sync-split__chevron svg {
  transition: transform var(--transition-base);
}

.sync-split__chevron--open svg {
  transform: rotate(180deg);
}

.sync-split__menu {
  position: absolute;
  top: calc(100% + var(--space-3));
  right: 0;
  min-width: 200px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  z-index: 50;
  animation: syncSplitSlide var(--transition-slow);
}

@keyframes syncSplitSlide {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.sync-split__menu-item {
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
}

.sync-split__menu-item:hover {
  background: var(--color-bg-tertiary);
}

.sync-split__menu-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
</style>
