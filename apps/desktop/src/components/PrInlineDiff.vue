<script setup lang="ts">
/**
 * PrInlineDiff.vue
 *
 * Inline diff renderer for PR review — renders diff lines with:
 *  - Syntax highlighting
 *  - Comment threads anchored to specific lines (injected between rows)
 *  - "+" button on line-number hover to create new comments
 *  - Multi-line selection (drag line numbers) to create range comments
 *  - Code suggestion apply support
 */
import { ref, computed } from "vue";
import type { GitDiff, DiffLine, PrReviewComment } from "../utils/backend";
import PrCommentThread from "./PrCommentThread.vue";
import AiSparkle from "./AiSparkle.vue";
import { detectLanguage, highlightLine } from "../utils/highlight";
import { safeHtml } from "../composables/useSafeHtml";
import { useAIProvider } from "../composables/useAIProvider";
import { usePrHunkCritique, type HunkCritiqueResult } from "../composables/usePrHunkCritique";
import { useI18n } from "../composables/useI18n";

const props = defineProps<{
  diff: GitDiff | null;
  filePath: string | null;
  /** All review comments for this file. */
  comments: PrReviewComment[];
  /** GitHub login of the authenticated user. */
  currentUser?: string;
  /** Number of comments already staged in the pending review draft. */
  reviewDraftCount?: number;
}>();

interface CommentParams {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
  body: string;
}

const emit = defineEmits<{
  /** User wants to post an immediate comment (no review). */
  (e: "create-comment", params: CommentParams): void;
  /** User wants to stage a comment in the pending review draft. */
  (e: "add-to-review", params: CommentParams): void;
  (e: "reply-comment", inReplyToId: number, body: string): void;
  (e: "edit-comment", id: number, body: string): void;
  (e: "delete-comment", id: number): void;
  (e: "apply-suggestion", suggestion: string, startLine: number | null, endLine: number | null): void;
}>();

// ─── Syntax highlighting ─────────────────────────────────
const language = computed(() => props.filePath ? detectLanguage(props.filePath) : null);
function hl(content: string): string {
  return highlightLine(content, language.value);
}

// ─── AI hunk critique (Phase 1.3.1) ─────────────────────
const ai = useAIProvider();
const { isGenerating: isCritiquing, critique: critiqueHunk, lastError: critiqueAiError } = usePrHunkCritique();
const { locale, t } = useI18n();
/** Per-hunk cache: hunkIdx → result (or null while loading). */
const critiqueResults = ref<Record<number, HunkCritiqueResult | null>>({});
/** Which hunk is currently being analysed (only one at a time). */
const critiqueLoadingIdx = ref<number | null>(null);
/** Which hunk has its critique panel open. */
const critiqueOpenIdx = ref<number | null>(null);

async function requestHunkCritique(hunkIdx: number) {
  if (!props.diff || !props.filePath) return;
  const hunk = props.diff.hunks[hunkIdx];
  if (!hunk) return;

  // Toggle off if already shown.
  if (critiqueOpenIdx.value === hunkIdx && critiqueResults.value[hunkIdx]) {
    critiqueOpenIdx.value = null;
    return;
  }

  critiqueOpenIdx.value = hunkIdx;
  // Use the cached result if we have it.
  if (critiqueResults.value[hunkIdx]) return;

  critiqueLoadingIdx.value = hunkIdx;
  try {
    const res = await critiqueHunk(props.filePath, hunk, { locale: locale.value });
    critiqueResults.value = { ...critiqueResults.value, [hunkIdx]: res };
  } catch {
    // surfaced via critiqueAiError
  } finally {
    if (critiqueLoadingIdx.value === hunkIdx) critiqueLoadingIdx.value = null;
  }
}

function dismissCritique() {
  critiqueOpenIdx.value = null;
}

function verdictClass(v: HunkCritiqueResult["verdict"]): string {
  return `pid-critique--${v}`;
}

function verdictIcon(v: HunkCritiqueResult["verdict"]): string {
  switch (v) {
    case "ok":         return "✓";
    case "nit":        return "·";
    case "suggestion": return "💡";
    case "risk":       return "⚠";
  }
}

// ─── Thread grouping ─────────────────────────────────────
/**
 * Group comments into threads keyed by "path:line:side".
 * Replies are nested under their root comment.
 * A thread is rendered BELOW the line it's anchored to.
 */
interface Thread {
  key: string;       // path:line:side
  path: string;
  line: number;      // line number on the relevant side
  side: "LEFT" | "RIGHT";
  comments: PrReviewComment[];
}

const threads = computed<Thread[]>(() => {
  const roots = props.comments.filter((c) => !c.in_reply_to_id);
  return roots.map((root) => {
    const replies = props.comments.filter((c) => c.in_reply_to_id === root.id);
    const side = root.side ?? "RIGHT";
    const line = side === "RIGHT"
      ? (root.line ?? root.original_line ?? 0)
      : (root.original_line ?? root.line ?? 0);
    return {
      key: `${root.path}:${line}:${side}`,
      path: root.path,
      line,
      side,
      comments: [root, ...replies].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    };
  });
});

/** Get threads for a given line (matched by newLineNo for RIGHT, oldLineNo for LEFT). */
function threadsForLine(line: DiffLine): Thread[] {
  return threads.value.filter((t) => {
    if (t.side === "RIGHT") return t.line === line.newLineNo;
    if (t.side === "LEFT") return t.line === line.oldLineNo;
    return false;
  });
}

// ─── Compose new comment ─────────────────────────────────
interface ComposeLine {
  hunkIdx: number;
  lineIdx: number;
  line: number;
  side: "LEFT" | "RIGHT";
}

const composeLine = ref<ComposeLine | null>(null);
const composeText = ref("");

// ─── Code suggestion editor (v2.13) ──────────────────────
/**
 * Suggestion state — reuses ComposeLine to track position.
 * `suggestText` is pre-filled with the current line content;
 * the user edits the proposed replacement. On submit the text is
 * wrapped in a GitHub ` ```suggestion ``` ` block and staged as a
 * pending review comment (never a direct post).
 */
const suggestLine = ref<ComposeLine | null>(null);
const suggestText = ref("");

function openSuggest(hunkIdx: number, lineIdx: number, dl: DiffLine) {
  // Suggestions only make sense on the new-file side.
  if (dl.type === "delete") return;
  const line = dl.newLineNo ?? 0;
  suggestLine.value = { hunkIdx, lineIdx, line, side: "RIGHT" };
  // Pre-fill with the existing line content (strip leading marker spaces).
  suggestText.value = dl.content.replace(/^\+?/, "");
  composeLine.value = null; // close regular compose if open
  composeText.value = "";
}

function closeSuggest() {
  suggestLine.value = null;
  suggestText.value = "";
}

function submitSuggest() {
  if (!suggestLine.value || !props.filePath) return;
  const { line } = suggestLine.value;
  const suggestionBlock = `\`\`\`suggestion\n${suggestText.value}\n\`\`\``;
  emit("add-to-review", {
    path: props.filePath,
    line,
    side: "RIGHT",
    body: suggestionBlock,
  });
  closeSuggest();
}

function isSuggestAnchoredAt(dl: DiffLine): boolean {
  if (!suggestLine.value) return false;
  return suggestLine.value.line === dl.newLineNo && dl.type !== "delete";
}

// Multi-line selection
const selectionStart = ref<{ line: number; side: "LEFT" | "RIGHT" } | null>(null);
const selectionEnd = ref<{ line: number; side: "LEFT" | "RIGHT" } | null>(null);
const isDragging = ref(false);

function openCompose(hunkIdx: number, lineIdx: number, dl: DiffLine) {
  const side: "LEFT" | "RIGHT" = dl.type === "delete" ? "LEFT" : "RIGHT";
  const line = side === "RIGHT" ? (dl.newLineNo ?? 0) : (dl.oldLineNo ?? 0);
  composeLine.value = { hunkIdx, lineIdx, line, side };
  composeText.value = "";
  selectionStart.value = null;
  selectionEnd.value = null;
}

function closeCompose() {
  composeLine.value = null;
  composeText.value = "";
  selectionStart.value = null;
  selectionEnd.value = null;
}

function buildComposeParams(): CommentParams | null {
  if (!composeLine.value || !composeText.value.trim() || !props.filePath) return null;
  const body = composeText.value.trim();
  const { line, side } = composeLine.value;
  const base: CommentParams = { path: props.filePath, line, side, body };
  if (selectionStart.value && selectionStart.value.line !== line) {
    return {
      ...base,
      start_line: Math.min(selectionStart.value.line, line),
      start_side: selectionStart.value.side,
    };
  }
  return base;
}

function submitCompose() {
  const params = buildComposeParams();
  if (!params) return;
  emit("create-comment", params);
  closeCompose();
}

function submitToReview() {
  const params = buildComposeParams();
  if (!params) return;
  emit("add-to-review", params);
  closeCompose();
}

function isComposeAnchoredAt(dl: DiffLine): boolean {
  if (!composeLine.value) return false;
  const side: "LEFT" | "RIGHT" = dl.type === "delete" ? "LEFT" : "RIGHT";
  const lineNo = side === "RIGHT" ? dl.newLineNo : dl.oldLineNo;
  return composeLine.value.line === lineNo && composeLine.value.side === side;
}

// ─── Thread reply/edit/delete handlers ──────────────────
function handleReply(thread: Thread, body: string) {
  const rootId = thread.comments[0].id;
  emit("reply-comment", rootId, body);
}

function handleEdit(id: number, body: string) {
  emit("edit-comment", id, body);
}

function handleDelete(id: number) {
  emit("delete-comment", id);
}

function handleApplySuggestion(suggestion: string, startLine: number | null, endLine: number | null) {
  emit("apply-suggestion", suggestion, startLine, endLine);
}
</script>

<template>
  <div class="pid-root">
    <div v-if="!diff || !diff.hunks.length" class="pid-empty">
      Aucun diff disponible.
    </div>
    <template v-else>
      <div
        v-for="(hunk, hunkIdx) in diff.hunks"
        :key="hunkIdx"
        class="pid-hunk"
      >
        <!-- Hunk header -->
        <div class="pid-hunk-header mono">
          <span class="pid-hunk-header-text">{{ hunk.header }}</span>
          <button
            v-if="ai.isAvailable.value"
            class="btn btn--ai pid-hunk-ai"
            :class="{ 'pid-hunk-ai--active': critiqueOpenIdx === hunkIdx }"
            :disabled="critiqueLoadingIdx === hunkIdx"
            :title="t('prInline.aiCritiqueTooltip')"
            @click="requestHunkCritique(hunkIdx)"
          >
            <span v-if="critiqueLoadingIdx === hunkIdx">…</span>
            <span v-else class="pid-ai-label">
              <AiSparkle :size="13" />
              {{ t('prInline.aiCritiqueButton') }}
            </span>
          </button>
        </div>

        <!-- AI critique panel -->
        <div
          v-if="critiqueOpenIdx === hunkIdx && (critiqueResults[hunkIdx] || critiqueLoadingIdx === hunkIdx || critiqueAiError)"
          class="pid-critique"
          :class="critiqueResults[hunkIdx] ? verdictClass(critiqueResults[hunkIdx]!.verdict) : ''"
          role="status"
          aria-live="polite"
        >
          <span class="pid-critique-icon">
            <template v-if="critiqueResults[hunkIdx]">{{ verdictIcon(critiqueResults[hunkIdx]!.verdict) }}</template>
            <AiSparkle v-else :size="14" />
          </span>
          <span class="pid-critique-body">
            <span v-if="critiqueAiError && !critiqueResults[hunkIdx]" class="pid-critique-error">{{ critiqueAiError }}</span>
            <span v-else-if="critiqueLoadingIdx === hunkIdx && !critiqueResults[hunkIdx]">
              {{ t('prInline.aiCritiqueAnalyzing') }}
            </span>
            <template v-else-if="critiqueResults[hunkIdx]">
              <span class="pid-critique-verdict">{{ critiqueResults[hunkIdx]!.verdict }}</span>
              <span class="pid-critique-summary">{{ critiqueResults[hunkIdx]!.summary }}</span>
            </template>
          </span>
          <button
            v-if="critiqueLoadingIdx !== hunkIdx"
            class="pid-critique-close"
            @click="dismissCritique"
            aria-label="Close"
          >✕</button>
        </div>

        <!-- Lines -->
        <template v-for="(dl, lineIdx) in hunk.lines" :key="lineIdx">
          <!-- Diff row -->
          <div
            class="pid-row"
            :class="{
              'pid-row--add': dl.type === 'add',
              'pid-row--del': dl.type === 'delete',
              'pid-row--ctx': dl.type === 'context',
            }"
          >
            <!-- Old line number -->
            <div
              class="pid-lno mono"
              :class="{ 'pid-lno--clickable': dl.type !== 'add' }"
              @click="dl.type !== 'add' && openCompose(hunkIdx, lineIdx, dl)"
              :title="dl.type !== 'add' ? 'Ajouter un commentaire' : undefined"
            >
              <span class="pid-lno-num">{{ dl.oldLineNo ?? '' }}</span>
              <span class="pid-lno-icon">+</span>
            </div>
            <!-- New line number -->
            <div
              class="pid-lno mono"
              :class="{ 'pid-lno--clickable': dl.type !== 'delete' }"
              @click="dl.type !== 'delete' && openCompose(hunkIdx, lineIdx, dl)"
              :title="dl.type !== 'delete' ? 'Ajouter un commentaire' : undefined"
            >
              <span class="pid-lno-num">{{ dl.newLineNo ?? '' }}</span>
              <span class="pid-lno-icon">+</span>
            </div>
            <!-- Marker -->
            <div class="pid-marker mono">
              {{ dl.type === 'add' ? '+' : dl.type === 'delete' ? '-' : ' ' }}
            </div>
            <!-- Content -->
            <div class="pid-content mono" v-html="safeHtml(hl(dl.content)) || '&nbsp;'" />
            <!-- Suggest button (v2.13) — visible on hover for add/context lines -->
            <button
              v-if="dl.type !== 'delete'"
              class="pid-suggest-btn"
              :title="t('pr.inline.suggestTooltip')"
              @click.stop="openSuggest(hunkIdx, lineIdx, dl)"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- Comment threads anchored to this line -->
          <div
            v-for="thread in threadsForLine(dl)"
            :key="thread.key"
            class="pid-thread-row"
          >
            <div class="pid-thread-gutter" />
            <div class="pid-thread-body">
              <PrCommentThread
                :comments="thread.comments"
                :current-user="currentUser"
                @reply="(body) => handleReply(thread, body)"
                @edit="handleEdit"
                @delete="handleDelete"
                @apply-suggestion="handleApplySuggestion"
              />
            </div>
          </div>

          <!-- Compose box anchored to this line -->
          <div
            v-if="isComposeAnchoredAt(dl)"
            class="pid-thread-row pid-compose-row"
          >
            <div class="pid-thread-gutter" />
            <div class="pid-thread-body">
              <div class="pid-compose">
                <textarea
                  v-model="composeText"
                  class="pid-textarea"
                  :placeholder="t('pr.inline.composePlaceholder')"
                  rows="3"
                  autofocus
                  @keydown.ctrl.enter.prevent="submitCompose"
                  @keydown.meta.enter.prevent="submitCompose"
                  @keydown.escape="closeCompose"
                />
                <div class="pid-compose-actions">
                  <button class="pid-cancel-btn" @click="closeCompose">{{ t('pr.inline.cancel') }}</button>
                  <button
                    class="pid-review-btn"
                    :disabled="!composeText.trim()"
                    @click="submitToReview"
                    :title="reviewDraftCount ? t('pr.inline.addToReviewPending', reviewDraftCount) : t('pr.inline.addToReview')"
                  >
                    {{ reviewDraftCount ? t('pr.inline.reviewBtnCount', reviewDraftCount) : t('pr.inline.reviewBtn') }}
                  </button>
                  <button
                    class="pid-submit-btn"
                    :disabled="!composeText.trim()"
                    @click="submitCompose"
                  >{{ t('pr.inline.commentBtn') }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Suggestion editor (v2.13) -->
          <div
            v-if="isSuggestAnchoredAt(dl)"
            class="pid-thread-row pid-suggest-row"
          >
            <div class="pid-thread-gutter" />
            <div class="pid-thread-body">
              <div class="pid-suggest">
                <div class="pid-suggest-header">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
                    <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" stroke-linejoin="round"/>
                  </svg>
                  {{ t('pr.inline.suggestTitle') }}
                  <span class="pid-suggest-hint">{{ t('pr.inline.suggestHint') }}</span>
                </div>
                <div class="pid-suggest-preview">
                  <span class="pid-suggest-fence">```suggestion</span>
                  <textarea
                    v-model="suggestText"
                    class="pid-textarea pid-suggest-textarea mono"
                    rows="3"
                    autofocus
                    @keydown.ctrl.enter.prevent="submitSuggest"
                    @keydown.meta.enter.prevent="submitSuggest"
                    @keydown.escape="closeSuggest"
                  />
                  <span class="pid-suggest-fence">```</span>
                </div>
                <div class="pid-compose-actions">
                  <button class="pid-cancel-btn" @click="closeSuggest">{{ t('pr.inline.cancel') }}</button>
                  <button
                    class="pid-review-btn"
                    @click="submitSuggest"
                    :title="reviewDraftCount ? t('pr.inline.addToReviewPending', reviewDraftCount) : t('pr.inline.addToReview')"
                  >
                    {{ reviewDraftCount ? t('pr.inline.reviewBtnCount', reviewDraftCount) : t('pr.inline.suggestAddToReview') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pid-root {
  font-size: 12px;
  overflow-x: auto;
  background: var(--color-bg);
}

.pid-empty {
  padding: 24px;
  color: var(--color-text-muted);
  text-align: center;
}

.pid-hunk {
  margin-bottom: 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.pid-hunk-header {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  padding: 3px 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.pid-hunk-header-text {
  flex: 1;
  min-width: 0;
}

/* Tight-packing override so the global .btn--ai fits the per-hunk
   header row (default 32px min-height is too tall for a sub-row). */
.pid-hunk-ai {
  flex-shrink: 0;
  min-height: 20px;
  padding: 1px 10px;
  font-size: 10.5px;
  font-family: inherit;
}
.pid-hunk-ai--active {
  background: var(--color-ai);
  color: var(--color-ai-text);
}
.pid-ai-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

/* ── Critique panel ────────────────────────────────── */
.pid-critique {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text);
}

.pid-critique--ok         { background: var(--color-success-soft, rgba(34, 197, 94, 0.08));  border-left: 3px solid var(--color-success, #22c55e); }
.pid-critique--nit        { background: var(--color-bg-secondary);                            border-left: 3px solid var(--color-text-muted); }
.pid-critique--suggestion { background: var(--color-accent-soft, rgba(139, 92, 246, 0.08)); border-left: 3px solid var(--color-accent); }
.pid-critique--risk       { background: var(--color-warning-soft, rgba(234, 179, 8, 0.08));   border-left: 3px solid var(--color-warning, #eab308); }

.pid-critique-icon {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
  padding-top: 1px;
}

.pid-critique-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pid-critique-verdict {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.pid-critique-summary {
  color: var(--color-text);
}

.pid-critique-error {
  color: var(--color-danger);
}

.pid-critique-close {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 0 4px;
}

.pid-critique-close:hover { color: var(--color-text); }

/* Diff rows */
.pid-row {
  display: flex;
  align-items: stretch;
  min-height: 20px;
  line-height: 20px;
  border-bottom: 1px solid transparent;
}

.pid-row--add { background: var(--color-success-soft); }
.pid-row--del { background: var(--color-danger-soft); }
.pid-row--ctx { background: transparent; }

/* Line numbers */
.pid-lno {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 40px;
  min-width: 40px;
  padding: 0 6px;
  color: var(--color-text-muted);
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  user-select: none;
  position: relative;
  font-size: 11px;
}

.pid-lno-num { flex: 1; text-align: right; }
.pid-lno-icon {
  position: absolute;
  left: 2px;
  color: var(--color-accent);
  font-size: 12px;
  font-weight: bold;
  opacity: 0;
  transition: opacity 0.1s;
}

.pid-lno--clickable { cursor: pointer; }
.pid-lno--clickable:hover { background: var(--color-accent-soft); }
.pid-lno--clickable:hover .pid-lno-icon { opacity: 1; }

/* Marker column */
.pid-marker {
  width: 18px;
  min-width: 18px;
  text-align: center;
  color: var(--color-text-muted);
  border-right: 1px solid var(--color-border);
}
.pid-row--add .pid-marker { color: var(--color-success); }
.pid-row--del .pid-marker { color: var(--color-danger); }

/* Content column */
.pid-content {
  flex: 1;
  padding: 0 8px;
  white-space: pre;
  overflow: hidden;
  color: var(--color-text);
}

/* Thread row (spans full width) */
.pid-thread-row {
  display: flex;
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
}

.pid-thread-gutter {
  width: 98px; /* 40 + 40 + 18 px = gutter width */
  min-width: 98px;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
}

.pid-thread-body {
  flex: 1;
  padding: 8px 12px;
}

/* Compose box */
.pid-compose {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pid-compose-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.pid-textarea {
  width: 100%;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 12px;
  padding: 6px 8px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.pid-textarea:focus { outline: none; border-color: var(--color-accent); }

.pid-cancel-btn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-muted);
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
}
.pid-cancel-btn:hover { border-color: var(--color-text-muted); }

.pid-review-btn {
  background: none;
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  color: var(--color-accent);
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.pid-review-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pid-review-btn:not(:disabled):hover { background: var(--color-accent-soft); }

.pid-submit-btn {
  background: var(--color-accent);
  border: none;
  border-radius: 4px;
  color: var(--color-accent-text);
  padding: 3px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.pid-submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pid-submit-btn:not(:disabled):hover { filter: brightness(1.1); }

/* ── Suggest button (v2.13) ────────────────────────────── */
.pid-suggest-btn {
  flex-shrink: 0;
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  margin: 0 4px;
  transition: background 0.1s, color 0.1s;
}

.pid-row:hover .pid-suggest-btn {
  display: flex;
}

.pid-suggest-btn:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

/* ── Suggestion editor row ──────────────────────────────── */
.pid-suggest-row {
  background: var(--color-bg-secondary);
}

.pid-suggest {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pid-suggest-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
}

.pid-suggest-hint {
  font-weight: 400;
  color: var(--color-text-muted);
  font-size: 10px;
  margin-left: 2px;
}

.pid-suggest-preview {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-bg);
}

.pid-suggest-fence {
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 2px 8px;
  border-bottom: 1px solid var(--color-border);
  display: block;
}

.pid-suggest-fence:last-child {
  border-top: 1px solid var(--color-border);
  border-bottom: none;
}

.pid-suggest-textarea {
  border: none;
  border-radius: 0;
  background: var(--color-success-soft);
}

.pid-suggest-textarea:focus {
  outline: none;
  border-color: transparent;
}
</style>
