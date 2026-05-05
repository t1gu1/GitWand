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
 *
 * Built on BaseModal (xl size, body-flush so the diff list owns its own
 * scrolling).
 */
import { ref, computed, watch } from "vue";
import DiffViewer from "./DiffViewer.vue";
import { useI18n } from "../composables/useI18n";
import { useSplitCommit, type FileSelections } from "../composables/useSplitCommit";
import type { LineSelection } from "../utils/patchBuilder";
import type { DiffMode } from "../utils/diffMode";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();
const split = useSplitCommit();

const emit = defineEmits<{
  /** Emitted after a successful split. Parent should refresh the commit log. */
  (e: "split-completed", hashes: { firstHash: string; secondHash: string }): void;
  /** Emitted when the user cancels or closes the modal. */
  (e: "close"): void;
}>();

// ─── Per-file selection state ───────────────────────────────
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

watch(
  () => split.originalMessage.value,
  (msg) => {
    secondMessage.value = msg;
    firstMessage.value = "";
  },
);

// ─── Per-DiffViewer diff mode ───────────────────────────────
const diffModes = ref<Map<string, DiffMode>>(new Map());
function diffModeFor(path: string): DiffMode {
  return diffModes.value.get(path) ?? "inline";
}
function setDiffMode(path: string, mode: DiffMode) {
  const next = new Map(diffModes.value);
  next.set(path, mode);
  diffModes.value = next;
}

// ─── Per-file collapse/expand ────────────────────────────────
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

// ─── Per-file summary ─────────────────────────────────────────
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

function shortName(path: string): string {
  return path.split("/").pop() ?? path;
}

// ─── Derived state ──────────────────────────────────────────
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
</script>

<template>
  <BaseModal
    v-if="split.open.value"
    size="xl"
    :title="t('splitCommit.title')"
    :aria-label="t('splitCommit.modalAria')"
    body-flush
    @close="handleCancel"
  >
    <template #title-icon>
      <span class="scm-title-icon" aria-hidden="true">✂️</span>
    </template>

    <!-- Commit subtitle chip shown in header actions -->
    <template v-if="split.commit.value" #header-actions>
      <span class="scm-subtitle">
        <code class="mono">{{ split.commit.value.hash.slice(0, 7) }}</code>
        <span class="scm-subtitle-msg">{{ split.commit.value.message }}</span>
      </span>
    </template>

    <!-- Body: hint banner, diffs, and message textareas -->
    <div class="scm-body">
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

      <!-- Diffs: one collapsible row per file. -->
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
          <label class="scm-label" for="scm-first-message">
            {{ t('splitCommit.firstMessageLabel') }}
            <span class="scm-required">*</span>
          </label>
          <p class="scm-label-hint">{{ t('splitCommit.firstMessageHint') }}</p>
          <textarea
            id="scm-first-message"
            v-model="firstMessage"
            class="scm-textarea"
            :placeholder="t('splitCommit.firstMessagePlaceholder')"
            rows="3"
          />
        </div>

        <div class="scm-message">
          <label class="scm-label" for="scm-second-message">
            {{ t('splitCommit.secondMessageLabel') }}
            <span class="scm-required">*</span>
          </label>
          <p class="scm-label-hint">{{ t('splitCommit.secondMessageHint') }}</p>
          <textarea
            id="scm-second-message"
            v-model="secondMessage"
            class="scm-textarea"
            :placeholder="t('splitCommit.secondMessagePlaceholder')"
            rows="3"
          />
        </div>
      </div>
    </div>

    <!-- Footer: selection stats + action buttons -->
    <template #footer>
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
      <button
        class="bm-btn bm-btn--ghost"
        type="button"
        :disabled="split.busy.value"
        @click="handleCancel"
      >{{ t('splitCommit.cancel') }}</button>
      <button
        class="bm-btn bm-btn--primary"
        type="button"
        :disabled="!canConfirm"
        @click="handleConfirm"
      >
        <span v-if="split.busy.value">{{ t('splitCommit.splitting') }}</span>
        <span v-else>✂️ {{ t('splitCommit.confirm') }}</span>
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
/* ─── Title icon ──────────────────────────────────────────── */
.scm-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft, rgba(124, 58, 237, 0.14));
  font-size: 18px;
  flex-shrink: 0;
}

/* ─── Subtitle chip in header-actions ───────────────────── */
.scm-subtitle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  min-width: 0;
  max-width: 420px;
}
.scm-subtitle code {
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text);
  flex-shrink: 0;
}
.scm-subtitle-msg {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ─── Body wrapper ──────────────────────────────────────── */
.scm-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ─── Hint banner ───────────────────────────────────────── */
.scm-hint {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: var(--space-4) var(--space-7) 0;
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  line-height: 1.5;
}

.scm-hint-icon { font-size: 14px; line-height: 1.4; }

.scm-loading, .scm-error {
  margin: var(--space-4) var(--space-7);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
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
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ─── Diffs list (scrolls inside body) ──────────────────── */
.scm-diffs {
  flex: 1;
  overflow: auto;
  padding: var(--space-4) var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 200px;
}

.scm-file {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg);
  /*
   * In a flex column container, children shrink below their intrinsic
   * height when the total content exceeds available space. Without
   * `flex-shrink: 0`, many summary rows get compressed and the outer
   * scroll never engages.
   */
  flex-shrink: 0;
}

.scm-files-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.scm-files-count {
  font-variant-numeric: tabular-nums;
}

.scm-files-actions {
  display: flex;
  gap: var(--space-2);
}

.scm-toolbar-btn {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-2);
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.scm-toolbar-btn:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* ─── Summary row (click to expand) ───────────────────── */
.scm-file-summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-4);
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
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
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
  gap: var(--space-3);
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
  border-radius: var(--radius-pill);
}

/* DiffViewer height handling inside collapsible rows */
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

/* ─── Messages grid ─────────────────────────────────────── */
.scm-messages {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-7);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
}

.scm-message { display: flex; flex-direction: column; gap: 4px; }

.scm-label {
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
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
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.scm-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 30%, transparent);
}

/* ─── Footer stats ──────────────────────────────────────── */
.scm-stats {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  margin-right: auto;
}
.scm-stat strong { color: var(--color-text); }

.scm-warn { color: var(--color-danger); font-weight: 500; }
</style>
