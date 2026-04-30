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
import BaseModal from "./BaseModal.vue";

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
  <BaseModal
    :title="t('worktree.title')"
    size="lg"
    scroll-own
    body-flush
    @close="emit('close')"
  >
    <!-- Title icon -->
    <template #title-icon>
      <div class="wt-modal-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M17.5 17.5h.01M14 17.5h3.5M17.5 14v3.5" />
        </svg>
      </div>
    </template>

    <!-- Header action buttons -->
    <template #header-actions>
      <button
        type="button"
        class="bm-btn bm-btn--ghost"
        :title="t('worktree.pruneTooltip')"
        @click="prune"
      >
        {{ t("worktree.prune") }}
      </button>
      <button
        type="button"
        class="bm-btn bm-btn--primary"
        @click="showForm = !showForm"
      >
        + {{ t("worktree.newWorktree") }}
      </button>
    </template>

    <!-- Body -->
    <div class="wt-body">
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
            class="bm-btn bm-btn--primary"
            :disabled="creating || !formPath.trim() || !formBranch.trim()"
            @click="createWorktree"
          >
            {{ creating ? t("worktree.creating") : t("worktree.create") }}
          </button>
          <button class="bm-btn bm-btn--ghost" @click="showForm = false">
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
            class="bm-btn bm-btn--danger"
            :disabled="removing"
            @click="confirmRemove"
          >
            {{ removing ? t("worktree.removing") : t("common.delete") }}
          </button>
          <button class="bm-btn bm-btn--ghost" @click="cancelRemove">{{ t("common.cancel") }}</button>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="wt-state">{{ t("common.loading") }}</div>

      <!-- Empty -->
      <div v-else-if="!loading && worktrees.length === 0" class="wt-state">
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
              <svg class="wt-branch-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="5" cy="3" r="1.5" />
                <circle cx="5" cy="13" r="1.5" />
                <circle cx="11" cy="6" r="1.5" />
                <path d="M5 4.5v7M5 4.5C5 7 11 7.5 11 6" />
              </svg>
              {{ wt.branch || t("worktree.detached") }}
            </div>
            <div class="wt-item-path" :title="wt.path">{{ shortPath(wt.path) }}</div>
            <div v-if="wt.head" class="wt-item-head">{{ wt.head.slice(0, 7) }}</div>
          </div>
          <div class="wt-item-actions">
            <button
              class="bm-btn bm-btn--ghost"
              @click="emit('open-tab', wt.path)"
            >
              {{ t("worktree.openInTab") }}
            </button>
            <button
              v-if="!wt.is_main"
              class="bm-btn bm-btn--danger"
              @click="requestRemove(wt.path)"
            >
              {{ t("worktree.remove") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
/* ── Modal icon ─────────────────────────────────────────── */
.wt-modal-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  flex-shrink: 0;
}

/* ── Body container ─────────────────────────────────────── */
.wt-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Form ───────────────────────────────────────────────── */
.wt-form {
  padding: var(--space-5) var(--space-7);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex-shrink: 0;
}

.wt-form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.wt-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
}

.wt-input,
.wt-select {
  height: 34px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--font-size-md);
  padding: 0 var(--space-4);
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
  gap: var(--space-3);
}

/* ── Error ──────────────────────────────────────────────── */
.wt-error {
  margin: var(--space-4) var(--space-7) 0;
  padding: var(--space-3) var(--space-4);
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

/* ── Confirm dialog ─────────────────────────────────────── */
.wt-confirm {
  padding: var(--space-5) var(--space-7);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-danger-soft);
  flex-shrink: 0;
}

.wt-confirm p {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.wt-checkbox-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
  cursor: pointer;
}

.wt-confirm-actions {
  display: flex;
  gap: var(--space-3);
}

/* ── States ─────────────────────────────────────────────── */
.wt-state {
  padding: var(--space-10) var(--space-7);
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  text-align: center;
}

/* ── List ───────────────────────────────────────────────── */
.wt-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5) var(--space-7) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.wt-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.wt-item:hover {
  border-color: var(--color-accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.wt-item-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.wt-item-badges {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.badge {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  padding: 2px var(--space-3);
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.badge-main   { background: var(--color-accent-soft); color: var(--color-accent); }
.badge-locked { background: var(--color-warning-soft, rgba(234,179,8,0.15)); color: var(--color-warning, #ca8a04); }
.badge-bare   { background: var(--color-bg-tertiary); color: var(--color-text-muted); }

.wt-item-branch {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.wt-branch-icon { color: var(--color-accent); flex-shrink: 0; }

.wt-item-path {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wt-item-head {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.wt-item-actions {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
}
</style>
