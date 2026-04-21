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

// ─── Per-file collapse/expand (DiffViewer is only mounted when expanded) ────
/**
 * File rows start collapsed — on a 20-file commit, mounting 20 DiffViewer
 * instances at once is slow AND produces the "ghost row" layout bug where
 * each viewer's height:100% collapses in a vertical stack. Keeping most
 * files collapsed keeps the modal scannable and fast; the user expands
 * individual files to make their selection. Small commits (≤ 3 files)
 * auto-expand so the common case stays zero-click.
 */
const expandedFiles = ref<Set<string>>(new Set());
function isExpanded(path: string): boolean {
  return expandedFiles.value.has(path);
}
function toggleExpand(path: string): void {
  const next = new Set(expandedFiles.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  expandedFiles.value = next;
}
function expandAll(): void {
  expandedFiles.value = new Set(split.diffs.value.map((d) => d.path));
}
function collapseAll(): void {
  expandedFiles.value = new Set();
}

// Reset expand state + auto-expand small commits when a new commit is opened.
watch(
  () => split.diffs.value,
  (diffs) => {
    if (diffs.length > 0 && diffs.length <= 3) {
      expandedFiles.value = new Set(diffs.map((d) => d.path));
    } else {
      expandedFiles.value = new Set();
    }
  },
);

// ─── Per-file summary (for the collapsed row header) ─────────
interface FileSummary {
  additions: number;
  deletions: number;
  hunkCount: number;
  selectedLines: number;
  totalChangeLines: number;
}

function summaryFor(path: string): FileSummary {
  const diff = split.diffs.value.find((d) => d.path === path);
  if (!diff) {
    return { additions: 0, deletions: 0, hunkCount: 0, selectedLines: 0, totalChangeLines: 0 };
  }
  let additions = 0;
  let deletions = 0;
  let totalChangeLines = 0;
  for (const h of diff.hunks) {
    for (const l of h.lines) {
      if (l.type === "add") { additions++; totalChangeLines++; }
      else if (l.type === "delete") { deletions++; totalChangeLines++; }
    }
  }
  const sel = fileSelections.value.get(path);
  let selectedLines = 0;
  if (sel) for (const s of sel.values()) selectedLines += s.size;
  return { additions, deletions, hunkCount: diff.hunks.length, selectedLines, totalChangeLines };
}

/** Short file name for the summary row. */
function shortName(path: string): string {
  return path.split("/").pop() ?? path;
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

        <!-- Diffs: one collapsible row per file. DiffViewer is only mounted
             while a row is expanded to keep large commits (20+ files) fast
             and avoid the "ghost row" layout collapse when stacking many
             height:100% viewers vertically. -->
        <div v-if="split.diffs.value.length > 0" class="scm-diffs">
          <!-- Toolbar: expand/collapse all when > 3 files -->
          <div v-if="split.diffs.value.length > 3" class="scm-files-toolbar">
            <span class="scm-files-count">
              {{ t('splitCommit.filesCount', String(split.diffs.value.length)) }}
            </span>
            <div class="scm-files-actions">
              <button type="button" class="scm-toolbar-btn" @click="expandAll">
                {{ t('splitCommit.expandAll') }}
              </button>
              <button type="button" class="scm-toolbar-btn" @click="collapseAll">
                {{ t('splitCommit.collapseAll') }}
              </button>
            </div>
          </div>

          <div
            v-for="diff in split.diffs.value"
            :key="diff.path"
            class="scm-file"
            :class="{ 'scm-file--expanded': isExpanded(diff.path) }"
          >
            <!-- Summary row: always visible, min-height 44px, click to toggle -->
            <button
              type="button"
              class="scm-file-summary"
              :aria-expanded="isExpanded(diff.path) ? 'true' : 'false'"
              @click="toggleExpand(diff.path)"
            >
              <svg
                class="scm-file-chevron"
                :class="{ 'scm-file-chevron--open': isExpanded(diff.path) }"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="scm-file-name mono">{{ shortName(diff.path) }}</span>
              <span class="scm-file-path mono">{{ diff.path }}</span>
              <span class="scm-file-stats">
                <span v-if="summaryFor(diff.path).additions > 0" class="scm-stat-add">
                  +{{ summaryFor(diff.path).additions }}
                </span>
                <span v-if="summaryFor(diff.path).deletions > 0" class="scm-stat-del">
                  −{{ summaryFor(diff.path).deletions }}
                </span>
                <span class="scm-stat-hunks">
                  {{ t('splitCommit.hunksCount', String(summaryFor(diff.path).hunkCount)) }}
                </span>
                <span
                  v-if="summaryFor(diff.path).selectedLines > 0"
                  class="scm-stat-selected"
                >
                  {{ summaryFor(diff.path).selectedLines }}/{{ summaryFor(diff.path).totalChangeLines }}
                  {{ t('splitCommit.linesSelectedSuffix') }}
                </span>
              </span>
            </button>

            <DiffViewer
              v-if="isExpanded(diff.path)"
              :diff="diff"
              :file-path="diff.path"
              :diff-mode="diffModeFor(diff.path)"
              :selectable="true"
              :initial-selection="fileSelections.get(diff.path)"
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
  background: var(--color-bg-primary);
  /*
   * In a flex column container, children shrink below their intrinsic
   * height when the total content exceeds available space. Without
   * `flex-shrink: 0`, 17 summary rows get compressed to tiny strips
   * and the outer scroll never engages. Lock each row's height to its
   * natural content size and let .scm-diffs' overflow:auto handle it.
   */
  flex-shrink: 0;
}

.scm-files-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.scm-files-count {
  font-variant-numeric: tabular-nums;
}

.scm-files-actions {
  display: flex;
  gap: 8px;
}

.scm-toolbar-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.scm-toolbar-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* ─── Summary row (always visible, click to expand) ─── */
.scm-file-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 8px 12px;
  background: var(--color-bg-secondary);
  border: 0;
  cursor: pointer;
  text-align: left;
  color: var(--color-text);
}

.scm-file-summary:hover {
  background: var(--color-bg-tertiary);
}

.scm-file--expanded .scm-file-summary {
  border-bottom: 1px solid var(--color-border);
}

.scm-file-chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 120ms ease;
}

.scm-file-chevron--open {
  transform: rotate(90deg);
}

.scm-file-name {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.scm-file-path {
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.scm-file-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.scm-stat-add { color: var(--color-success, #2ea043); font-weight: 600; }
.scm-stat-del { color: var(--color-danger, #cf222e); font-weight: 600; }
.scm-stat-hunks { color: var(--color-text-muted); }
.scm-stat-selected {
  color: var(--color-accent, #8b5cf6);
  font-weight: 600;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--color-accent, #8b5cf6) 14%, transparent);
  border-radius: 10px;
}

/*
 * DiffViewer is designed for a fixed-height container (full-app panel):
 * its root uses `height: 100%` and its body uses `flex: 1; overflow: hidden`.
 * Inside the expanded .scm-file row those rules collapse the body to 0px.
 * Give it an intrinsic height capped at 480px with internal scroll.
 */
.scm-file :deep(.diff-viewer) {
  height: auto;
}

.scm-file :deep(.diff-body) {
  flex: 0 1 auto;
  overflow: visible;
}

.scm-file :deep(.diff-content) {
  max-height: 480px;
  overflow-y: auto;
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
