<script setup lang="ts">
/**
 * PrReviewModal.vue
 *
 * Modal for submitting a complete PR review (Phase 9.3).
 * Allows the user to:
 *  - Choose a review type: Approve / Request Changes / Comment
 *  - Write an optional body (required for Request Changes)
 *  - See how many pending draft comments will be included
 *  - Submit the review via GitHub API
 *
 * Built on BaseModal. Escape / backdrop dismissal come from BaseModal.
 */
import { ref, computed } from "vue";
import type { PendingReviewComment } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();

const props = defineProps<{
  prNumber: number;
  /** Pending draft comments staged in this review. */
  draftComments: PendingReviewComment[];
  /** Whether the review is currently being submitted. */
  submitting?: boolean;
}>();

const emit = defineEmits<{
  /** User confirmed the review — parent calls ghPrSubmitReview then closes modal. */
  (e: "submit", opts: {
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    body: string;
    comments: PendingReviewComment[];
  }): void;
  (e: "close"): void;
}>();

type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

const reviewEvent = ref<ReviewEvent>("COMMENT");
const body = ref("");

const canSubmit = computed(() => {
  if (props.submitting) return false;
  if (reviewEvent.value === "REQUEST_CHANGES" && !body.value.trim()) return false;
  return true;
});

const eventLabel = computed<Record<ReviewEvent, string>>(() => ({
  APPROVE: t("pr.review.eventApprove"),
  REQUEST_CHANGES: t("pr.review.eventRequestChanges"),
  COMMENT: t("pr.review.eventComment"),
}));

const eventIcon: Record<ReviewEvent, string> = {
  APPROVE: "✅",
  REQUEST_CHANGES: "🔴",
  COMMENT: "💬",
};

function handleSubmit() {
  if (!canSubmit.value) return;
  emit("submit", {
    event: reviewEvent.value,
    body: body.value.trim(),
    comments: props.draftComments,
  });
}

/** Map review event → modifier class for the primary submit button. */
const submitModifierClass = computed(() => {
  switch (reviewEvent.value) {
    case "APPROVE":
      return "bm-btn--primary prm-submit--approve";
    case "REQUEST_CHANGES":
      return "bm-btn--danger";
    default:
      return "bm-btn--primary";
  }
});
</script>

<template>
  <BaseModal
    size="md"
    :title="t('pr.review.modalTitle')"
    :aria-label="t('pr.review.modalAria')"
    @close="emit('close')"
  >
    <template #title-icon>
      <span class="prm-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M9 12l2 2 4-4"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M20.5 7.5L12 3 3.5 7.5v7.25a2 2 0 0 0 1.1 1.79L12 20.5l7.4-3.96a2 2 0 0 0 1.1-1.79V7.5z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </template>

    <!-- Draft comments summary -->
    <div v-if="draftComments.length > 0" class="prm-drafts">
      <span class="prm-drafts-icon">💬</span>
      <span>{{ t('pr.review.draftsInfo', draftComments.length) }}</span>
    </div>
    <div v-else class="prm-drafts prm-drafts--empty">
      {{ t('pr.review.noDrafts') }}
    </div>

    <!-- Review type -->
    <div class="prm-section">
      <div class="prm-section-label">{{ t('pr.review.typeLabel') }}</div>
      <div class="prm-radio-group">
        <label
          v-for="ev in (['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as ReviewEvent[])"
          :key="ev"
          class="prm-radio-label"
          :class="{ 'prm-radio-label--active': reviewEvent === ev }"
        >
          <input
            type="radio"
            :value="ev"
            v-model="reviewEvent"
            class="prm-radio"
          />
          <span class="prm-radio-icon">{{ eventIcon[ev] }}</span>
          <span class="prm-radio-text">{{ eventLabel[ev] }}</span>
        </label>
      </div>
    </div>

    <!-- Body -->
    <div class="prm-section">
      <div class="prm-section-label">
        {{ t('pr.review.messageLabel') }}
        <span v-if="reviewEvent === 'REQUEST_CHANGES'" class="prm-required">{{ t('pr.review.required') }}</span>
        <span v-else class="prm-optional">{{ t('pr.review.optional') }}</span>
      </div>
      <textarea
        v-model="body"
        class="prm-textarea"
        rows="5"
        :placeholder="reviewEvent === 'APPROVE'
          ? t('pr.review.placeholderApprove')
          : reviewEvent === 'REQUEST_CHANGES'
            ? t('pr.review.placeholderRequestChanges')
            : t('pr.review.placeholderComment')"
        @keydown.ctrl.enter.prevent="handleSubmit"
        @keydown.meta.enter.prevent="handleSubmit"
      />
    </div>

    <!-- Footer -->
    <template #footer>
      <button class="bm-btn bm-btn--ghost" @click="emit('close')">
        {{ t('pr.review.cancel') }}
      </button>
      <button
        class="bm-btn"
        :class="submitModifierClass"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <span v-if="submitting">{{ t('pr.review.submitting') }}</span>
        <span v-else>{{ eventIcon[reviewEvent] }} {{ eventLabel[reviewEvent] }}</span>
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.prm-icon {
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

/* Draft summary */
.prm-drafts {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.prm-drafts--empty {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text-muted);
}
.prm-drafts-icon { font-size: 14px; }

/* Sections */
.prm-section {
  margin-top: var(--space-4);
}
.prm-section:first-of-type { margin-top: 0; }

.prm-section-label {
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: var(--space-2);
  display: flex;
  gap: 6px;
  align-items: center;
}

.prm-required { color: var(--color-danger); font-weight: 500; text-transform: none; }
.prm-optional { color: var(--color-text-muted); font-weight: 400; text-transform: none; }

/* Radio group */
.prm-radio-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prm-radio-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.prm-radio-label:hover { border-color: var(--color-accent); background: var(--color-accent-soft); }
.prm-radio-label--active { border-color: var(--color-accent); background: var(--color-accent-soft); }

.prm-radio { display: none; }
.prm-radio-icon { font-size: 15px; }
.prm-radio-text { font-weight: 500; }

/* Textarea */
.prm-textarea {
  width: 100%;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  padding: var(--space-3) var(--space-4);
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.prm-textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft, rgba(124, 58, 237, 0.18));
}
</style>

<!-- Override: APPROVE uses success colors rather than accent purple.
     Non-scoped so the more-specific class wins over .bm-btn--primary
     via source-order (both sit at specificity 0,1,0). -->
<style>
.prm-submit--approve {
  background: var(--color-success);
  border-color: var(--color-success);
  color: var(--color-success-text, #ffffff);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08), 0 4px 10px rgba(46, 160, 67, 0.22);
}
.prm-submit--approve:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.08), 0 8px 16px rgba(46, 160, 67, 0.28);
}
</style>
