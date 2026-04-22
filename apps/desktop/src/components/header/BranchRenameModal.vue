<script setup lang="ts">
/**
 * BranchRenameModal — rename the current branch.
 *
 * Replaces the old inline-rename panel that lived inside BranchMenu's
 * dropdown. A proper modal is a better fit here: the action is
 * semi-destructive (can break upstream tracking) and benefits from a
 * clearly bounded dialog with its own focus trap rather than something
 * nested in a popover the user was already interacting with.
 *
 * Contract
 * ────────
 *   - Parent opens the modal by mounting the component (`v-if`).
 *   - The input is prefilled with `currentBranch` and selected on mount,
 *     so the typical "append a suffix" / "fix a typo" rename is one
 *     edit + Enter away.
 *   - `confirm` fires with `(oldName, newName)` — the modal never calls
 *     into git directly.
 *   - Enter confirms (when valid), Escape cancels.
 *
 * Validation
 * ──────────
 * The confirm button is disabled when:
 *   - The new name is empty (after trim), OR
 *   - The new name equals the current branch (no-op rename).
 *
 * Git itself will reject invalid names (spaces, control chars, `..`,
 * etc.) — replicating that here would mean maintaining a second copy of
 * git's rules, so we lean on the backend's error surface instead.
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "../../composables/useI18n";

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
  // Select the existing name so the user can immediately start typing
  // a replacement (overwrites) OR tweak the end (arrow keys deselect).
  nextTick(() => {
    const el = inputEl.value;
    if (!el) return;
    el.focus();
    el.select();
  });
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay-backdrop rename-overlay" @click.self="onCancel">
      <div
        class="rename-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('branchMenu.renamePromptTitle')"
        @keydown.escape.stop.prevent="onCancel"
        @keydown.enter.prevent="onConfirm"
      >
        <h3 class="rename-title">{{ t('branchMenu.renamePromptTitle') }}</h3>
        <p class="rename-label">{{ label }}</p>
        <input
          ref="inputEl"
          v-model="newName"
          type="text"
          class="rename-input mono"
          :placeholder="t('branchMenu.renamePlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="rename-actions">
          <button type="button" class="btn btn--ghost" @click="onCancel">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="!canConfirm"
            @click="onConfirm"
          >
            {{ t('branchMenu.renameModalConfirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rename-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  /* backdrop tint + blur from the global .overlay-backdrop class */
}

.rename-modal {
  width: min(460px, 100%);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal, 0 20px 60px rgba(0, 0, 0, 0.45));
  padding: var(--space-6) var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: modalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.rename-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.rename-label {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-snug);
}

.rename-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-md);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.rename-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
</style>
