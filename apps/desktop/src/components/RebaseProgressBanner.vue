<script setup lang="ts">
/**
 * RebaseProgressBanner — sticky banner shown when a plain rebase (e.g. from
 * `git pull --rebase`) is paused due to conflicts.
 *
 * Distinct from the interactive RebaseEditor: this handles the simpler case
 * of a non-interactive rebase where the user just needs Continue / Skip / Abort.
 */
import { ref, computed } from "vue";
import type { RepoOperationState } from "../utils/backend";
import { t } from "../composables/useI18n";

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
    return `(${props.repoState.step}/${props.repoState.total})`;
  return "";
});

const canContinue = computed(() => !props.repoState.hasConflict);

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
  <div class="rpb" role="status" aria-live="polite">
    <!-- Icon -->
    <svg class="rpb__icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" aria-hidden="true">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>

    <!-- Label -->
    <div class="rpb__text">
      <span class="rpb__title">{{ t('rebase.bannerTitle') }}</span>
      <span v-if="shortHead || stepLabel" class="rpb__meta">
        <code v-if="shortHead">{{ shortHead }}</code>
        <span v-if="stepLabel">{{ stepLabel }}</span>
        <span v-if="repoState.targetBranch">→ {{ repoState.targetBranch }}</span>
      </span>
      <span v-if="repoState.hasConflict" class="rpb__hint">
        {{ t('rebase.bannerConflictHint') }}
      </span>
      <span v-else class="rpb__hint rpb__hint--ready">
        {{ t('rebase.bannerReadyHint') }}
      </span>
    </div>

    <!-- Actions -->
    <div class="rpb__actions">
      <button
        class="rpb__btn rpb__btn--primary"
        :disabled="busy || repoState.hasConflict"
        :title="repoState.hasConflict ? t('rebase.bannerConflictHint') : t('rebase.continue')"
        @click="runAction('continue')"
      >
        <span v-if="busy" class="rpb__spinner" aria-hidden="true"/>
        {{ t('rebase.continue') }}
      </button>
      <button
        class="rpb__btn"
        :disabled="busy"
        :title="t('rebase.skip')"
        @click="runAction('skip')"
      >
        {{ t('rebase.skip') }}
      </button>
      <button
        class="rpb__btn rpb__btn--danger"
        :disabled="busy"
        :title="t('rebase.abort')"
        @click="runAction('abort')"
      >
        {{ t('rebase.abort') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.rpb {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--gw-bg-secondary, #1e1e2e);
  border-bottom: 1px solid var(--gw-border, #333);
  border-left: 3px solid var(--gw-yellow, #f9e2af);
  font-size: 12px;
  flex-shrink: 0;
}

.rpb__icon {
  color: var(--gw-yellow, #f9e2af);
  flex-shrink: 0;
}

.rpb__text {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.rpb__title {
  font-weight: 600;
  color: var(--gw-fg, #cdd6f4);
  white-space: nowrap;
}

.rpb__meta {
  display: flex;
  align-items: baseline;
  gap: 4px;
  color: var(--gw-fg-muted, #7f849c);
}

.rpb__meta code {
  font-family: var(--gw-font-mono, monospace);
  background: var(--gw-bg-tertiary, #313244);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 11px;
}

.rpb__hint {
  color: var(--gw-fg-muted, #7f849c);
  font-style: italic;
}

.rpb__hint--ready {
  color: var(--gw-green, #a6e3a1);
}

.rpb__actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.rpb__btn {
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--gw-border, #444);
  background: var(--gw-bg-tertiary, #313244);
  color: var(--gw-fg, #cdd6f4);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s, opacity 0.15s;
}
.rpb__btn:hover:not(:disabled) {
  background: var(--gw-bg-hover, #45475a);
}
.rpb__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rpb__btn--primary {
  background: var(--gw-purple, #7c3aed);
  border-color: var(--gw-purple, #7c3aed);
  color: #fff;
  font-weight: 600;
}
.rpb__btn--primary:hover:not(:disabled) {
  background: var(--gw-purple-hover, #6d28d9);
}

.rpb__btn--danger {
  color: var(--gw-red, #f38ba8);
}
.rpb__btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--gw-red, #f38ba8) 12%, var(--gw-bg-tertiary, #313244));
}

.rpb__spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: rpb-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes rpb-spin {
  to { transform: rotate(360deg); }
}
</style>
