<script setup lang="ts">
/**
 * EditCommitOverlay — amend commit message dialog (summary + optional description).
 *
 * Built on BaseModal. Renders only while `entry` is non-null. The commit hash
 * is shown as a subtitle chip in the header via the `subtitle` prop.
 */
import { ref, watch } from "vue";
import type { GitLogEntry } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();

const props = defineProps<{
  entry: GitLogEntry | null;
}>();

const emit = defineEmits<{
  confirm: [summary: string, description: string];
  cancel: [];
}>();

const summary = ref("");
const description = ref("");
const summaryEl = ref<HTMLTextAreaElement | null>(null);

// Pré-remplir quand l'entrée change
watch(
  () => props.entry,
  (entry) => {
    if (!entry) return;
    summary.value = entry.message;
    description.value = entry.body
      ? entry.body.replace(/\\n/g, "\n").trim()
      : "";
    setTimeout(() => summaryEl.value?.focus(), 50);
  },
  { immediate: true },
);

function handleConfirm() {
  if (!summary.value.trim()) return;
  emit("confirm", summary.value, description.value);
}
</script>

<template>
  <BaseModal
    v-if="entry"
    size="md"
    :title="t('log.editMessage')"
    @close="emit('cancel')"
  >
    <template #title-icon>
      <span class="eco-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M14.06 4.94l3.75 3.75M3 21l3.4-.68a2 2 0 0 0 1.03-.55L20.5 6.69a2 2 0 0 0 0-2.83l-.7-.7a2 2 0 0 0-2.83 0L3.83 16.4a2 2 0 0 0-.55 1.03L3 21z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </template>

    <template #header-actions>
      <span class="eco-hash mono">{{ entry.hash }}</span>
    </template>

    <div class="eco-body">
      <label class="eco-label" for="eco-summary">{{ t('commit.summary') }}</label>
      <textarea
        id="eco-summary"
        ref="summaryEl"
        class="eco-input eco-input--summary mono"
        v-model="summary"
        rows="2"
        :placeholder="t('commit.summaryPlaceholder')"
        @keydown.ctrl.enter.prevent="handleConfirm"
        @keydown.meta.enter.prevent="handleConfirm"
      />

      <label class="eco-label eco-label--optional" for="eco-description">
        {{ t('commit.description') }}
        <span class="eco-label-hint">{{ t('common.optional') }}</span>
      </label>
      <textarea
        id="eco-description"
        class="eco-input eco-input--desc"
        v-model="description"
        rows="4"
        :placeholder="t('commit.descriptionPlaceholder')"
        @keydown.ctrl.enter.prevent="handleConfirm"
        @keydown.meta.enter.prevent="handleConfirm"
      />
    </div>

    <template #footer>
      <span class="eco-hint muted">{{ t('common.ctrlEnter') }}</span>
      <button class="bm-btn bm-btn--ghost" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
      <button
        class="bm-btn bm-btn--primary"
        :disabled="!summary.trim()"
        @click="handleConfirm"
      >
        {{ t('log.amendConfirm') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.eco-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  flex-shrink: 0;
}

.eco-hash {
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  background: var(--color-accent-soft, var(--color-bg));
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  align-self: center;
}

.eco-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.eco-label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.eco-label--optional {
  margin-top: var(--space-3);
}

.eco-label-hint {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.6;
}

.eco-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-md);
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  resize: none;
  line-height: 1.5;
  box-sizing: border-box;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  font-family: var(--font-sans);
}

.eco-input--summary {
  font-weight: 500;
}

.eco-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.eco-hint {
  font-size: var(--font-size-xs);
  margin-right: auto;
}
</style>
