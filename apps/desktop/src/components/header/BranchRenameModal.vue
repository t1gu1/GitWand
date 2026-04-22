<script setup lang="ts">
/**
 * BranchRenameModal — rename the current branch.
 *
 * Form-style modal built on top of `BaseModal`. Keeps its own Enter handling
 * (confirm) while BaseModal takes care of Escape / backdrop / overlay chrome.
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "../../composables/useI18n";
import BaseModal from "../BaseModal.vue";

const props = defineProps<{
  /** Name of the branch being renamed. */
  currentBranch: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [oldName: string, newName: string];
}>();

const { t } = useI18n();

const newName = ref(props.currentBranch);
const inputEl = ref<HTMLInputElement | null>(null);

const trimmed = computed(() => newName.value.trim());
const canConfirm = computed(
  () => trimmed.value.length > 0 && trimmed.value !== props.currentBranch,
);

/** Formatted label with the current branch substituted in. */
const label = computed(() =>
  t("branchMenu.renamePromptLabel").replace("{0}", props.currentBranch),
);

function onConfirm() {
  if (!canConfirm.value) return;
  emit("confirm", props.currentBranch, trimmed.value);
  emit("close");
}

function onCancel() {
  emit("close");
}

onMounted(() => {
  nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    el.focus();
    el.select();
  });
});
</script>

<template>
  <BaseModal
    size="sm"
    :title="t('branchMenu.renamePromptTitle')"
    @close="onCancel"
  >
    <template #title-icon>
      <span class="brm-icon" aria-hidden="true">
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

    <form
      class="brm-form"
      @submit.prevent="onConfirm"
    >
      <label class="brm-label" for="brm-input">{{ label }}</label>
      <input
        id="brm-input"
        ref="inputEl"
        v-model="newName"
        type="text"
        class="brm-input mono"
        :placeholder="t('branchMenu.renamePlaceholder')"
        autocomplete="off"
        spellcheck="false"
      />
      <!-- Hidden submit so Enter works inside the form -->
      <button type="submit" hidden></button>
    </form>

    <template #footer>
      <button type="button" class="bm-btn bm-btn--ghost" @click="onCancel">
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="bm-btn bm-btn--primary"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        {{ t('branchMenu.renameModalConfirm') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.brm-icon {
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

.brm-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.brm-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-snug);
}

.brm-input {
  width: 100%;
  padding: var(--space-3) var(--space-5);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text);
  font-size: var(--font-size-md);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.brm-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
</style>
