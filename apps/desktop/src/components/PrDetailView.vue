<script setup lang="ts">
/**
 * PrDetailView.vue
 *
 * Full PR detail rendered in <main> when viewMode === "prs".
 * Injects the shared usePrPanel composable. No modal wrapper — fills the main area.
 *
 * Visual language:
 * - Large PR title with number badge, author avatar + branch path in the hero
 * - Action cluster (Checkout / Merger / GitHub) using the design system .btn tokens
 * - Stat cards refined with icons + gradient hover
 * - Polished tabs with animation + count badges
 */
import { computed, inject, nextTick, ref } from "vue";
import { PR_PANEL_KEY, type PrPanelState } from "../composables/usePrPanel";
import { renderMarkdown } from "../composables/useSafeHtml";
import { useAvatar } from "../composables/useAvatar";
import { openExternalUrl } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import PrInlineDiff from "./PrInlineDiff.vue";
import PrReviewModal from "./PrReviewModal.vue";
import PrIntelligencePanel from "./PrIntelligencePanel.vue";

const { t } = useI18n();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "navigate-commit", hash: string): void;
}>();

const p = inject<PrPanelState>(PR_PANEL_KEY)!;

// window.open is a no-op in the Tauri webview — hand the URL to the OS opener.
function openInBrowser(url: string) { void openExternalUrl(url); }

// Anchors inside rendered markdown (PR description) would otherwise navigate the
// Tauri webview away from the app. Intercept clicks on http(s) links and hand
// them to the OS browser instead.
function onMarkdownClick(e: MouseEvent) {
  const anchor = (e.target as HTMLElement | null)?.closest("a");
  const href = anchor?.getAttribute("href");
  if (!href) return;
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault();
    void openExternalUrl(href);
  }
}

// Avatar disks share the app-wide outline style — see composables/useAvatar.
const { avatarStyle, avatarInitials: authorInitials } = useAvatar();

const isOpenPr = computed(() => {
  const s = p.selectedPr.value?.state;
  return s === "OPEN" || s === "open";
});

/** Local UI state for the PR description's formatted / raw switch. */
const descriptionTab = ref<"formatted" | "raw">("formatted");

/** Review + issue-level comments, sorted oldest-first for display under the description. */
const sortedComments = computed(() =>
  [...p.prComments.value, ...p.prIssueComments.value].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  ),
);

/** Anchor at the bottom of the comments list — target for the Comments tile. */
const commentsEnd = ref<HTMLElement | null>(null);

/** Clicking the Comments tile jumps to the Info tab and scrolls to the last comment. */
async function scrollToLastComment() {
  p.detailTab.value = "info";
  await nextTick();
  commentsEnd.value?.scrollIntoView({ behavior: "smooth", block: "end" });
}

/**
 * Web URL for a comment's "Go to" button. GitHub/Bitbucket expose a direct
 * per-comment permalink; GitLab/Azure don't, so fall back to the PR/MR page
 * (with the GitLab `#note_<id>` anchor when the base is a GitLab MR).
 */
function commentHref(c: { url: string; id: number }): string {
  if (c.url) return c.url;
  const base = p.prDetail.value?.url ?? "";
  if (!base) return "";
  return /gitlab/i.test(base) && c.id ? `${base}#note_${c.id}` : base;
}

/** Short relative time for a comment timestamp. */
function commentTimeAgo(dateStr: string): string {
  try {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}j`;
  } catch { return dateStr; }
}
</script>

<template>
  <div class="pdv-root">
    <!-- Merge dialog -->
    <div v-if="p.mergingPr.value" class="pdv-merge-dialog">
      <p class="pdv-merge-prompt">
        {{ t('pr.detail.mergePromptPrefix') }}
        <strong>#{{ p.mergingPr.value.number }}</strong>
        <span class="pdv-merge-title">— {{ p.mergingPr.value.title }}</span>
      </p>
      <div class="pdv-merge-options">
        <label class="pdv-merge-opt">
          <input type="radio" v-model="p.mergeMethod.value" value="merge" />
          <span>{{ t('pr.detail.mergeMethodMerge') }}</span>
        </label>
        <label class="pdv-merge-opt">
          <input type="radio" v-model="p.mergeMethod.value" value="squash" />
          <span>{{ t('pr.detail.mergeMethodSquash') }}</span>
        </label>
        <label class="pdv-merge-opt">
          <input type="radio" v-model="p.mergeMethod.value" value="rebase" />
          <span>{{ t('pr.detail.mergeMethodRebase') }}</span>
        </label>
      </div>
      <div class="pdv-merge-actions">
        <button class="pdv-btn pdv-btn--primary" @click="p.mergePr">{{ t('pr.detail.merge') }}</button>
        <button class="pdv-btn" @click="p.mergingPr.value = null">{{ t('pr.detail.cancel') }}</button>
      </div>
    </div>

    <!-- Messages -->
    <div v-if="p.error.value" class="pdv-msg pdv-msg--error">{{ p.error.value }}</div>
    <div v-if="p.success.value" class="pdv-msg pdv-msg--success" @click="p.success.value = null">{{ p.success.value }}</div>

    <!-- Empty state -->
    <div v-if="!p.selectedPr.value" class="pdv-empty">
      <div class="pdv-empty-illustration" aria-hidden="true">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M6 9v6M18 15V9a3 3 0 0 0-3-3H9" />
        </svg>
      </div>
      <span class="pdv-empty-label">{{ t('pr.detail.emptySelect') }}</span>
    </div>

    <!-- Detail loading -->
    <div v-else-if="p.detailLoading.value && !p.prDetail.value" class="pdv-empty">
      <div class="pdv-spinner" aria-hidden="true"></div>
      <span class="pdv-empty-label">{{ t('pr.detail.loading') }}</span>
    </div>

    <!-- Detail error -->
    <div v-else-if="p.detailError.value && !p.prDetail.value" class="pdv-msg pdv-msg--error pdv-msg--full">
      {{ p.detailError.value }}
    </div>

    <!-- Detail content -->
    <template v-else-if="p.prDetail.value">
      <!-- Hero header -->
      <header class="pdv-hero">
        <div class="pdv-hero-top">
          <div class="pdv-hero-title">
            <span class="pdv-pr-num">#{{ p.prDetail.value.number }}</span>
            <h1 class="pdv-pr-title">{{ p.prDetail.value.title }}</h1>
            <!-- SWR: cached detail is on screen; show a small badge while the
                 background revalidation runs. -->
            <span
              v-if="p.detailRefreshing.value"
              class="pdv-refresh-badge"
              role="status"
              :title="t('pr.detail.refreshing')"
            >
              <span class="pdv-spinner pdv-spinner--sm" aria-hidden="true"></span>
              {{ t('pr.detail.refreshing') }}
            </span>
          </div>
          <div class="pdv-hero-actions">
            <button class="pdv-btn" @click="p.checkoutPr(p.selectedPr.value!)">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 8h10M8 3l5 5-5 5" />
              </svg>
              <span>{{ t('pr.detail.checkout') }}</span>
            </button>
            <button
              v-if="isOpenPr && p.prDetail.value?.draft"
              class="pdv-btn pdv-btn--accent"
              @click="p.convertDraftToReady(p.selectedPr.value!)"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 8l4 4 6-7"/>
              </svg>
              <span>{{ t('pr.detail.markAsReady') }}</span>
            </button>
            <button
              v-if="isOpenPr"
              class="pdv-btn pdv-btn--primary"
              @click="p.mergingPr.value = p.selectedPr.value"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="4" cy="4" r="2" />
                <circle cx="4" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M4 6v4" />
                <path d="M4 12a8 8 0 0 0 8-8" />
              </svg>
              <span>{{ t('pr.detail.merge') }}</span>
            </button>
            <button class="pdv-btn pdv-btn--ghost" @click="openInBrowser(p.prDetail.value.url)" :title="p.forgeLabel.value">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6.5 3H3v10h10V9.5M9.5 2.5H13V6M13 3l-6 6" />
              </svg>
              <span>{{ p.forgeLabel.value }}</span>
            </button>
          </div>
        </div>

        <div class="pdv-hero-meta">
          <span class="pdv-author">
            <span class="pdv-avatar" :style="avatarStyle(p.prDetail.value.author)" aria-hidden="true">{{ authorInitials(p.prDetail.value.author) }}</span>
            <span class="pdv-author-name">{{ p.prDetail.value.author }}</span>
          </span>
          <span class="pdv-meta-sep" aria-hidden="true">·</span>
          <span class="pdv-branch-path">
            <span class="pdv-branch mono">{{ p.prDetail.value.branch }}</span>
            <svg class="pdv-branch-arrow" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
            <span class="pdv-branch mono">{{ p.prDetail.value.base }}</span>
          </span>
          <span class="pdv-meta-sep" aria-hidden="true">·</span>
          <span class="pdv-time">{{ p.timeAgo(p.prDetail.value.createdAt) }}</span>
          <span v-if="p.prDetail.value.mergedAt" class="pdv-merged-ago">
            {{ t('pr.detail.mergedAgo', p.timeAgo(p.prDetail.value.mergedAt)) }}
          </span>
        </div>
      </header>

      <!-- Tabs -->
      <nav class="pdv-tabs" :aria-label="t('pr.detail.tabInfo')">
        <button
          :class="['pdv-tab', { 'pdv-tab--active': p.detailTab.value === 'info' }]"
          @click="p.detailTab.value = 'info'"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v4M8 5v.01" stroke-linecap="round" />
          </svg>
          {{ t('pr.detail.tabInfo') }}
        </button>
        <button
          :class="['pdv-tab', { 'pdv-tab--active': p.detailTab.value === 'diff' }]"
          @click="p.detailTab.value = 'diff'"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 2v6a3 3 0 0 0 3 3h3" />
            <path d="M11 5V3h2v2zM11 14v-2h2v2z" />
          </svg>
          {{ t('pr.detail.tabDiff') }}
          <span v-if="p.prDetail.value.changedFiles" class="pdv-tab-count">{{ p.prDetail.value.changedFiles }}</span>
          <span v-if="p.commentCount.value" class="pdv-tab-count pdv-tab-count--accent" :title="t('pr.detail.description')">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M14 8c0 3-3 5.5-6 5.5-.7 0-1.4-.1-2-.3L3 14l.7-2.8A5.5 5.5 0 0 1 2 8c0-3 3-5.5 6-5.5S14 5 14 8z" />
            </svg>
            {{ p.commentCount.value }}
          </span>
        </button>
        <button
          :class="['pdv-tab', { 'pdv-tab--active': p.detailTab.value === 'checks' }]"
          @click="p.detailTab.value = 'checks'"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1.5 8h2.5l1.5-4 3 9 2-6 1.5 3h3" />
          </svg>
          {{ t('pr.detail.tabCi') }}
          <span
            v-if="p.prDetail.value.checksStatus"
            class="pdv-tab-emoji pdv-tab-emoji--sm"
            :title="p.prDetail.value.checksStatus"
          >{{ p.checksIcon(p.prDetail.value.checksStatus) }}</span>
          <span v-if="p.prChecks.value.length" class="pdv-tab-count">{{ p.prChecks.value.length }}</span>
        </button>
        <button
          :class="['pdv-tab', { 'pdv-tab--active': p.detailTab.value === 'intelligence' }]"
          @click="p.detailTab.value = 'intelligence'"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.5 2l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z" />
            <path d="M11.5 9l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
          </svg>
          {{ t('pr.detail.tabIntelligence') }}
        </button>
        <div class="pdv-tab-spacer" />
        <button
          class="pdv-review-btn"
          :class="{ 'pdv-review-btn--primary': p.draftReviewComments.value.length }"
          @click="p.showReviewModal.value = true"
          :title="t('pr.detail.reviewBtn')"
        >
          <svg
            v-if="!p.draftReviewComments.value.length"
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M11 2l3 3-8 8H3v-3z" />
            <path d="M10 3l3 3" />
          </svg>
          <svg
            v-else
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 8l3 3 7-7" />
          </svg>
          <span class="pdv-review-btn-label">{{ t('pr.detail.reviewBtn') }}</span>
          <span
            v-if="p.draftReviewComments.value.length"
            class="pdv-review-count"
            :aria-label="String(p.draftReviewComments.value.length)"
          >{{ p.draftReviewComments.value.length }}</span>
        </button>
      </nav>

      <!-- Tab content -->
      <div class="pdv-content">

        <!-- Info tab -->
        <div v-if="p.detailTab.value === 'info'" class="pdv-body pdv-info">
          <!-- Merge readiness banner -->
          <div
            v-if="p.mergeReadiness.value"
            class="pdv-readiness"
            :class="p.mergeReadiness.value.ready ? 'pdv-readiness--ok' : 'pdv-readiness--wait'"
          >
            <span class="pdv-readiness-icon">{{ p.mergeReadiness.value.ready ? '✅' : '⏳' }}</span>
            <span class="pdv-readiness-text">{{ p.mergeReadiness.value.reason }}</span>
          </div>

          <!-- Stat cards -->
          <div class="pdv-stats-grid">
            <div class="pdv-stat">
              <span class="pdv-stat-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="4" cy="4" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M4 6v4a4 4 0 0 0 4 4" />
                </svg>
              </span>
              <span class="pdv-stat-label">{{ t('pr.detail.statMerge') }}</span>
              <span class="pdv-stat-value">
                <span class="pdv-stat-emoji">{{ p.mergeableIcon(p.prDetail.value.mergeable) }}</span>
                {{ p.prDetail.value.mergeable }}
              </span>
            </div>

            <button type="button" class="pdv-stat pdv-stat--clickable" @click="p.detailTab.value = 'diff'">
              <span class="pdv-stat-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z" />
                  <path d="M10 2v3h3" />
                </svg>
              </span>
              <span class="pdv-stat-label">{{ t('pr.detail.statFiles') }}</span>
              <span class="pdv-stat-value">{{ p.prDetail.value.changedFiles }}</span>
            </button>

            <button type="button" class="pdv-stat pdv-stat--clickable" @click="p.detailTab.value = 'diff'">
              <span class="pdv-stat-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </span>
              <span class="pdv-stat-label">{{ t('pr.detail.statDiff') }}</span>
              <span class="pdv-stat-value pdv-stat-diff">
                <span class="pdv-add">+{{ p.prDetail.value.additions }}</span>
                <span class="pdv-del">−{{ p.prDetail.value.deletions }}</span>
              </span>
            </button>

            <component
              :is="sortedComments.length ? 'button' : 'div'"
              :type="sortedComments.length ? 'button' : undefined"
              class="pdv-stat"
              :class="{ 'pdv-stat--clickable': sortedComments.length }"
              @click="sortedComments.length && scrollToLastComment()"
            >
              <span class="pdv-stat-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 8c0 3-3 5.5-6 5.5-.7 0-1.4-.1-2-.3L3 14l.7-2.8A5.5 5.5 0 0 1 2 8c0-3 3-5.5 6-5.5S14 5 14 8z" />
                </svg>
              </span>
              <span class="pdv-stat-label">{{ t('pr.detail.statComments') }}</span>
              <span class="pdv-stat-value">{{ p.prDetail.value.comments + p.prDetail.value.reviewComments }}</span>
            </component>
          </div>

          <!-- Reviewers -->
          <section v-if="p.prDetail.value.reviewers.length" class="pdv-section">
            <h2 class="pdv-section-label">{{ t('pr.detail.reviewers') }}</h2>
            <div class="pdv-chips">
              <span v-for="r in p.prDetail.value.reviewers" :key="r" class="pdv-chip pdv-chip--reviewer">
                <span class="pdv-chip-avatar" :style="avatarStyle(r)" aria-hidden="true">
                  {{ authorInitials(r) }}
                </span>
                {{ r }}
              </span>
            </div>
          </section>

          <!-- Labels -->
          <section v-if="p.prDetail.value.labels.length" class="pdv-section">
            <h2 class="pdv-section-label">{{ t('pr.detail.labels') }}</h2>
            <div class="pdv-chips">
              <span v-for="l in p.prDetail.value.labels" :key="l" class="pdv-chip pdv-chip--label">{{ l }}</span>
            </div>
          </section>

          <!-- Description -->
          <section class="pdv-section pdv-section--desc">
            <div class="pdv-desc-head">
              <h2 class="pdv-section-label">{{ t('pr.detail.description') }}</h2>
              <div v-if="p.prDetail.value.body" class="pdv-desc-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  class="pdv-desc-tab"
                  :class="{ 'pdv-desc-tab--active': descriptionTab === 'formatted' }"
                  :aria-selected="descriptionTab === 'formatted'"
                  @click="descriptionTab = 'formatted'"
                >
                  {{ t('dashboard.formatted') }}
                </button>
                <button
                  type="button"
                  role="tab"
                  class="pdv-desc-tab"
                  :class="{ 'pdv-desc-tab--active': descriptionTab === 'raw' }"
                  :aria-selected="descriptionTab === 'raw'"
                  @click="descriptionTab = 'raw'"
                >
                  {{ t('dashboard.raw') }}
                </button>
              </div>
            </div>
            <div v-if="p.prDetail.value.body" class="pdv-desc-body">
              <div
                v-if="descriptionTab === 'formatted'"
                class="pdv-body-formatted"
                @click="onMarkdownClick"
                v-html="renderMarkdown(p.prDetail.value.body)"
              />
              <pre v-else class="pdv-body-raw"><code>{{ p.prDetail.value.body }}</code></pre>
            </div>
            <div v-else class="pdv-muted">{{ t('pr.detail.noDescription') }}</div>
          </section>

          <!-- Comments -->
          <section v-if="sortedComments.length" class="pdv-section pdv-section--comments">
            <h2 class="pdv-section-label">
              {{ t('pr.detail.statComments') }}
              <span class="pdv-section-count">{{ sortedComments.length }}</span>
            </h2>
            <ul class="pdv-comments">
              <li v-for="c in sortedComments" :key="`${c.path}#${c.id}`" class="pdv-comment">
                <div class="pdv-comment-head">
                  <span class="pdv-comment-avatar" :style="avatarStyle(c.author)" aria-hidden="true">
                    {{ authorInitials(c.author) }}
                  </span>
                  <span class="pdv-comment-author">{{ c.author }}</span>
                  <button
                    v-if="commentHref(c)"
                    type="button"
                    class="pdv-comment-goto"
                    :title="t('pr.detail.commentGoto')"
                    @click="openInBrowser(commentHref(c))"
                  >
                    {{ t('pr.detail.commentGoto') }}
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
                    </svg>
                  </button>
                  <span v-if="c.path" class="pdv-comment-anchor">{{ c.path.split('/').pop() }}<template v-if="c.line">:{{ c.line }}</template></span>
                  <span class="pdv-comment-time" :title="c.created_at">{{ commentTimeAgo(c.created_at) }}</span>
                </div>
                <div class="pdv-comment-body" @click="onMarkdownClick" v-html="renderMarkdown(c.body)" />
              </li>
            </ul>
            <div ref="commentsEnd"></div>
          </section>

          <!-- Secondary links -->
          <div class="pdv-links">
            <button class="pdv-btn pdv-btn--ghost pdv-btn--sm" @click="openInBrowser(p.prDetail.value.url + '/commits')">
              {{ t('pr.detail.linkCommits') }}
            </button>
            <button class="pdv-btn pdv-btn--ghost pdv-btn--sm" @click="openInBrowser(p.prDetail.value.url + '/files')">
              {{ t('pr.detail.linkFiles') }}
            </button>
            <button
              v-if="p.prDetail.value.checksStatus"
              class="pdv-btn pdv-btn--ghost pdv-btn--sm"
              @click="openInBrowser(p.prDetail.value.url + '/checks')"
            >
              {{ t('pr.detail.linkCi') }}
            </button>
          </div>
        </div>

        <!-- Diff tab -->
        <div v-else-if="p.detailTab.value === 'diff'" class="pdv-body pdv-diff-body">
          <div v-if="p.detailLoading.value && !p.prDiffFiles.value.length" class="pdv-loading">
            <div class="pdv-spinner" aria-hidden="true"></div>
            <span>{{ t('pr.detail.loadingDiff') }}</span>
          </div>
          <template v-else-if="p.prDiffFiles.value.length">
            <!-- File sidebar -->
            <div class="pdv-diff-sidebar">
              <div class="pdv-diff-count">{{ t('pr.detail.filesCount', p.prDiffFiles.value.length) }}</div>
              <button
                v-for="file in p.prDiffFiles.value"
                :key="file.path"
                :class="['pdv-diff-file', { 'pdv-diff-file--active': p.selectedDiffFile.value === file.path }]"
                @click="p.selectedDiffFile.value = file.path"
              >
                <div class="pdv-diff-file-top">
                  <span class="pdv-diff-file-name">{{ file.path.split('/').pop() }}</span>
                  <span
                    v-if="p.prComments.value.filter(c => c.path === file.path).length"
                    class="pdv-diff-file-comments"
                  >💬{{ p.prComments.value.filter(c => c.path === file.path).length }}</span>
                </div>
                <span class="pdv-diff-file-path">{{ file.path }}</span>
              </button>
            </div>
            <!-- Diff viewer -->
            <div class="pdv-diff-viewer">
              <PrInlineDiff
                v-if="p.selectedDiff.value"
                :diff="p.selectedDiff.value"
                :file-path="p.selectedDiffFile.value"
                :comments="p.commentsForFile.value"
                :current-user="undefined"
                :review-draft-count="p.draftReviewComments.value.length"
                @create-comment="p.handleCreateComment"
                @add-to-review="p.handleAddToReview"
                @reply-comment="p.handleReplyComment"
                @edit-comment="p.handleEditComment"
                @delete-comment="p.handleDeleteComment"
                @apply-suggestion="p.handleApplySuggestion"
              />
            </div>
          </template>
          <div v-else class="pdv-loading">{{ t('pr.detail.noDiff') }}</div>
        </div>

        <!-- CI tab -->
        <div v-else-if="p.detailTab.value === 'checks'" class="pdv-body pdv-checks-body">
          <div v-if="p.prChecks.value.length === 0" class="pdv-loading">{{ t('pr.detail.noChecks') }}</div>
          <div v-else class="pdv-checks">
            <div v-for="c in p.prChecks.value" :key="c.name" class="pdv-check">
              <span class="pdv-check-icon">{{ p.checkIcon(c) }}</span>
              <span class="pdv-check-name">{{ c.name }}</span>
              <span class="pdv-check-state">{{ c.conclusion || c.state }}</span>
              <button v-if="c.detailsUrl" class="pdv-btn pdv-btn--ghost pdv-btn--sm" @click="openInBrowser(c.detailsUrl)">↗</button>
            </div>
          </div>
        </div>

        <!-- Intelligence tab -->
        <div v-else-if="p.detailTab.value === 'intelligence'" class="pdv-body pdv-intelligence-body">
          <PrIntelligencePanel
            :cwd="''"
            :pr-detail="p.prDetail.value"
            :pr-diff-files="p.prDiffFiles.value"
            :total-repo-files="p.totalRepoFiles.value"
            :conflict-preview="p.conflictPreview.value"
            :conflict-loading="p.conflictLoading.value"
            :conflict-error="p.conflictError.value"
            :hotspots="p.hotspots.value"
            :hotspots-loading="p.hotspotsLoading.value"
            :file-history="p.fileHistory.value"
            :file-history-loading="p.fileHistoryLoading.value"
            @load-conflict-preview="p.loadConflictPreview"
            @load-hotspots="p.loadHotspots"
            @load-file-history="p.loadFileHistory"
          />
        </div>
      </div>
    </template>

    <!-- Review modal (BaseModal handles its own Teleport) -->
    <PrReviewModal
      v-if="p.showReviewModal.value && p.selectedPr.value"
      :pr-number="p.selectedPr.value.number"
      :draft-comments="p.draftReviewComments.value"
      :submitting="p.submittingReview.value"
      @submit="p.handleSubmitReview"
      @close="p.showReviewModal.value = false"
    />
  </div>
</template>

<style scoped>
/* ─── Shell ──────────────────────────────────────────────── */
.pdv-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
}

/* ─── Merge dialog ───────────────────────────────────────── */
.pdv-merge-dialog {
  padding: var(--space-5) var(--space-7);
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg-tertiary));
  flex-shrink: 0;
}
.pdv-merge-prompt {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-md);
  line-height: var(--line-height-snug);
}
.pdv-merge-title {
  color: var(--color-text-muted);
}
.pdv-merge-options {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}
.pdv-merge-opt {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-base);
  cursor: pointer;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  transition: all var(--transition-base);
  flex: 1;
  min-width: 140px;
  justify-content: center;
  font-weight: var(--font-weight-medium);
}
.pdv-merge-opt:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
}
.pdv-merge-opt:has(input:checked) {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 1px var(--color-accent);
}
.pdv-merge-opt input {
  display: none;
}
.pdv-merge-actions {
  display: flex;
  gap: var(--space-3);
}

/* ─── Messages ───────────────────────────────────────────── */
.pdv-msg {
  font-size: var(--font-size-base);
  padding: var(--space-4) var(--space-7);
  flex-shrink: 0;
  line-height: var(--line-height-snug);
}
.pdv-msg--error {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-bottom: 1px solid var(--color-danger);
}
.pdv-msg--success {
  color: var(--color-success);
  background: var(--color-success-soft);
  border-bottom: 1px solid var(--color-success);
  cursor: pointer;
}
.pdv-msg--full {
  padding: var(--space-7);
  font-size: var(--font-size-md);
}

/* ─── Empty state ────────────────────────────────────────── */
.pdv-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
}
.pdv-empty-illustration {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--color-accent-soft), transparent 70%);
  color: var(--color-accent);
  opacity: 0.6;
}
.pdv-empty-label {
  font-size: var(--font-size-md);
}

.pdv-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: pdv-spin 0.8s linear infinite;
}

.pdv-spinner--sm {
  width: 11px;
  height: 11px;
  border-width: 1.5px;
}

@keyframes pdv-spin {
  to { transform: rotate(360deg); }
}

/* SWR background-refresh badge in the hero. */
.pdv-refresh-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
  align-self: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* ─── Hero header ────────────────────────────────────────── */
.pdv-hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-7) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg));
  flex-shrink: 0;
}

.pdv-hero-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-5);
  flex-wrap: wrap;
}

.pdv-hero-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
  flex: 1;
}

.pdv-pr-num {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-accent);
  font-family: var(--font-mono);
  flex-shrink: 0;
  padding: 2px var(--space-3);
  background: var(--color-accent-soft);
  border-radius: var(--radius-sm);
  line-height: 1.4;
}

.pdv-pr-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  line-height: var(--line-height-snug);
  word-break: break-word;
}

.pdv-hero-actions {
  display: flex;
  gap: var(--space-3);
  flex-shrink: 0;
  align-items: center;
}

.pdv-hero-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-size-base);
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.pdv-author {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.pdv-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  font-size: 9px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.pdv-author-name {
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.pdv-meta-sep {
  color: var(--color-text-subtle);
}

.pdv-branch-path {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.pdv-branch {
  padding: 1px var(--space-3);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.pdv-branch-arrow {
  color: var(--color-text-subtle);
}

.pdv-merged-ago {
  color: var(--color-accent);
  font-weight: var(--font-weight-semibold);
}

/* ─── Tabs ───────────────────────────────────────────────── */
.pdv-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}

.pdv-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  margin-bottom: -1px;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
  position: relative;
}

.pdv-tab:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.02);
}

.pdv-tab--active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
  font-weight: var(--font-weight-semibold);
}

.pdv-tab-emoji {
  font-size: var(--font-size-md);
  line-height: 1;
}
.pdv-tab-emoji--sm {
  font-size: var(--font-size-sm);
  opacity: 0.9;
}

.pdv-tab-count {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-size-xs);
  padding: 1px var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
  font-weight: var(--font-weight-semibold);
  line-height: 1.5;
}

.pdv-tab-count--accent {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.pdv-tab-spacer {
  flex: 1;
}

.pdv-review-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  margin: var(--space-3) 0 var(--space-3) var(--space-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
  line-height: 1.4;
  white-space: nowrap;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}
.pdv-review-btn:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-accent);
  color: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.14);
}
.pdv-review-btn:active {
  transform: translateY(0);
  box-shadow: none;
}
.pdv-review-btn-label {
  line-height: 1.4;
}
.pdv-review-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--space-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-text);
  background: rgba(255, 255, 255, 0.22);
  border-radius: var(--radius-pill);
  line-height: 1;
}

.pdv-review-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0 var(--color-accent-soft);
}
.pdv-review-btn--primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-accent-text);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24), 0 0 0 3px var(--color-accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .pdv-review-btn,
  .pdv-review-btn:hover,
  .pdv-review-btn:active {
    transition: none;
    transform: none;
  }
}

/* ─── Content area ───────────────────────────────────────── */
.pdv-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pdv-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-7);
}

/* ─── Info tab ───────────────────────────────────────────── */
.pdv-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.pdv-readiness {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  line-height: var(--line-height-snug);
}
.pdv-readiness-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}
.pdv-readiness--ok {
  background: var(--color-success-soft);
  border: 1px solid var(--color-success);
  color: var(--color-success);
}
.pdv-readiness--wait {
  background: var(--color-warning-soft);
  border: 1px solid var(--color-warning);
  color: var(--color-warning);
  font-weight: var(--font-weight-semibold);
}

/* Stats grid */
.pdv-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-4);
}

.pdv-stat {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast);
  overflow: hidden;
}

.pdv-stat--clickable {
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  width: 100%;
}

.pdv-stat::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 100% at 100% 0%, var(--color-accent-soft), transparent 50%);
  opacity: 0;
  transition: opacity var(--transition-base);
  pointer-events: none;
}

.pdv-stat:hover {
  border-color: var(--color-border-strong);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.pdv-stat:hover::before {
  opacity: 0.4;
}

.pdv-stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.pdv-stat-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.pdv-stat-value {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3);
}

.pdv-stat-emoji {
  font-size: var(--font-size-md);
}

.pdv-stat-diff {
  font-family: var(--font-mono);
}

.pdv-add { color: var(--color-success); font-weight: var(--font-weight-bold); }
.pdv-del { color: var(--color-danger); font-weight: var(--font-weight-bold); }

/* Sections (reviewers, labels, description) */
.pdv-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.pdv-section-label {
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.pdv-section-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
}

.pdv-comments {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.pdv-comment {
  padding: var(--space-4);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.pdv-comment-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.pdv-comment-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  flex-shrink: 0;
}

.pdv-comment-author {
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.pdv-comment-anchor {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: var(--color-bg-tertiary);
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
}

.pdv-comment-time {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pdv-comment-goto {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 1px var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}
.pdv-comment-goto:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.pdv-comment-body {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  word-break: break-word;
}

.pdv-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.pdv-chip {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size-sm);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
}

.pdv-chip--reviewer {
  gap: var(--space-3);
  padding-left: var(--space-2);
}

.pdv-chip-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  font-size: 8px;
  font-weight: var(--font-weight-bold);
  flex-shrink: 0;
}

.pdv-chip--label {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-color: transparent;
}

/* Description head: section label + formatted/raw segmented pill */
.pdv-section--desc {
  gap: var(--space-3);
}
.pdv-desc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.pdv-desc-tabs {
  display: inline-flex;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-pill);
  padding: 2px;
  gap: 2px;
}
.pdv-desc-tab {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  font-family: inherit;
  padding: 2px var(--space-4);
  border-radius: var(--radius-pill);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  line-height: 1.6;
  transition: background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
}
.pdv-desc-tab:hover {
  color: var(--color-text);
}
.pdv-desc-tab--active {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.pdv-desc-body {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.pdv-body-formatted {
  font-size: var(--font-size-md);
  color: var(--color-text);
  line-height: var(--line-height-normal);
  padding: var(--space-5) var(--space-6);
  word-break: break-word;
}

/* Markdown primitives inside the PR description. Mirrors the README
   renderer so `renderMarkdown()` output is styled consistently. */
.pdv-body-formatted :deep(h1),
.pdv-body-formatted :deep(h2),
.pdv-body-formatted :deep(h3),
.pdv-body-formatted :deep(h4),
.pdv-body-formatted :deep(h5),
.pdv-body-formatted :deep(h6) {
  margin: var(--space-5) 0 var(--space-3);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-snug);
  color: var(--color-text);
}
.pdv-body-formatted :deep(h1) {
  font-size: var(--font-size-xl);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  margin-top: 0;
}
.pdv-body-formatted :deep(h2) {
  font-size: var(--font-size-lg);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}
.pdv-body-formatted :deep(h3) { font-size: var(--font-size-md); }
.pdv-body-formatted :deep(p) { margin: 0 0 var(--space-3) 0; }
.pdv-body-formatted :deep(p:last-child) { margin-bottom: 0; }
.pdv-body-formatted :deep(ul),
.pdv-body-formatted :deep(ol) {
  margin: 0 0 var(--space-3) 0;
  padding-left: var(--space-6);
}
.pdv-body-formatted :deep(li) { margin-bottom: var(--space-2); }
.pdv-body-formatted :deep(strong) { font-weight: var(--font-weight-semibold); }
.pdv-body-formatted :deep(.md-code-block) {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-4);
  overflow-x: auto;
  margin: 0 0 var(--space-3) 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
.pdv-body-formatted :deep(.md-inline-code),
.pdv-body-formatted :deep(code),
.pdv-body-formatted :deep(.pr-code) {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  padding: 1px var(--space-2);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}
.pdv-body-formatted :deep(.md-link) {
  color: var(--color-accent);
  text-decoration: none;
}
.pdv-body-formatted :deep(.md-link:hover) { text-decoration: underline; }
.pdv-body-formatted :deep(.md-blockquote) {
  border-left: 3px solid var(--color-accent-soft);
  padding-left: var(--space-5);
  color: var(--color-text-muted);
  margin: 0 0 var(--space-3) 0;
}
.pdv-body-formatted :deep(.md-hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--space-5) 0;
}
.pdv-body-formatted :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 var(--space-4) 0;
  font-size: var(--font-size-sm);
}
.pdv-body-formatted :deep(.md-table th),
.pdv-body-formatted :deep(.md-table td) {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
}
.pdv-body-formatted :deep(.md-table th) {
  background: var(--color-bg-tertiary);
  font-weight: var(--font-weight-semibold);
}
.pdv-body-formatted :deep(img),
.pdv-body-formatted :deep(.md-img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.pdv-body-raw {
  margin: 0;
  padding: var(--space-5) var(--space-6);
  background: var(--color-bg);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
.pdv-body-raw code { font-family: inherit; }

.pdv-muted {
  font-size: var(--font-size-base);
  color: var(--color-text-muted);
  font-style: italic;
  padding: var(--space-4);
  background: var(--color-bg-secondary);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  text-align: center;
}

.pdv-links {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.pdv-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  padding: var(--space-8);
}

/* ─── Diff tab ───────────────────────────────────────────── */
.pdv-diff-body {
  display: flex;
  padding: 0;
  overflow: hidden;
  flex: 1;
}

.pdv-diff-sidebar {
  width: 240px;
  min-width: 200px;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-4);
  background: var(--color-bg-secondary);
}

.pdv-diff-count {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: var(--space-2) var(--space-3) var(--space-4);
}

.pdv-diff-file {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text);
  width: 100%;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.pdv-diff-file:hover {
  background: var(--color-bg-tertiary);
}
.pdv-diff-file--active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.pdv-diff-file-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow: hidden;
}
.pdv-diff-file-name {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.pdv-diff-file-comments {
  font-size: var(--font-size-xs);
  color: var(--color-accent);
  flex-shrink: 0;
}
.pdv-diff-file-path {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pdv-diff-viewer {
  flex: 1;
  overflow: auto;
}

/* ─── CI tab ─────────────────────────────────────────────── */
.pdv-checks-body { overflow-y: auto; }
.pdv-checks {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.pdv-check {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: border-color var(--transition-fast);
}
.pdv-check:hover {
  border-color: var(--color-border-strong);
}
.pdv-check-icon {
  font-size: var(--font-size-lg);
  flex-shrink: 0;
}
.pdv-check-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}
.pdv-check-state {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--font-weight-semibold);
}

/* ─── Intelligence tab ───────────────────────────────────── */
.pdv-intelligence-body {
  padding: 0;
  overflow: hidden;
  flex: 1;
}

/* ─── Action buttons ─────────────────────────────────────── */
.pdv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg-tertiary);
  color: var(--color-text);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
  line-height: var(--line-height-snug);
}
.pdv-btn:hover {
  background: var(--color-bg);
  border-color: var(--color-border-strong);
  color: var(--color-text);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}
.pdv-btn:active {
  box-shadow: none;
}

.pdv-btn--sm {
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
}

.pdv-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-accent-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 0 0 0 var(--color-accent-soft);
}
.pdv-btn--primary:hover {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
  color: var(--color-accent-text);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24), 0 0 0 3px var(--color-accent-soft);
}

.pdv-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--color-text-muted);
}
.pdv-btn--ghost:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text);
  box-shadow: none;
}

.pdv-btn--accent {
  background: var(--color-success, #22863a);
  border-color: var(--color-success, #22863a);
  color: #fff;
}
.pdv-btn--accent:hover {
  background: var(--color-success-hover, #1a6e2e);
  border-color: var(--color-success-hover, #1a6e2e);
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
}

.mono {
  font-family: var(--font-mono);
}

@media (prefers-reduced-motion: reduce) {
  .pdv-btn,
  .pdv-stat,
  .pdv-tab {
    transition: none;
  }
  .pdv-btn:hover,
  .pdv-stat:hover {
    transform: none;
  }
  .pdv-spinner {
    animation: none;
  }
}
</style>
