<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  gitWorktreeList,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitWorktreePrune,
  type WorktreeEntry,
} from "../utils/backend";
import type { GitBranch } from "../utils/backend";
import { useI18n } from "../composables/useI18n";

const props = defineProps<{
  cwd: string;
  branches: GitBranch[];
  /** Pre-select this branch in the new-worktree form and open the form automatically. */
  suggestedBranch?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-tab", path: string): void;
}>();

const { t } = useI18n();

const worktrees = ref<WorktreeEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// New worktree form
const showForm = ref(false);
const formPath = ref("");
const formBranch = ref("");
const formNewBranch = ref("");
const creating = ref(false);

// Remove confirmation
const confirmRemovePath = ref<string | null>(null);
const forceRemove = ref(false);
const removing = ref(false);

async function loadWorktrees() {
  loading.value = true;
  error.value = null;
  try {
    worktrees.value = await gitWorktreeList(props.cwd);
  } catch (err: any) {
    error.value = t("worktree.errorList").replace("{0}", String(err?.message ?? err));
  } finally {
    loading.value = false;
  }
}

async function createWorktree() {
  if (!formPath.value.trim() || !formBranch.value.trim()) return;
  creating.value = true;
  error.value = null;
  try {
    await gitWorktreeAdd(
      props.cwd,
      formPath.value.trim(),
      formBranch.value.trim(),
      formNewBranch.value.trim() || undefined,
    );
    formPath.value = "";
    formBranch.value = "";
    formNewBranch.value = "";
    showForm.value = false;
    await loadWorktrees();
  } catch (err: any) {
    error.value = t("worktree.errorCreate").replace("{0}", String(err?.message ?? err));
  } finally {
    creating.value = false;
  }
}

function requestRemove(path: string) {
  confirmRemovePath.value = path;
  forceRemove.value = false;
}

function cancelRemove() {
  confirmRemovePath.value = null;
  forceRemove.value = false;
}

async function confirmRemove() {
  if (!confirmRemovePath.value) return;
  removing.value = true;
  error.value = null;
  try {
    await gitWorktreeRemove(props.cwd, confirmRemovePath.value, forceRemove.value);
    confirmRemovePath.value = null;
    await loadWorktrees();
  } catch (err: any) {
    error.value = t("worktree.errorRemove").replace("{0}", String(err?.message ?? err));
    confirmRemovePath.value = null;
  } finally {
    removing.value = false;
  }
}

async function prune() {
  error.value = null;
  try {
    await gitWorktreePrune(props.cwd);
    await loadWorktrees();
  } catch (err: any) {
    error.value = t("worktree.errorPrune").replace("{0}", String(err?.message ?? err));
  }
}

function shortPath(path: string): string {
  // Show last 2 segments for readability
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? path : "…/" + parts.slice(-2).join("/");
}

onMounted(() => {
  loadWorktrees();
  if (props.suggestedBranch) {
    formBranch.value = props.suggestedBranch;
    showForm.value = true;
  }
});
</script>

<template>
  <div class="worktree-manager">
    <!-- Header -->
    <div class="wt-header">
      <h3>{{ t("worktree.title") }}</h3>
      <div class="wt-header-actions">
        <button
          class="btn btn-xs"
          :title="t('worktree.pruneTooltip')"
          @click="prune"
        >
          {{ t("worktree.prune") }}
        </button>
        <button class="btn btn-xs btn-primary" @click="showForm = !showForm">
          + {{ t("worktree.newWorktree") }}
        </button>
        <button class="btn btn-xs btn-icon" @click="emit('close')" aria-label="Close">✕</button>
      </div>
    </div>

    <!-- New worktree form -->
    <div v-if="showForm" class="wt-form">
      <div class="wt-form-row">
        <label class="wt-label" for="wt-form-path">{{ t("worktree.formPath") }}</label>
        <input
          id="wt-form-path"
          v-model="formPath"
          class="wt-input"
          :placeholder="t('worktree.formPathPlaceholder')"
          @keydown.enter="createWorktree"
        />
      </div>
      <div class="wt-form-row">
        <label class="wt-label" for="wt-form-branch">{{ t("worktree.formBranch") }}</label>
        <select id="wt-form-branch" v-model="formBranch" class="wt-select">
          <option value="" disabled>{{ t("worktree.formBranchPlaceholder") }}</option>
          <option
            v-for="b in branches.filter(b => !b.isRemote)"
            :key="b.name"
            :value="b.name"
          >{{ b.name }}</option>
        </select>
      </div>
      <div class="wt-form-row">
        <label class="wt-label" for="wt-form-new-branch">{{ t("worktree.formNewBranch") }}</label>
        <input
          id="wt-form-new-branch"
          v-model="formNewBranch"
          class="wt-input"
          :placeholder="t('worktree.formNewBranchPlaceholder')"
          @keydown.enter="createWorktree"
        />
      </div>
      <div class="wt-form-actions">
        <button
          class="btn btn-primary"
          :disabled="creating || !formPath.trim() || !formBranch.trim()"
          @click="createWorktree"
        >
          {{ creating ? t("worktree.creating") : t("worktree.create") }}
        </button>
        <button class="btn btn-outline" @click="showForm = false">
          {{ t("common.cancel") }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="wt-error">{{ error }}</div>

    <!-- Remove confirmation dialog -->
    <div v-if="confirmRemovePath" class="wt-confirm">
      <p>{{ t("worktree.removeConfirm").replace("{0}", shortPath(confirmRemovePath)) }}</p>
      <label class="wt-checkbox-row">
        <input type="checkbox" v-model="forceRemove" />
        <span>{{ t("worktree.removeForce") }}</span>
      </label>
      <div class="wt-confirm-actions">
        <button
          class="btn btn-danger"
          :disabled="removing"
          @click="confirmRemove"
        >
          {{ removing ? t("worktree.removing") : t("common.delete") }}
        </button>
        <button class="btn btn-outline" @click="cancelRemove">{{ t("common.cancel") }}</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="wt-state">{{ t("common.loading") }}</div>

    <!-- Empty -->
    <div v-else-if="!loading && worktrees.length === 0" class="wt-state wt-empty">
      {{ t("worktree.empty") }}
    </div>

    <!-- List -->
    <div v-else class="wt-list">
      <div v-for="wt in worktrees" :key="wt.path" class="wt-item">
        <div class="wt-item-info">
          <div class="wt-item-badges">
            <span v-if="wt.is_main" class="badge badge-main">{{ t("worktree.main") }}</span>
            <span v-if="wt.is_locked" class="badge badge-locked">{{ t("worktree.locked") }}</span>
            <span v-if="wt.is_bare" class="badge badge-bare">{{ t("worktree.bare") }}</span>
          </div>
          <div class="wt-item-branch">
            <span class="branch-icon">⎇</span>
            {{ wt.branch || t("worktree.detached") }}
          </div>
          <div class="wt-item-path" :title="wt.path">{{ shortPath(wt.path) }}</div>
          <div v-if="wt.head" class="wt-item-head">{{ wt.head.slice(0, 7) }}</div>
        </div>
        <div class="wt-item-actions">
          <button
            class="btn btn-xs"
            @click="emit('open-tab', wt.path)"
          >
            {{ t("worktree.openInTab") }}
          </button>
          <button
            v-if="!wt.is_main"
            class="btn btn-xs btn-danger"
            @click="requestRemove(wt.path)"
          >
            {{ t("worktree.remove") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.worktree-manager {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  max-height: inherit;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.35));
  overflow: hidden;
}

/* ── Header ────────────────────────────────────────────── */
.wt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-shrink: 0;
}

.wt-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.wt-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

/* ── Form ───────────────────────────────────────────────── */
.wt-form {
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.wt-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wt-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
}

.wt-input,
.wt-select {
  height: 34px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--font-size-md);
  padding: 0 10px;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.wt-input:focus,
.wt-select:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.wt-form-actions {
  display: flex;
  gap: 8px;
}

/* ── Error ──────────────────────────────────────────────── */
.wt-error {
  margin: 12px 18px 0;
  padding: 8px 12px;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

/* ── Confirm dialog ─────────────────────────────────────── */
.wt-confirm {
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-danger-soft);
  flex-shrink: 0;
}

.wt-confirm p {
  margin: 0 0 10px;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.wt-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-bottom: 12px;
  cursor: pointer;
}

.wt-confirm-actions {
  display: flex;
  gap: 8px;
}

/* ── States ─────────────────────────────────────────────── */
.wt-state {
  padding: 32px 24px;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  text-align: center;
}

.wt-empty {
  line-height: 1.6;
}

/* ── List ───────────────────────────────────────────────── */
.wt-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wt-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-secondary);
  transition: border-color var(--transition-fast);
}

.wt-item:hover {
  border-color: var(--color-accent);
}

.wt-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.wt-item-badges {
  display: flex;
  gap: 4px;
  margin-bottom: 2px;
}

.badge {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  padding: 1px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-main {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.badge-locked {
  background: var(--color-warning-soft, rgba(234, 179, 8, 0.15));
  color: var(--color-warning, #ca8a04);
}

.badge-bare {
  background: var(--color-bg-hover);
  color: var(--color-text-muted);
}

.wt-item-branch {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 5px;
}

.branch-icon {
  color: var(--color-accent);
  font-size: 13px;
}

.wt-item-path {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-item-head {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.wt-item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Outline variant (reused from StashManager) ─────────── */
.btn-outline {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-outline:hover:not(:disabled) {
  background: var(--color-bg-hover);
  border-color: var(--color-text-muted);
}
</style>
