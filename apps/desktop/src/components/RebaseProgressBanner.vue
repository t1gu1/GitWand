<script setup lang="ts">
/**
 * RebaseProgressModal — shown as a centred modal when a plain rebase
 * (e.g. from `git pull --rebase`) is paused due to conflicts.
 *
 * Distinct from the interactive RebaseEditor: this handles the simpler
 * case where the user just needs Continue / Skip / Abort.
 *
 * Design mirrors MergeSuccessModal (BaseModal sm, hide-header, bm-btn).
 */
import { ref, computed } from "vue";
import type { RepoOperationState } from "../utils/backend";
import { t } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const props = defineProps<{
  repoState: RepoOperationState;
  cwd: string;
}>();

const emit = defineEmits<{
  (e: "action-done"): void;
  (e: "error", msg: string): void;
}>();

const busy = ref(false);

const shortHead = computed(() =>
  props.repoState.operationHead
    ? props.repoState.operationHead.slice(0, 7)
    : ""
);

const stepLabel = computed(() => {
  if (props.repoState.step && props.repoState.total)
    return `${props.repoState.step} / ${props.repoState.total}`;
  return "";
});

async function runAction(action: "continue" | "abort" | "skip") {
  if (busy.value) return;
  busy.value = true;
  try {
    const { gitRebaseAction } = await import("../utils/backend");
    await gitRebaseAction(props.cwd, action);
    emit("action-done");
  } catch (err: any) {
    emit("error", err?.message ?? String(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseModal size="sm" hide-header :aria-label="t('rebase.bannerTitle')" @close="runAction('abort')">
    <div class="rpm-body">
      <!-- Icon -->
      <div class="rpm-icon" :class="{ 'rpm-icon--conflict': repoState.hasConflict }">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <circle cx="24" cy="24" r="24" />
          <!-- rebase arrows -->
          <path d="M17 12v6a4 4 0 0 0 4 4h6m0 0-3-3m3 3-3 3" stroke-width="2.5" stroke-linecap="round"
            stroke-linejoin="round" />
          <path d="M31 36v-6a4 4 0 0 0-4-4h-6m0 0 3 3m-3-3 3-3" stroke-width="2.5" stroke-linecap="round"
            stroke-linejoin="round" />
        </svg>
      </div>

      <h2 class="rpm-title">{{ t('rebase.bannerTitle') }}</h2>

      <!-- Meta: commit + step -->
      <p class="rpm-meta" v-if="shortHead || stepLabel">
        <code v-if="shortHead">{{ shortHead }}</code>
        <span v-if="repoState.targetBranch">→ <strong>{{ repoState.targetBranch }}</strong></span>
        <span v-if="stepLabel" class="rpm-step">{{ stepLabel }}</span>
      </p>

      <!-- Status hint -->
      <p v-if="repoState.hasConflict" class="rpm-hint rpm-hint--conflict">
        {{ t('rebase.bannerConflictHint') }}
      </p>
      <p v-else class="rpm-hint rpm-hint--ready">
        {{ t('rebase.bannerReadyHint') }}
      </p>
    </div>

    <template #footer>
      <!-- Abort (left-aligned ghost-danger) -->
      <button class="bm-btn bm-btn--ghost bm-btn--danger rpm-btn-abort" :disabled="busy" @click="runAction('abort')">
        {{ t('rebase.abort') }}
      </button>

      <!-- Skip -->
      <button class="bm-btn bm-btn--ghost" :disabled="busy" @click="runAction('skip')">
        {{ t('rebase.skip') }}
      </button>

      <!-- Continue (primary, disabled while conflicts remain) -->
      <button class="bm-btn bm-btn--primary" :disabled="busy || repoState.hasConflict"
        :title="repoState.hasConflict ? t('rebase.bannerConflictHint') : t('rebase.continue')"
        @click="runAction('continue')">
        <span v-if="busy" class="rpm-spinner" aria-hidden="true" />
        {{ t('rebase.continue') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
/* ── Body ────────────────────────────────────────────────────────────── */
.rpm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-3) var(--space-2);
}

/* ── Icon ────────────────────────────────────────────────────────────── */
.rpm-icon svg circle {
  fill: var(--color-success-soft);
}

.rpm-icon svg path {
  stroke: var(--color-success);
}

.rpm-icon--conflict svg circle {
  fill: rgba(243, 139, 168, 0.12);
}

.rpm-icon--conflict svg path {
  stroke: var(--gw-red, #f38ba8);
}

/* ── Text ────────────────────────────────────────────────────────────── */
.rpm-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.rpm-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  flex-wrap: wrap;
  justify-content: center;
}

.rpm-meta code {
  font-family: var(--gw-font-mono, monospace);
  background: var(--color-bg-tertiary, #313244);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: var(--font-size-xs);
}

.rpm-step {
  background: var(--color-bg-tertiary, #313244);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: var(--font-size-xs);
}

.rpm-hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-normal);
}

.rpm-hint--conflict {
  color: var(--gw-red, #f38ba8);
}

.rpm-hint--ready {
  color: var(--color-success, #a6e3a1);
}

/* ── Footer overrides ────────────────────────────────────────────────── */
.rpm-btn-abort {
  margin-right: auto;
  /* push skip + continue to the right */
}

/* ── Spinner ─────────────────────────────────────────────────────────── */
.rpm-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: rpm-spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes rpm-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
