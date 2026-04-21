<script setup lang="ts">
/**
 * SplitCommitModal.vue
 *
 * Modal that drives the "split a commit into two" workflow. See
 * `composables/useSplitCommit.ts` for the orchestration logic — this
 * component is purely presentational:
 *   - renders each file of the commit's diff via DiffViewer (selectable)
 *   - tracks per-file hunk/line selections
 *   - collects two commit messages (A empty, B pre-filled from the original)
 *   - on confirm, delegates to the composable's `confirm()` action
 *
 * The working tree must be clean; the backend (`git_split_commit`) enforces
 * this precondition and surfaces a user-facing error otherwise.
 */
import { ref, computed, watch } from "vue";
import DiffViewer from "./DiffViewer.vue";
import { useI18n } from "../composables/useI18n";
import { useSplitCommit, type FileSelections } from "../composables/useSplitCommit";
import type { LineSelection } from "../utils/patchBuilder";
import type { DiffMode } from "../utils/diffMode";

const { t } = useI18n();
const split = useSplitCommit();

const emit = defineEmits<{
  /** Emitted after a successful split. Parent should refresh the commit log. */
  (e: "split-completed", hashes: { firstHash: string; secondHash: string }): void;
  /** Emitted when the user cancels or closes the modal. */
  (e: "close"): void;
}>();

// ─── Per-file selection state ───────────────────────────────
/**
 * fileSelections tracks the user's per-file hunk/line picks. DiffViewer
 * owns its selection internally and emits `selection-change` on every
 * toggle; we mirror the payload here keyed by file path so we can build
 * the combined first-patch on confirm.
 */
const fileSelections = ref<FileSelections>(new Map());

function onSelectionChange(path: string, selection: LineSelection) {
  const next = new Map(fileSelections.value);
  if (selection.size === 0) next.delete(path);
  else next.set(path, selection);
  fileSelections.value = next;
}

// Clear selections whenever a new commit is opened in the modal.
watch(
  () => split.commit.value?.hash,
  () => {
    fileSelections.value = new Map();
  },
);

// ─── Commit messages ────────────────────────────────────────
const firstMessage = ref("");
const secondMessage = ref("");

// Pre-fill the second message with the original commit's subject+body
// whenever the modal opens for a new commit.
watch(
  () => split.originalMessage.value,
  (msg) => {
    secondMessage.value = msg;
    firstMessage.value = "";
  },
);

// ─── Per-DiffViewer diff mode (preserves user's toggle per file) ────
const diffModes = ref<Map<string, DiffMode>>(new Map());
function diffModeFor(path: string): DiffMode {
  return diffModes.value.get(path) ?? "inline";
}
function setDiffMode(path: string, mode: DiffMode) {
  const next = new Map(diffModes.value);
  next.set(path, mode);
  diffModes.value = next;
}

// ─── Derived state ──────────────────────────────────────────
/** Total change lines across all files. */
const totalChangeLines = computed(() => {
  let total = 0;
  for (const d of split.diffs.value) {
    for (const h of d.hunks) {
      for (const l of h.lines) {
        if (l.type !== "context") total++;
      }
    }
  }
  return total;
});

/** Selected change lines across all files. */
const selectedChangeLines = computed(() => {
  let selected = 0;
  for (const d of split.diffs.value) {
    const sel = fileSelections.value.get(d.path);
    if (!sel) continue;
    for (const lines of sel.values()) selected += lines.size;
  }
  return selected;
});

const remainingChangeLines = computed(
  () => totalChangeLines.value - selectedChangeLines.value,
);

/**
 * Split is only legal when:
 *  - Both commits would be non-empty (at least 1 selected, at least 1 remaining)
 *  - Both messages are non-empty
 *  - Not currently busy
 */
const canConfirm = computed(() => {
  if (split.busy.value) return false;
  if (!firstMessage.value.trim()) return false;
  if (!secondMessage.value.trim()) return false;
  if (selectedChangeLines.value === 0) return false;
  if (remainingChangeLines.value === 0) return false;
  return true;
});

// ─── Actions ─────────────────────────────────────────────────
async function handleConfirm() {
  if (!canConfirm.value) return;
  try {
    const result = await split.confirm(
      fileSelections.value,
      firstMessage.value.trim(),
      secondMessage.value.trim(),
    );
    emit("split-completed", result);
  } catch {
    // error is surfaced via split.error; keep modal open
  }
}

function handleCancel() {
  split.cancel();
  emit("close");
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") handleCancel();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="split.open.value"
      class="scm-overlay"
      @click.self="handleCancel"
      @keydown="handleKeydown"
    >
      <div
        class="scm-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('splitCommit.modalAria')"
      >
        <!-- Header -->
        <div class="scm-header">
          <div class="scm-header-main">
            <span class="scm-title">{{ t('splitCommit.title') }}</span>
            <span v-if="split.commit.value" class="scm-subtitle">
              <code>{{ split.commit.value.hash.slice(0, 7) }}</code>
              — {{ split.commit.value.message }}
            </span>
          </div>
          <button
            class="scm-close"
            type="button"
            :title="t('splitCommit.close')"
            @click="handleCancel"
          >✕</button>
        </div>

        <!-- Hint banner -->
        <div class="scm-hint">
          <span class="scm-hint-icon">✂️</span>
          <span>{{ t('splitCommit.hint') }}</span>
        </div>

        <!-- Loading / error states -->
        <div v-if="split.loading.value && split.diffs.value.length === 0" class="scm-loading">
          {{ t('splitCommit.loading') }}
        </div>
        <div v-else-if="split.error.value" class="scm-error">
          <strong>{{ t('splitCommit.errorTitle') }}</strong>
          <pre>{{ split.error.value }}</pre>
        </div>

        <!-- Diffs (one DiffViewer per file, with selection) -->
        <div v-if="split.diffs.value.length > 0" class="scm-diffs">
          <div
            v-for="diff in split.diffs.value"
            :key="diff.path"
            class="scm-file"
          >
            <DiffViewer
              :diff="diff"
              :file-path="diff.path"
              :diff-mode="diffModeFor(diff.path)"
              :selectable="true"
              @update:diff-mode="(m) => setDiffMode(diff.path, m)"
              @selection-change="(sel) => onSelectionChange(diff.path, sel)"
            />
          </div>
        </div>

        <!-- Messages -->
        <div class="scm-messages">
          <div class="scm-message">
            <label class="scm-label">
              {{ t('splitCommit.firstMessageLabel') }}
              <span class="scm-required">*</span>
            </label>
            <p class="scm-label-hint">{{ t('splitCommit.firstMessageHint') }}</p>
            <textarea
              v-model="firstMessage"
              class="scm-textarea"
              :placeholder="t('splitCommit.firstMessagePlaceholder')"
              rows="3"
            />
          </div>

          <div class="scm-message">
            <label class="scm-label">
              {{ t('splitCommit.secondMessageLabel') }}
              <span class="scm-required">*</span>
            </label>
            <p class="scm-label-hint">{{ t('splitCommit.secondMessageHint') }}</p>
            <textarea
              v-model="secondMessage"
              class="scm-textarea"
              :placeholder="t('splitCommit.secondMessagePlaceholder')"
              rows="3"
            />
          </div>
        </div>

        <!-- Footer -->
        <div class="scm-footer">
          <div class="scm-stats">
            <span class="scm-stat">
              <strong>{{ selectedChangeLines }}</strong>
              / {{ totalChangeLines }} {{ t('splitCommit.linesSelectedForA') }}
            </span>
            <span
              v-if="remainingChangeLines === 0 && selectedChangeLines > 0"
              class="scm-warn"
            >{{ t('splitCommit.warnAllSelected') }}</span>
          </div>
          <div class="scm-actions">
            <button
              class="scm-btn scm-btn--ghost"
              type="button"
              :disabled="split.busy.value"
              @click="handleCancel"
            >{{ t('splitCommit.cancel') }}</button>
            <button
              class="scm-btn scm-btn--primary"
              type="button"
              :disabled="!canConfirm"
              @click="handleConfirm"
            >
              <span v-if="split.busy.value">{{ t('splitCommit.splitting') }}</span>
              <span v-else>✂️ {{ t('splitCommit.confirm') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 250;
}

.scm-modal {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  width: 960px;
  max-width: 95vw;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-xl);
}

.scm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
}

.scm-header-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.scm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.scm-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scm-subtitle code {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  background: var(--color-bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  color: var(--color-text);
}

.scm-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.scm-close:hover { color: var(--color-text); background: var(--color-bg-tertiary); }

.scm-hint {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 12px 16px 0;
  padding: 8px 12px;
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  font-size: 12px;
  color: var(--color-text);
  line-height: 1.5;
}

.scm-hint-icon { font-size: 14px; line-height: 1.4; }

.scm-loading, .scm-error {
  margin: 16px;
  padding: 14px;
  border-radius: 6px;
  font-size: 13px;
}

.scm-loading {
  color: var(--color-text-muted);
  text-align: center;
  font-style: italic;
}

.scm-error {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  border: 1px solid var(--color-danger);
  color: var(--color-text);
}

.scm-error pre {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.scm-diffs {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.scm-file {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.scm-messages {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-primary);
}

.scm-message { display: flex; flex-direction: column; gap: 4px; }

.scm-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: flex;
  gap: 6px;
  align-items: center;
}

.scm-required { color: var(--color-danger); }

.scm-label-hint {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  font-style: italic;
}

.scm-textarea {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.scm-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 30%, transparent);
}

.scm-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
}

.scm-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.scm-stat strong { color: var(--color-text); }

.scm-warn { color: var(--color-danger); font-weight: 500; }

.scm-actions { display: flex; gap: 8px; }

.scm-btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.scm-btn--ghost {
  background: transparent;
  color: var(--color-text);
  border-color: var(--color-border);
}
.scm-btn--ghost:hover:not(:disabled) { background: var(--color-bg-tertiary); }

.scm-btn--primary {
  background: var(--color-accent);
  color: var(--color-text-on-accent, #fff);
  border-color: var(--color-accent);
}
.scm-btn--primary:hover:not(:disabled) { filter: brightness(1.08); }

.scm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
