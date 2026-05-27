<script setup lang="ts">
/**
 * BranchSelector — branch-chip trigger + popover (local/remote branches,
 * filter, create form with optional AI naming, per-item actions, and a
 * nested MergePreviewPanel).
 *
 * Previously lived inline inside `AppHeader.vue`; extracted in task #7
 * to keep the header file readable and to give the branch-picker a
 * clean surface for future work (keyboard nav, "branches view", etc.).
 *
 * Layout (trigger)
 * ────────────────
 * Line 1 — branch icon + branch name + chevron
 * Line 2 — inline stats (staged / modified / untracked / conflicts)
 *
 * The 2-line layout lets us keep the dirty-state context attached to
 * the branch chip rather than splitting it into a separate group. When
 * there are no stats to show, the chip collapses to a single line.
 *
 * Click-outside
 * ─────────────
 * Owned here (not by the parent) — when the component is mounted,
 * popover lifecycle is self-contained. The handler uses `.closest()`
 * against the wrapper class on this component's root, so clicks on
 * either the trigger OR the popover count as "inside".
 */
import { ref, computed, inject, onMounted, onUnmounted, watch, type Ref } from "vue";
import type { GitBranch } from "../../utils/backend";
import { useI18n } from "../../composables/useI18n";
import type { LocaleKey } from "../../locales";
import { useMergePreview } from "../../composables/useMergePreview";
import { useAIProvider } from "../../composables/useAIProvider";
import { useBranchName } from "../../composables/useBranchName";
import { BRANCH_CREATE_REQUEST_KEY } from "../../composables/branchPickerBridge";
import MergePreviewPanel from "../MergePreviewPanel.vue";
import AiSparkle from "../AiSparkle.vue";

const { t } = useI18n();

const props = defineProps<{
  branchDisplay: string;
  repoStats: { staged: number; unstaged: number; untracked: number; conflicted: number; added: number; modified: number; deleted: number; renamed: number };
  branches: GitBranch[];
  branchesLoading: boolean;
  isSwitchingBranch: boolean;
  /** Path to the current repository (needed by the merge-preview composable). */
  cwd: string;
}>();

const emit = defineEmits<{
  switchBranch: [name: string];
  createBranch: [name: string];
  deleteBranch: [name: string];
  openWorktrees: [branch?: string];
  loadBranches: [];
  changeView: [mode: 'changes'];
}>();

// Whether the working tree has anything worth reporting — drives the
// stats line inside the trigger. Conflicts count as "stats" too since
// that's the most urgent state and should surface in the chip.
const hasRepoStats = computed(
  () =>
    props.repoStats.staged +
      props.repoStats.unstaged +
      props.repoStats.untracked +
      props.repoStats.conflicted >
    0,
);

/**
 * Pick the singular or plural label for a stat based on the count.
 *
 * The four stats kinds map to `header.<kind>` (plural) and
 * `header.<kind>One` (singular). Some languages inflect the participle
 * ("modifié" / "modifiés" in FR); others use the same form for both
 * ("modified" in EN, "已修改" in zh-CN) — the singular keys carry the
 * right value regardless, so the callsite doesn't have to know which.
 */
type StatKind = "staged" | "modified" | "untracked" | "conflicts";
function statLabel(kind: StatKind, n: number): string {
  const key = (`header.${kind}${n === 1 ? "One" : ""}`) as LocaleKey;
  return t(key);
}

// ─── Popover state ───────────────────────────────────────────────
const showPopover = ref(false);
const branchFilter = ref("");
const showCreate = ref(false);
const newBranchName = ref("");

// External create-form trigger (currently used by the native macOS menu's
// "New Branch…" item). Each bump of the injected counter opens the popover
// and the inline create form. The input's `autofocus` does the rest.
const createRequest = inject<Ref<number> | null>(BRANCH_CREATE_REQUEST_KEY, null);
if (createRequest) {
  watch(createRequest, () => {
    showPopover.value = true;
    showCreate.value = true;
    branchFilter.value = "";
    newBranchName.value = "";
    emit("loadBranches");
  });
}

const ai = useAIProvider();
const {
  isGenerating: isGeneratingBranchName,
  suggest: suggestBranchName,
  lastError: branchNameAiError,
} = useBranchName();

async function handleBranchNameAI() {
  try {
    const suggestion = await suggestBranchName(props.cwd, newBranchName.value);
    if (suggestion) newBranchName.value = suggestion;
  } catch {
    // Surfaced via branchNameAiError ref in the template
  }
}

function togglePopover() {
  showPopover.value = !showPopover.value;
  if (showPopover.value) {
    branchFilter.value = "";
    emit("loadBranches");
  }
}

function closePopover() {
  showPopover.value = false;
  showCreate.value = false;
  newBranchName.value = "";
}

const mainNames = ["main", "master"];

function branchSort(a: GitBranch, b: GitBranch): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  const aName = a.name.replace(/^origin\//, "").toLowerCase();
  const bName = b.name.replace(/^origin\//, "").toLowerCase();
  const aMain = mainNames.includes(aName) ? 0 : 1;
  const bMain = mainNames.includes(bName) ? 0 : 1;
  if (aMain !== bMain) return aMain - bMain;
  if (a.lastCommitDate && b.lastCommitDate) {
    const da = new Date(a.lastCommitDate).getTime();
    const db = new Date(b.lastCommitDate).getTime();
    if (da !== db) return db - da;
  }
  return a.name.localeCompare(b.name);
}

const localBranches = computed(() =>
  props.branches
    .filter((b) => !b.isRemote)
    .filter((b) => !branchFilter.value || b.name.toLowerCase().includes(branchFilter.value.toLowerCase()))
    .sort(branchSort),
);

const remoteBranches = computed(() =>
  props.branches
    .filter((b) => b.isRemote)
    .filter((b) => !branchFilter.value || b.name.toLowerCase().includes(branchFilter.value.toLowerCase()))
    .sort(branchSort),
);

function handleBranchSwitch(name: string) {
  emit("switchBranch", name);
  closePopover();
}

function handleBranchCreate() {
  const name = newBranchName.value.trim();
  if (!name) return;
  emit("createBranch", name);
  newBranchName.value = "";
  showCreate.value = false;
  closePopover();
}

function onCreateKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    handleBranchCreate();
  } else if (e.key === "Escape") {
    showCreate.value = false;
    newBranchName.value = "";
  }
}

// ─── Merge Preview (inside popover) ──────────────────────────────
const {
  loading: previewLoading,
  error: previewError,
  summary: previewSummary,
  conflictingFiles: previewConflicts,
  computePreview,
  reset: resetPreview,
} = useMergePreview(() => props.cwd);

const previewingBranch = ref<string | null>(null);

async function togglePreview(branchName: string) {
  if (previewingBranch.value === branchName) {
    previewingBranch.value = null;
    resetPreview();
    return;
  }
  previewingBranch.value = branchName;
  await computePreview(branchName);
}

function closePreview() {
  previewingBranch.value = null;
  resetPreview();
}

// ─── Click-outside to close ──────────────────────────────────────
// Attached to the document once at mount; cleaned up on unmount. We
// use `.closest('.branch-popover-wrapper')` so clicks on either the
// trigger or the popover count as "inside" (both live under that
// wrapper root).
function onDocClick(e: MouseEvent) {
  if (!showPopover.value) return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest(".branch-popover-wrapper")) {
    closePopover();
  }
}

onMounted(() => document.addEventListener("click", onDocClick, true));
onUnmounted(() => document.removeEventListener("click", onDocClick, true));
</script>

<template>
  <div class="branch-popover-wrapper">
    <!--
      2-line layout:
        Line 1 — branch icon + branch name + chevron
        Line 2 — inline stats (staged / modified / untracked / conflicts)
      When stats are absent, the chip collapses to a single line via
      the `branch-trigger--with-stats` modifier being dropped.
    -->
    <button
      class="branch-trigger"
      :class="{
        'branch-trigger--loading': isSwitchingBranch,
        'branch-trigger--with-stats': hasRepoStats,
      }"
      :title="branchDisplay"
      @click="togglePopover"
    >
      <svg v-if="isSwitchingBranch" class="btn-spinner branch-trigger__icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3" />
        <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" />
      </svg>
      <svg v-else class="branch-trigger__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="5" cy="4" r="2" stroke="currentColor" stroke-width="1.3" />
        <circle cx="5" cy="12" r="2" stroke="currentColor" stroke-width="1.3" />
        <circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
        <path d="M5 6v4M7 4h3c1.1 0 2 .9 2 2v0" stroke="currentColor" stroke-width="1.3" />
      </svg>

      <span class="branch-trigger__body">
        <div class="branch-trigger__name-row">
          <span class="branch-trigger__name mono">{{ branchDisplay }}</span>
          <span
            v-if="hasRepoStats"
            class="branch-trigger__changes-dot"
            :title="t('sidebar.tabChanges')"
            @click.stop="emit('changeView', 'changes')"
          ></span>
        </div>
        <span v-if="hasRepoStats" class="branch-trigger__stats">
          <span v-if="repoStats.staged > 0" class="branch-trigger__stat">
            <span class="branch-trigger__stat-dot" style="background: var(--color-success)"></span>
            {{ repoStats.staged }} {{ statLabel('staged', repoStats.staged) }}
          </span>
          <span v-if="repoStats.unstaged > 0" class="branch-trigger__stat">
            <span class="branch-trigger__stat-dot" style="background: var(--color-warning)"></span>
            {{ repoStats.unstaged }} {{ statLabel('modified', repoStats.unstaged) }}
          </span>
          <span v-if="repoStats.untracked > 0" class="branch-trigger__stat">
            <span class="branch-trigger__stat-dot" style="background: var(--color-text-muted)"></span>
            {{ repoStats.untracked }} {{ statLabel('untracked', repoStats.untracked) }}
          </span>
          <span v-if="repoStats.conflicted > 0" class="branch-trigger__stat">
            <span class="branch-trigger__stat-dot" style="background: var(--color-danger)"></span>
            {{ repoStats.conflicted }} {{ statLabel('conflicts', repoStats.conflicted) }}
          </span>
        </span>
      </span>

      <svg class="branch-chevron" :class="{ 'branch-chevron--open': showPopover }" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2.5 3.5l2.5 3 2.5-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="showPopover" class="branch-popover">
      <div class="bp-header">
        <input
          v-model="branchFilter"
          class="bp-filter"
          :placeholder="t('branches.filter')"
          autofocus
          @keydown.escape="closePopover"
        />
        <button class="bp-action-btn" :title="t('branches.create')" @click="showCreate = !showCreate">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div v-if="showCreate" class="bp-create">
        <input
          v-model="newBranchName"
          class="bp-create-input mono"
          :placeholder="t('branches.namePlaceholder')"
          autofocus
          @keydown="onCreateKeydown"
        />
        <button
          v-if="ai.isAvailable.value"
          type="button"
          class="btn btn--ai btn--icon"
          :disabled="isGeneratingBranchName"
          :title="t('branches.aiHint')"
          :aria-label="t('branches.aiHint')"
          @click="handleBranchNameAI"
        >
          <span v-if="isGeneratingBranchName">…</span>
          <AiSparkle v-else :size="14" />
        </button>
        <button
          class="bp-create-btn"
          :disabled="!newBranchName.trim()"
          @click="handleBranchCreate"
        >
          {{ t('common.create') }}
        </button>
      </div>
      <p v-if="showCreate && branchNameAiError" class="bp-create-error">{{ branchNameAiError }}</p>

      <div v-if="branchesLoading" class="bp-loading">
        <div class="bp-spinner"></div>
      </div>
      <div v-else class="bp-lists">
        <div v-if="localBranches.length > 0" class="bp-section">
          <div class="bp-section-label">{{ t('branches.local') }}</div>
          <ul class="bp-list">
            <template v-for="branch in localBranches" :key="branch.name">
              <li
                class="bp-item"
                :class="{ 'bp-item--current': branch.isCurrent }"
                @click="!branch.isCurrent && handleBranchSwitch(branch.name)"
              >
                <span v-if="branch.isCurrent" class="bp-current-dot"></span>
                <div class="bp-item-main">
                  <svg v-if="branch.hasWorktree" class="bp-worktree-indicator" :title="t('worktree.hasWorktreeTooltip')" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2l3 4H5l3-4zM8 5l4 5H4l4-5zM8 9l5 6H3l5-6z" fill="currentColor" />
                  </svg>
                  <span class="bp-item-name mono">{{ branch.name }}</span>
                </div>
                <span v-if="branch.ahead > 0 || branch.behind > 0" class="bp-item-meta muted">
                  <span v-if="branch.ahead > 0">&uarr;{{ branch.ahead }}</span>
                  <span v-if="branch.behind > 0">&darr;{{ branch.behind }}</span>
                </span>
                <button
                  v-if="!branch.isCurrent"
                  class="bp-item-preview"
                  :class="{ 'bp-item-preview--active': previewingBranch === branch.name }"
                  :title="t('branches.previewMerge')"
                  @click.stop="togglePreview(branch.name)"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
                    <path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                </button>
                <button
                  v-if="!branch.isCurrent"
                  class="bp-item-worktree"
                  :title="t('worktree.openInWorktreeTabTooltip')"
                  @click.stop="emit('openWorktrees', branch.name); closePopover();"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
                    <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
                    <rect x="5.5" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
                    <path d="M4.5 7v1.5M11.5 7v1.5M4.5 8.5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                  </svg>
                </button>
                <button
                  v-if="!branch.isCurrent"
                  class="bp-item-delete"
                  :title="t('branches.deleteLabel')"
                  @click.stop="emit('deleteBranch', branch.name)"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </li>
              <li v-if="previewingBranch === branch.name" class="bp-preview-row">
                <MergePreviewPanel
                  :loading="previewLoading"
                  :error="previewError"
                  :summary="previewSummary"
                  :conflicting-files="previewConflicts"
                  :target-branch="branchDisplay"
                  @close="closePreview"
                />
              </li>
            </template>
          </ul>
        </div>
        <div v-if="remoteBranches.length > 0" class="bp-section">
          <div class="bp-section-label">{{ t('branches.remote') }}</div>
          <ul class="bp-list">
            <li
              v-for="branch in remoteBranches"
              :key="branch.name"
              class="bp-item bp-item--remote"
              @click="handleBranchSwitch(branch.name.replace(/^origin\//, ''))"
            >
              <span class="bp-item-name mono">{{ branch.name }}</span>
            </li>
          </ul>
        </div>
        <div v-if="localBranches.length === 0 && remoteBranches.length === 0" class="bp-empty">
          <span class="muted">{{ t('branches.noBranch') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── Branch trigger ────────────────────────────────────── */
.branch-popover-wrapper {
  position: relative;
}

.branch-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  /* Softer, less "pill-y" radius — reads like a field/selector rather
     than a toggle chip. */
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-bg-tertiary);
  transition: background var(--transition-base), color var(--transition-base);
  cursor: pointer;
  max-width: 320px;
  min-width: 0;
}
.branch-trigger:hover {
  background: var(--color-border);
}
.branch-trigger--loading {
  opacity: 0.7;
  pointer-events: none;
}
/* Beefier vertical padding when a stats line is present so both rows
   breathe. Without this the 2-line layout looks cramped at the top/bottom. */
.branch-trigger--with-stats {
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
}

.branch-trigger__icon {
  flex-shrink: 0;
  /* Nudge the icon up so it sits on the same baseline as the branch
     name row (and not mid-height between the two lines). */
  align-self: flex-start;
  margin-top: 3px;
}
.branch-trigger:not(.branch-trigger--with-stats) .branch-trigger__icon {
  align-self: center;
  margin-top: 0;
}

/* Vertical stack holding the name on line 1 and stats on line 2. */
.branch-trigger__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  line-height: 1.15;
}

.branch-trigger__name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.branch-trigger__name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  max-width: 240px;
}

.branch-trigger__changes-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  border: 1.2px dashed var(--color-accent);
  flex-shrink: 0;
  transition: transform var(--transition-fast), border-color var(--transition-fast);
}
.branch-trigger__changes-dot:hover {
  transform: scale(1.2);
  border-color: var(--color-accent-hover, var(--color-accent));
}

/* Inline stats row: tiny dots + count label + unit. Colour-muted so
   the branch name remains the primary read. */
.branch-trigger__stats {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--space-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.branch-trigger__stat {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.branch-trigger__stat-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.branch-chevron {
  transition: transform var(--transition-base);
  opacity: 0.5;
  flex-shrink: 0;
  align-self: center;
}
.branch-chevron--open { transform: rotate(180deg); }

.btn-spinner { animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Branch popover ────────────────────────────────────── */
.branch-popover {
  position: absolute;
  top: calc(100% + var(--space-3));
  left: 0;
  width: 340px;
  max-height: 520px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  z-index: 50;
  animation: bpSlide var(--transition-slow);
  overflow: hidden;
}

@keyframes bpSlide {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.bp-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}

.bp-filter {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-base);
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.bp-filter:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.bp-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  background: none;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.bp-action-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.bp-create {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border);
}
.bp-create-input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-base);
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  outline: none;
}
.bp-create-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.bp-create-btn {
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: var(--radius-pill);
}
.bp-create-btn:disabled { opacity: 0.4; }

.bp-create-error {
  margin: 0;
  padding: 0 var(--space-5) var(--space-3);
  font-size: var(--font-size-xs);
  color: var(--color-danger, #ef4444);
  border-bottom: 1px solid var(--color-border);
}

.bp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.bp-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: var(--radius-pill);
  animation: spin 0.7s linear infinite;
}

.bp-lists {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
}

.bp-section { border-bottom: 1px solid var(--color-border); }
.bp-section:last-child { border-bottom: none; }

.bp-section-label {
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.bp-list { list-style: none; }

.bp-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  cursor: pointer;
  transition: background var(--transition-fast);
  font-size: var(--font-size-base);
}
.bp-item:hover { background: var(--color-bg-tertiary); }
.bp-item--current { background: var(--color-bg-tertiary); cursor: default; }

.bp-current-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  flex-shrink: 0;
}

.bp-item-main {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
}

.bp-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}

.bp-worktree-indicator {
  flex-shrink: 0;
  opacity: 0.5;
  color: var(--color-text-muted);
}
.bp-item:hover .bp-worktree-indicator,
.bp-item--current .bp-worktree-indicator {
  opacity: 0.8;
  color: var(--color-accent);
}
.bp-item--remote .bp-item-name { opacity: 0.7; }

.bp-item-meta {
  font-size: var(--font-size-xs);
  flex-shrink: 0;
}

.bp-item-preview,
.bp-item-worktree,
.bp-item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  background: none;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.bp-item:hover .bp-item-preview,
.bp-item:hover .bp-item-worktree,
.bp-item:hover .bp-item-delete { opacity: 0.6; }
.bp-item-preview:hover { opacity: 1 !important; color: var(--color-accent); }
.bp-item-preview--active { opacity: 1 !important; color: var(--color-accent); background: var(--color-accent-soft); }
.bp-item-worktree:hover { opacity: 1 !important; color: var(--color-accent); }
.bp-item-delete:hover { opacity: 1 !important; color: var(--color-danger); }

.bp-preview-row {
  list-style: none;
  padding: var(--space-2) var(--space-4) var(--space-3);
}

.bp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-7);
  font-size: var(--font-size-base);
}

/* Local copies of .btn and .btn--icon so the AI button inside .bp-create
   renders consistently. We don't import from the parent scoped styles. */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  transition: background var(--transition-base), color var(--transition-base), transform var(--transition-fast);
  white-space: nowrap;
}

.btn--icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-muted);
  transition: background var(--transition-base), color var(--transition-base);
}
.btn--icon:hover:not(:disabled) {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}
.btn--icon:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
