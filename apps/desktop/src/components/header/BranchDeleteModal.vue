<script setup lang="ts">
/**
 * BranchDeleteModal — destructive-action dialog with type-the-name guard.
 *
 * Built on BaseModal. Keeps its own Enter handling (confirm). BaseModal
 * supplies Escape / backdrop / chrome.
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "../../composables/useI18n";
import BaseModal from "../BaseModal.vue";

const props = defineProps<{
  /** Name of the branch being deleted. The guard matches against this. */
  branchName: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [name: string];
}>();

const { t } = useI18n();

const typed = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

/** Case-sensitive match against the full branch name. */
const canConfirm = computed(() => typed.value === props.branchName);

const warning = computed(() =>
  t("branchMenu.deleteModalWarning").replace("{0}", props.branchName),
);

const placeholder = computed(() =>
  t("branchMenu.deleteModalGuardPlaceholder").replace("{0}", props.branchName),
);

function onConfirm() {
  if (!canConfirm.value) return;
  emit("confirm", props.branchName);
  emit("close");
}

function onCancel() {
  emit("close");
}

onMounted(() => {
  nextTick(() => inputEl.value?.focus());
});
</script>

<template>
  <BaseModal
    size="sm"
    role="alertdialog"
    :title="t('branchMenu.deleteModalTitle')"
    @close="onCancel"
  >
    <template #title-icon>
      <span class="bdm-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3L22 20H2L12 3z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
          <path d="M12 10v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="12" cy="17.5" r="1" fill="currentColor" />
        </svg>
      </span>
    </template>

    <form class="bdm-form" @submit.prevent="onConfirm">
      <p class="bdm-warning">{{ warning }}</p>

      <label class="bdm-label">
        {{ t('branchMenu.deleteModalGuardLabel') }}
        <input
          ref="inputEl"
          v-model="typed"
          type="text"
          class="bdm-input mono"
          :placeholder="placeholder"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <button type="submit" hidden></button>
    </form>

    <template #footer>
      <button type="button" class="bm-btn bm-btn--ghost" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="bm-btn bm-btn--danger"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        {{ t('branchMenu.deleteModalConfirm') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.bdm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--color-danger-soft, rgba(220, 38, 38, 0.14));
  color: var(--color-danger, #dc2626);
  flex-shrink: 0;
}

.bdm-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.bdm-warning {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  line-height: var(--line-height-relaxed, 1.55);
}

.bdm-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.bdm-input {
  padding: var(--space-3) var(--space-5);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text);
  font-size: var(--font-size-md);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.bdm-input:focus {
  border-color: var(--color-danger, #dc2626);
  box-shadow: 0 0 0 3px var(--color-danger-soft, rgba(220, 38, 38, 0.18));
}
</style>
