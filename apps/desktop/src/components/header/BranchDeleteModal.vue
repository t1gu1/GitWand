<script setup lang="ts">
/**
 * BranchDeleteModal — destructive-action dialog with type-the-name guard.
 *
 * Why the guard
 * ─────────────
 * `git branch -d` refuses to delete a branch with unmerged work — but the
 * user asked for a defence-in-depth step before we even reach that check.
 * Typing the branch name is the pattern popularised by GitHub's "delete
 * repository" dialog: it's impossible to trigger by a stray click and it
 * forces the user to read the warning copy at least once. Compared to a
 * checkbox it's ~2s more friction and effectively zero false positives.
 *
 * Behaviour
 * ─────────
 *   - Parent mounts the modal via `v-if`. We take the branch name as a
 *     prop and never touch git directly — `confirm` emits the name and
 *     the parent's handler runs `deleteBranch`.
 *   - The confirm button is disabled until the typed input matches the
 *     branch name EXACTLY (case-sensitive — git branch names are
 *     case-sensitive on every filesystem we care about).
 *   - Escape cancels. Enter confirms when the guard passes. Clicking
 *     outside the panel cancels too.
 *
 * The backend call uses force=false, so git will still refuse unmerged
 * deletes even after the guard passes — the guard just stops the
 * easy mistakes, not a force-delete.
 */
import { ref, computed, onMounted, nextTick } from "vue";
import { useI18n } from "../../composables/useI18n";

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

/**
 * Case-sensitive match against the full branch name. Git allows names
 * that differ only by case (on case-sensitive filesystems), so a
 * lowercase compare would be wrong — we'd let `Main` pass as a confirm
 * for `main`.
 */
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
  // Focus the guard field so the user can start typing immediately —
  // we intentionally do NOT select anything (no prefilled content to
  // select, and we don't want to auto-accept a suggestion).
  nextTick(() => inputEl.value?.focus());
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay-backdrop delete-overlay" @click.self="onCancel">
      <div
        class="delete-modal"
        role="alertdialog"
        aria-modal="true"
        :aria-label="t('branchMenu.deleteModalTitle')"
        @keydown.escape.stop.prevent="onCancel"
        @keydown.enter.prevent="onConfirm"
      >
        <!-- Warning icon — signals the destructive nature before the user
             even reads the copy. -->
        <div class="delete-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3L22 20H2L12 3z"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
            <path d="M12 10v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="12" cy="17.5" r="1" fill="currentColor" />
          </svg>
        </div>

        <h3 class="delete-title">{{ t('branchMenu.deleteModalTitle') }}</h3>
        <p class="delete-warning">{{ warning }}</p>

        <label class="delete-guard-label">
          {{ t('branchMenu.deleteModalGuardLabel') }}
          <input
            ref="inputEl"
            v-model="typed"
            type="text"
            class="delete-guard-input mono"
            :placeholder="placeholder"
            autocomplete="off"
            spellcheck="false"
          />
        </label>

        <div class="delete-actions">
          <button type="button" class="btn btn--ghost" @click="onCancel">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn--danger"
            :disabled="!canConfirm"
            @click="onConfirm"
          >
            {{ t('branchMenu.deleteModalConfirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.delete-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  /* backdrop tint + blur from global .overlay-backdrop */
}

.delete-modal {
  width: min(460px, 100%);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal, 0 20px 60px rgba(0, 0, 0, 0.45));
  padding: var(--space-7) var(--space-7) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: modalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalIn {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.delete-icon {
  color: var(--color-danger, #d03a3a);
  display: flex;
  justify-content: center;
}

.delete-title {
  margin: 0;
  text-align: center;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.delete-warning {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  line-height: var(--line-height-relaxed, 1.55);
  text-align: center;
}

.delete-guard-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.delete-guard-input {
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-md);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.delete-guard-input:focus {
  border-color: var(--color-danger, #d03a3a);
  box-shadow: 0 0 0 3px var(--color-danger-soft, rgba(208, 58, 58, 0.18));
}

.delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

/* Local danger-button styling — the shared .btn--danger may not exist
   yet in main.css; we define it here so the modal is self-sufficient
   and looks right regardless of global-style drift. */
.btn--danger {
  background: var(--color-danger, #d03a3a);
  color: #fff;
  border: 1px solid var(--color-danger, #d03a3a);
}
.btn--danger:hover:not(:disabled) {
  filter: brightness(1.07);
}
.btn--danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
