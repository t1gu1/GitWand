<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();

const props = defineProps<{
  /** The branch that was just merged — offered for deletion as a cleanup step. */
  mergedBranch?: string;
}>();

/** Branches that must never be offered for deletion after a merge. */
const PROTECTED_BRANCHES = new Set([
  "master", "main", "develop", "dev", "trunk", "release", "production", "prod",
]);

/**
 * Returns true if the merged branch is a protected branch (main line branches
 * like master / main / develop). We never offer to delete these after a merge.
 */
const isProtectedBranch = computed(() => {
  if (!props.mergedBranch) return false;
  // Strip remote prefix (e.g. "origin/main" → "main")
  const local = props.mergedBranch.replace(/^[^/]+\//, "");
  return PROTECTED_BRANCHES.has(local.toLowerCase());
});

const emit = defineEmits<{
  close: [];
  push: [];
  deleteBranch: [branch: string, alsoRemote: boolean];
}>();

const pushing = ref(false);
const alsoDeleteRemote = ref(false);
const deleting = ref(false);

async function handlePush() {
  pushing.value = true;
  emit("push");
}

async function handleDeleteBranch() {
  if (!props.mergedBranch) return;
  deleting.value = true;
  emit("deleteBranch", props.mergedBranch, alsoDeleteRemote.value);
}
</script>

<template>
  <BaseModal
    size="sm"
    hide-header
    :aria-label="t('merge.successTitle')"
    @close="emit('close')"
  >
    <div class="msm-body">
      <div class="msm-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="24" />
          <path d="M15 24.5l6 6L33 18" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>

      <h2 class="msm-title">{{ t('merge.successTitle') }}</h2>
      <p class="msm-desc">{{ t('merge.successDesc') }}</p>
    </div>

    <!-- Branch cleanup offer — hidden for protected branches (master, main, develop…) -->
    <div v-if="mergedBranch && !isProtectedBranch" class="msm-cleanup">
      <label class="msm-cleanup-label">
        <input type="checkbox" v-model="alsoDeleteRemote" class="msm-cleanup-check" />
        <span>{{ t('merge.deleteAlsoRemote') }}</span>
      </label>
      <button
        class="bm-btn bm-btn--ghost msm-cleanup-btn"
        :disabled="deleting || pushing"
        @click="handleDeleteBranch"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {{ deleting ? t('common.loading') : t('merge.deleteMergedBranch', mergedBranch) }}
      </button>
    </div>

    <template #footer>
      <button class="bm-btn bm-btn--ghost" @click="emit('close')">
        {{ t('merge.successClose') }}
      </button>
      <button class="bm-btn bm-btn--primary" @click="handlePush" :disabled="pushing">
        <svg v-if="!pushing" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 12V3M4 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 14h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span v-if="pushing" class="msm-spinner"></span>
        {{ t('merge.successPush') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.msm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-2) var(--space-2);
}

.msm-icon svg circle { fill: var(--color-success-soft); }
.msm-icon svg path   { stroke: var(--color-success); }

.msm-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.msm-desc {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  line-height: var(--line-height-normal);
}

.msm-cleanup {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.msm-cleanup-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
}

.msm-cleanup-check {
  accent-color: var(--color-danger, #ef4444);
  cursor: pointer;
}

.msm-cleanup-btn {
  font-size: var(--font-size-sm);
  gap: var(--space-1);
  color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
  align-self: flex-start;
}

.msm-cleanup-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.06);
}

.msm-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: msm-spin 0.6s linear infinite;
}

@keyframes msm-spin {
  to { transform: rotate(360deg); }
}
</style>
