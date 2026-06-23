<script setup lang="ts">
/**
 * AppDock — floating bottom-center navigation dock.
 *
 * Replaces the per-view tabs that used to live inside RepoSidebar and the
 * vertical Git Tree toggle strip. Each entry switches the main `viewMode`, so
 * every view can render full-bleed (no permanent left/right asides).
 *
 * Dumb renderer: it reads the active `viewMode` and emits `change-view`; all
 * routing lives in App.vue.
 */
import { computed } from "vue";
import type { ViewMode } from "../composables/useGitRepo";
import { useI18n } from "../composables/useI18n";
import { useSettings } from "../composables/useSettings";

const props = defineProps<{
  viewMode: ViewMode;
  /** Uncommitted-file count — shown as a badge on the Changes entry. */
  changesCount?: number;
  /** Open-PR count — shown as a badge on the PRs entry. */
  prCount?: number;
}>();

const emit = defineEmits<{
  changeView: [mode: ViewMode];
}>();

const { t } = useI18n();
const { settings } = useSettings();

type DockItem = { id: ViewMode; label: string };

const items = computed<DockItem[]>(() => {
  const list: DockItem[] = [];
  if (!settings.value.dockHideDashboard) list.push({ id: "dashboard", label: t("sidebar.tabDashboard") });
  if (!settings.value.dockHidePrs) list.push({ id: "prs", label: "PRs" });
  return list;
});

/** Today (launchpad) entry is hideable; Git Tree & Changes are always shown. */
const showLaunchpad = computed(() => !settings.value.dockHideLaunchpad);
/** When true, the dock renders icons only — text labels are hidden. */
const iconsOnly = computed(() => settings.value.dockIconsOnly);

function isActive(id: ViewMode): boolean {
  // History is a sub-view reached from the Git Tree (clicking a commit), so
  // it keeps the Git Tree entry highlighted.
  if (id === "graph") return props.viewMode === "graph" || props.viewMode === "history";
  return props.viewMode === id;
}
</script>

<template>
  <nav class="app-dock" :aria-label="t('sidebar.tabChanges')">
    <div class="app-dock__pill" :class="{ 'app-dock__pill--icons-only': iconsOnly }">
      <!-- Launchpad — cross-repo hub (relocated here from the header). -->
      <button
        v-if="showLaunchpad"
        class="dock-btn"
        :class="{ 'dock-btn--active': isActive('launchpad') }"
        :aria-pressed="isActive('launchpad')"
        :title="t('launchpad.openTooltip')"
        @click="emit('changeView', 'launchpad')"
      >
        <svg class="dock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4.5 16.5c-1.5 1-2 4-2 4s3-.5 4-2c.6-.85.5-2 .5-2"/>
          <path d="M12 15l-3-3a11 11 0 0 1 7-9c2.5 0 4 1.5 4 4a11 11 0 0 1-9 7l1 1z"/>
          <path d="M9 12H5s.5-2.5 2-3.5c1.3-.85 3-.5 3-.5"/>
          <path d="M12 15v4s2.5-.5 3.5-2c.85-1.3.5-3 .5-3"/>
          <circle cx="15" cy="9" r="1.2"/>
        </svg>
        <span class="dock-label">{{ t('launchpad.title') }}</span>
      </button>

      <!-- Separates the cross-repo Launchpad from the per-repo views. -->
      <span v-if="showLaunchpad" class="dock-sep" aria-hidden="true"></span>

      <button
        v-for="item in items"
        :key="item.id"
        class="dock-btn"
        :class="{ 'dock-btn--active': isActive(item.id) }"
        :aria-pressed="isActive(item.id)"
        :title="item.label"
        @click="emit('changeView', item.id)"
      >
        <svg v-if="item.id === 'dashboard'" class="dock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
        </svg>
        <svg v-else class="dock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" />
        </svg>
        <span class="dock-label">{{ item.label }}</span>
        <span v-if="item.id === 'prs' && prCount" class="dock-badge">{{ prCount }}</span>
      </button>

      <button
        class="dock-btn"
        :class="{ 'dock-btn--active': isActive('graph') }"
        :aria-pressed="isActive('graph')"
        :title="t('sidebar.gitTree')"
        @click="emit('changeView', 'graph')"
      >
        <svg class="dock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="12" r="3" /><path d="M6 9v6" /><path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span class="dock-label">{{ t('sidebar.gitTree') }}</span>
      </button>

      <button
        class="dock-btn"
        :class="{ 'dock-btn--active': isActive('changes') }"
        :aria-pressed="isActive('changes')"
        :title="t('sidebar.tabChanges')"
        @click="emit('changeView', 'changes')"
      >
        <svg class="dock-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="dock-label">{{ t('sidebar.tabChanges') }}</span>
        <span v-if="changesCount" class="dock-badge">{{ changesCount }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.app-dock {
  position: absolute;
  bottom: var(--space-4, 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  pointer-events: none;
}

.app-dock__pill {
  pointer-events: auto;
  display: flex;
  align-items: stretch;
  gap: var(--space-1, 4px);
  padding: var(--space-2, 6px);
  background: color-mix(in srgb, var(--color-bg-secondary) 97%, transparent);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 10px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.dock-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: var(--space-3, 9px) var(--space-5, 18px);
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-md, 14px);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.dock-btn:hover {
  background: var(--color-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--color-text);
}

.dock-btn--active {
  background: var(--color-accent-soft, rgba(139, 92, 246, 0.16));
  color: var(--color-accent);
}

.dock-btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.dock-sep {
  flex-shrink: 0;
  align-self: stretch;
  width: 1px;
  margin: var(--space-1, 4px) var(--space-1, 4px);
  background: var(--color-border);
}

.dock-icon {
  flex-shrink: 0;
}

.dock-label {
  line-height: 1;
}

/* Icons-only mode — hide labels, tighten the buttons to square icon tiles. */
.app-dock__pill--icons-only .dock-label {
  display: none;
}

.app-dock__pill--icons-only .dock-btn {
  padding: var(--space-3, 9px);
}

.dock-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 0;
}
</style>
