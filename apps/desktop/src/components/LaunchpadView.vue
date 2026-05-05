<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useLaunchpadWip } from "../composables/useLaunchpadWip";
import { useLaunchpadPrs } from "../composables/useLaunchpadPrs";
import { useLaunchpadIssues } from "../composables/useLaunchpadIssues";
import { useLaunchpadPins } from "../composables/useLaunchpadPins";
import { useI18n } from "../composables/useI18n";
import type { WorkspaceRepo } from "../utils/backend";
import type { IssueFilter } from "../composables/useLaunchpadIssues";

const props = defineProps<{
  repos: WorkspaceRepo[];
}>();

const { t } = useI18n();

const { wip, loading: wipLoading, error: wipError, refresh: refreshWip } = useLaunchpadWip();
const { allPrs, snoozedPrs, repos: prRepos, loading: prsLoading, error: prsError, refresh: refreshPrs } = useLaunchpadPrs();
const { allIssues, snoozedIssues, repos: issueRepos, loading: issuesLoading, error: issuesError, activeFilter: issueFilter, refresh: refreshIssues } = useLaunchpadIssues();
const { pin, unpin, snooze, unsnooze, isPinned, isSnoozed, snoozedUntil } = useLaunchpadPins();

type Tab = "wip" | "prs" | "issues";
const activeTab = ref<Tab>("wip");

// ── ⋮ menu state ──────────────────────────────────────────────────────────────
const openMenuUrl = ref<string | null>(null);
const openSnoozeFor = ref<string | null>(null);

// ── Snoozed bandeau visibility ─────────────────────────────────────────────────
const showSnoozedPrs = ref(false);
const showSnoozedIssues = ref(false);

function setTab(tab: Tab) {
  activeTab.value = tab;
}

function handleRefresh() {
  if (activeTab.value === "wip") refreshWip(props.repos);
  else if (activeTab.value === "prs") refreshPrs(props.repos);
  else refreshIssues(props.repos);
}

function setIssueFilter(filter: IssueFilter) {
  issueFilter.value = filter;
  refreshIssues(props.repos);
}

const isLoading = () => wipLoading.value || prsLoading.value || issuesLoading.value;

// ── Menu helpers ──────────────────────────────────────────────────────────────
function toggleMenu(url: string): void {
  if (openMenuUrl.value === url) {
    openMenuUrl.value = null;
    openSnoozeFor.value = null;
  } else {
    openMenuUrl.value = url;
    openSnoozeFor.value = null;
  }
}

function closeMenu(): void {
  openMenuUrl.value = null;
  openSnoozeFor.value = null;
}

function pinAndClose(url: string, type: "pr" | "issue"): void {
  pin(url, type);
  closeMenu();
}

function unpinAndClose(url: string): void {
  unpin(url);
  closeMenu();
}

function snoozeAndClose(url: string, type: "pr" | "issue", days: 1 | 3 | 7 | 14): void {
  snooze(url, type, days);
  closeMenu();
}

function unsnoozeAndClose(url: string): void {
  unsnooze(url);
  closeMenu();
}

function formatSnoozedUntil(url: string): string {
  const d = snoozedUntil(url);
  if (!d) return "";
  return new Date(d).toLocaleDateString();
}

onMounted(() => {
  refreshWip(props.repos);
  refreshPrs(props.repos);
  refreshIssues(props.repos);
});
</script>

<template>
  <div class="launchpad-view" @click="closeMenu()">
    <div class="launchpad-view__header">
      <h2 class="launchpad-view__title">{{ t("launchpad.title") }}</h2>
      <button
        class="launchpad-view__refresh"
        :disabled="isLoading()"
        @click.stop="handleRefresh"
      >
        {{ isLoading() ? t("launchpad.loading") : t("launchpad.refresh") }}
      </button>
    </div>

    <!-- Tab bar -->
    <div class="launchpad-view__tabs">
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'wip' }"
        @click="setTab('wip')"
      >
        {{ t("launchpad.wipTab") }}
      </button>
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'prs' }"
        @click="setTab('prs')"
      >
        {{ t("launchpad.prsTab") }}
        <span v-if="allPrs.length > 0" class="launchpad-view__tab-badge">
          {{ allPrs.length }}
        </span>
      </button>
      <button
        class="launchpad-view__tab"
        :class="{ 'launchpad-view__tab--active': activeTab === 'issues' }"
        @click="setTab('issues')"
      >
        {{ t("launchpad.issuesTab") }}
        <span v-if="allIssues.length > 0" class="launchpad-view__tab-badge">
          {{ allIssues.length }}
        </span>
      </button>
    </div>

    <!-- WIP tab -->
    <div v-if="activeTab === 'wip'" class="launchpad-view__panel">
      <div v-if="wipError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", wipError) }}
      </div>
      <p v-else-if="!wipLoading && wip.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noRepos") }}
      </p>
      <ul v-else class="launchpad-view__repo-list">
        <li
          v-for="item in wip"
          :key="item.path"
          class="launchpad-view__repo-item"
        >
          <span class="launchpad-view__repo-name">{{ item.name }}</span>
          <span class="launchpad-view__repo-branch">{{ item.branch }}</span>
          <span v-if="item.hasNoUpstream" class="launchpad-view__no-upstream">
            {{ t("launchpad.noUpstream") }}
          </span>
          <template v-else>
            <span v-if="item.ahead > 0" class="launchpad-view__ahead">↑{{ item.ahead }}</span>
            <span v-if="item.behind > 0" class="launchpad-view__behind">↓{{ item.behind }}</span>
          </template>
          <template v-if="item.stagedCount === 0 && item.unstagedCount === 0 && item.untrackedCount === 0">
            <span class="launchpad-view__clean">{{ t("launchpad.clean") }}</span>
          </template>
          <template v-else>
            <span v-if="item.stagedCount > 0" class="launchpad-view__staged">
              {{ t("launchpad.staged", item.stagedCount) }}
            </span>
            <span v-if="item.unstagedCount > 0" class="launchpad-view__unstaged">
              {{ t("launchpad.unstaged", item.unstagedCount) }}
            </span>
            <span v-if="item.untrackedCount > 0" class="launchpad-view__untracked">
              {{ t("launchpad.untracked", item.untrackedCount) }}
            </span>
          </template>
          <span v-if="item.lastCommitAt" class="launchpad-view__last-commit">
            {{ t("launchpad.lastCommit", item.lastCommitAt) }}
          </span>
          <span v-if="item.error" class="launchpad-view__repo-error">{{ item.error }}</span>
        </li>
      </ul>
    </div>

    <!-- PRs tab -->
    <div v-if="activeTab === 'prs'" class="launchpad-view__panel">
      <div v-if="prsError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", prsError) }}
      </div>
      <p v-else-if="!prsLoading && allPrs.length === 0 && snoozedPrs.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noPrs") }}
      </p>
      <ul v-else class="launchpad-view__pr-list">
        <li
          v-for="pr in allPrs"
          :key="`${pr.repoPath}/${pr.number}`"
          class="launchpad-view__pr-item"
        >
          <!-- Pin badge — always visible on pinned items -->
          <span v-if="isPinned(pr.url)" class="launchpad-view__pin-badge" aria-label="Pinned">📌</span>
          <span class="launchpad-view__pr-repo">{{ pr.repoName }}</span>
          <span class="launchpad-view__pr-title">
            <a :href="pr.url" target="_blank" rel="noopener noreferrer">
              #{{ pr.number }} {{ pr.title }}
            </a>
          </span>
          <span v-if="pr.draft" class="launchpad-view__pr-badge launchpad-view__pr-badge--draft">
            {{ t("launchpad.prDraft") }}
          </span>
          <span
            v-if="pr.reviewDecision === 'APPROVED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--approved"
          >
            {{ t("launchpad.prApproved") }}
          </span>
          <span
            v-else-if="pr.reviewDecision === 'CHANGES_REQUESTED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--changes"
          >
            {{ t("launchpad.prChangesRequested") }}
          </span>
          <span
            v-else-if="pr.reviewDecision === 'REVIEW_REQUIRED'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--review"
          >
            {{ t("launchpad.prReviewRequired") }}
          </span>
          <span
            v-if="pr.checksRollup === 'SUCCESS'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-success"
          >
            {{ t("launchpad.prCiSuccess") }}
          </span>
          <span
            v-else-if="pr.checksRollup === 'FAILURE'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-failure"
          >
            {{ t("launchpad.prCiFailure") }}
          </span>
          <span
            v-else-if="pr.checksRollup === 'PENDING'"
            class="launchpad-view__pr-badge launchpad-view__pr-badge--ci-pending"
          >
            {{ t("launchpad.prCiPending") }}
          </span>
          <span class="launchpad-view__pr-labels">
            <span
              v-for="label in pr.labels"
              :key="label"
              class="launchpad-view__pr-label"
            >{{ label }}</span>
          </span>
          <!-- ⋮ action menu -->
          <div class="launchpad-view__item-menu" @click.stop>
            <button
              class="launchpad-view__menu-btn"
              :class="{ 'launchpad-view__menu-btn--open': openMenuUrl === pr.url }"
              :aria-label="`Actions for PR #${pr.number}`"
              @click="toggleMenu(pr.url)"
            >⋮</button>
            <div v-if="openMenuUrl === pr.url" class="launchpad-view__menu-dropdown">
              <button v-if="!isPinned(pr.url)" class="launchpad-view__menu-item" @click="pinAndClose(pr.url, 'pr')">
                📌 {{ t("launchpad.pin") }}
              </button>
              <button v-else class="launchpad-view__menu-item" @click="unpinAndClose(pr.url)">
                📌 {{ t("launchpad.unpin") }}
              </button>
              <template v-if="!isSnoozed(pr.url)">
                <button class="launchpad-view__menu-item" @click="openSnoozeFor = pr.url">
                  💤 {{ t("launchpad.snooze") }}
                </button>
                <div v-if="openSnoozeFor === pr.url" class="launchpad-view__snooze-options">
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 1)">{{ t("launchpad.snooze1d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 3)">{{ t("launchpad.snooze3d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 7)">{{ t("launchpad.snooze1w") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(pr.url, 'pr', 14)">{{ t("launchpad.snooze2w") }}</button>
                </div>
              </template>
              <button v-else class="launchpad-view__menu-item" @click="unsnoozeAndClose(pr.url)">
                💤 {{ t("launchpad.unsnooze") }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <!-- Per-repo errors -->
      <template v-for="repo in prRepos" :key="repo.repoPath">
        <p v-if="repo.error" class="launchpad-view__repo-error">
          {{ repo.repoName }}: {{ repo.error }}
        </p>
      </template>
      <!-- Snoozed PRs bandeau -->
      <div
        v-if="snoozedPrs.length > 0"
        class="launchpad-view__snoozed-bandeau"
        role="button"
        tabindex="0"
        @click="showSnoozedPrs = !showSnoozedPrs"
        @keydown.enter="showSnoozedPrs = !showSnoozedPrs"
      >
        💤 {{ t("launchpad.snoozedCount", snoozedPrs.length) }}
        <span v-if="!showSnoozedPrs" class="launchpad-view__snoozed-show-label">{{ t("launchpad.showSnoozed") }} ▼</span>
        <span v-else class="launchpad-view__snoozed-show-label">▲</span>
      </div>
      <ul v-if="showSnoozedPrs && snoozedPrs.length > 0" class="launchpad-view__snoozed-list">
        <li v-for="pr in snoozedPrs" :key="pr.url" class="launchpad-view__snoozed-item">
          <span class="launchpad-view__pr-repo">{{ pr.repoName }}</span>
          <span class="launchpad-view__snoozed-title">{{ pr.title }}</span>
          <span class="launchpad-view__snoozed-until">{{ t("launchpad.snoozedUntil", formatSnoozedUntil(pr.url)) }}</span>
          <button class="launchpad-view__snooze-cancel" @click="unsnooze(pr.url)">
            {{ t("launchpad.unsnooze") }}
          </button>
        </li>
      </ul>
    </div>

    <!-- Issues tab -->
    <div v-if="activeTab === 'issues'" class="launchpad-view__panel">
      <!-- Filter buttons -->
      <div class="launchpad-view__issue-filters">
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'assigned' }"
          @click="setIssueFilter('assigned')"
        >
          {{ t("launchpad.issueFilterAssigned") }}
        </button>
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'mentioned' }"
          @click="setIssueFilter('mentioned')"
        >
          {{ t("launchpad.issueFilterMentioned") }}
        </button>
        <button
          class="launchpad-view__filter-btn"
          :class="{ 'launchpad-view__filter-btn--active': issueFilter === 'created' }"
          @click="setIssueFilter('created')"
        >
          {{ t("launchpad.issueFilterCreated") }}
        </button>
      </div>

      <div v-if="issuesError" class="launchpad-view__error">
        {{ t("launchpad.errorFetch", issuesError) }}
      </div>
      <p v-else-if="!issuesLoading && allIssues.length === 0 && snoozedIssues.length === 0" class="launchpad-view__empty">
        {{ t("launchpad.noIssues") }}
      </p>
      <ul v-else class="launchpad-view__issue-list">
        <li
          v-for="issue in allIssues"
          :key="`${issue.repoPath}/${issue.number}`"
          class="launchpad-view__issue-item"
        >
          <!-- Pin badge — always visible on pinned items -->
          <span v-if="isPinned(issue.url)" class="launchpad-view__pin-badge" aria-label="Pinned">📌</span>
          <span class="launchpad-view__pr-repo">{{ issue.repoName }}</span>
          <span class="launchpad-view__issue-title">
            <a :href="issue.url" target="_blank" rel="noopener noreferrer">
              #{{ issue.number }} {{ issue.title }}
            </a>
          </span>
          <span v-if="issue.milestone" class="launchpad-view__issue-milestone">
            {{ t("launchpad.issueMilestone", issue.milestone) }}
          </span>
          <span class="launchpad-view__pr-labels">
            <span
              v-for="label in issue.labels"
              :key="label"
              class="launchpad-view__pr-label"
            >{{ label }}</span>
          </span>
          <!-- ⋮ action menu -->
          <div class="launchpad-view__item-menu" @click.stop>
            <button
              class="launchpad-view__menu-btn"
              :class="{ 'launchpad-view__menu-btn--open': openMenuUrl === issue.url }"
              :aria-label="`Actions for issue #${issue.number}`"
              @click="toggleMenu(issue.url)"
            >⋮</button>
            <div v-if="openMenuUrl === issue.url" class="launchpad-view__menu-dropdown">
              <button v-if="!isPinned(issue.url)" class="launchpad-view__menu-item" @click="pinAndClose(issue.url, 'issue')">
                📌 {{ t("launchpad.pin") }}
              </button>
              <button v-else class="launchpad-view__menu-item" @click="unpinAndClose(issue.url)">
                📌 {{ t("launchpad.unpin") }}
              </button>
              <template v-if="!isSnoozed(issue.url)">
                <button class="launchpad-view__menu-item" @click="openSnoozeFor = issue.url">
                  💤 {{ t("launchpad.snooze") }}
                </button>
                <div v-if="openSnoozeFor === issue.url" class="launchpad-view__snooze-options">
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 1)">{{ t("launchpad.snooze1d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 3)">{{ t("launchpad.snooze3d") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 7)">{{ t("launchpad.snooze1w") }}</button>
                  <button class="launchpad-view__menu-item launchpad-view__menu-item--sub" @click="snoozeAndClose(issue.url, 'issue', 14)">{{ t("launchpad.snooze2w") }}</button>
                </div>
              </template>
              <button v-else class="launchpad-view__menu-item" @click="unsnoozeAndClose(issue.url)">
                💤 {{ t("launchpad.unsnooze") }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <!-- Per-repo errors -->
      <template v-for="repo in issueRepos" :key="repo.repoPath">
        <p v-if="repo.error" class="launchpad-view__repo-error">
          {{ repo.repoName }}: {{ repo.error }}
        </p>
      </template>
      <!-- Snoozed Issues bandeau -->
      <div
        v-if="snoozedIssues.length > 0"
        class="launchpad-view__snoozed-bandeau"
        role="button"
        tabindex="0"
        @click="showSnoozedIssues = !showSnoozedIssues"
        @keydown.enter="showSnoozedIssues = !showSnoozedIssues"
      >
        💤 {{ t("launchpad.snoozedCount", snoozedIssues.length) }}
        <span v-if="!showSnoozedIssues" class="launchpad-view__snoozed-show-label">{{ t("launchpad.showSnoozed") }} ▼</span>
        <span v-else class="launchpad-view__snoozed-show-label">▲</span>
      </div>
      <ul v-if="showSnoozedIssues && snoozedIssues.length > 0" class="launchpad-view__snoozed-list">
        <li v-for="issue in snoozedIssues" :key="issue.url" class="launchpad-view__snoozed-item">
          <span class="launchpad-view__pr-repo">{{ issue.repoName }}</span>
          <span class="launchpad-view__snoozed-title">{{ issue.title }}</span>
          <span class="launchpad-view__snoozed-until">{{ t("launchpad.snoozedUntil", formatSnoozedUntil(issue.url)) }}</span>
          <button class="launchpad-view__snooze-cancel" @click="unsnooze(issue.url)">
            {{ t("launchpad.unsnooze") }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.launchpad-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.launchpad-view__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.launchpad-view__title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.launchpad-view__refresh {
  padding: 4px 10px;
  font-size: 0.85rem;
  cursor: pointer;
}

.launchpad-view__refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.launchpad-view__error {
  color: var(--color-danger, #e53e3e);
  font-size: 0.875rem;
}

.launchpad-view__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}

.launchpad-view__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.875rem;
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text, inherit);
}

.launchpad-view__tab--active {
  border-bottom-color: var(--color-accent, #3182ce);
  font-weight: 600;
}

.launchpad-view__tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--color-accent, #3182ce);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
}

.launchpad-view__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__empty {
  color: var(--color-text-muted, #718096);
  font-size: 0.875rem;
  margin: 12px 0;
}

/* WIP list */
.launchpad-view__repo-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launchpad-view__repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
}

.launchpad-view__repo-name { font-weight: 600; min-width: 100px; }
.launchpad-view__repo-branch { color: var(--color-text-muted, #718096); font-family: monospace; font-size: 0.8rem; }
.launchpad-view__ahead { color: var(--color-success, #38a169); }
.launchpad-view__behind { color: var(--color-warning, #d69e2e); }
.launchpad-view__staged { color: var(--color-accent, #3182ce); }
.launchpad-view__unstaged { color: var(--color-warning, #d69e2e); }
.launchpad-view__untracked { color: var(--color-text-muted, #718096); }
.launchpad-view__clean { color: var(--color-success, #38a169); }
.launchpad-view__no-upstream { color: var(--color-text-muted, #718096); font-style: italic; }
.launchpad-view__last-commit { color: var(--color-text-muted, #718096); font-size: 0.8rem; margin-left: auto; }
.launchpad-view__repo-error { color: var(--color-danger, #e53e3e); font-size: 0.8rem; }

/* PR list */
.launchpad-view__pr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__pr-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
  position: relative;
}

.launchpad-view__pr-repo {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  background: var(--color-surface, #edf2f7);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.launchpad-view__pr-title {
  flex: 1;
  min-width: 200px;
  font-weight: 500;
}

.launchpad-view__pr-title a {
  color: inherit;
  text-decoration: none;
}

.launchpad-view__pr-title a:hover {
  text-decoration: underline;
}

.launchpad-view__pr-badge {
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.launchpad-view__pr-badge--draft { background: var(--color-surface, #edf2f7); color: var(--color-text-muted, #718096); }
.launchpad-view__pr-badge--approved { background: #c6f6d5; color: #276749; }
.launchpad-view__pr-badge--changes { background: #fed7d7; color: #9b2c2c; }
.launchpad-view__pr-badge--review { background: #fef3c7; color: #92400e; }
.launchpad-view__pr-badge--ci-success { background: #c6f6d5; color: #276749; }
.launchpad-view__pr-badge--ci-failure { background: #fed7d7; color: #9b2c2c; }
.launchpad-view__pr-badge--ci-pending { background: #fef3c7; color: #92400e; }

.launchpad-view__pr-labels {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.launchpad-view__pr-label {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  background: var(--color-surface, #edf2f7);
  color: var(--color-text-muted, #718096);
}

/* Pin badge */
.launchpad-view__pin-badge {
  font-size: 0.75rem;
  flex-shrink: 0;
}

/* ⋮ menu */
.launchpad-view__item-menu {
  margin-left: auto;
  flex-shrink: 0;
  position: relative;
}

.launchpad-view__menu-btn {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text-muted, #718096);
  line-height: 1;
  transition: opacity 0.1s, background 0.1s;
}

.launchpad-view__pr-item:hover .launchpad-view__menu-btn,
.launchpad-view__issue-item:hover .launchpad-view__menu-btn,
.launchpad-view__menu-btn--open,
.launchpad-view__menu-btn:focus {
  opacity: 1;
}

.launchpad-view__menu-btn:hover {
  background: var(--color-surface, #edf2f7);
}

.launchpad-view__menu-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 100;
  background: var(--color-surface-raised, #f7fafc);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  min-width: 160px;
  padding: 4px 0;
}

.launchpad-view__menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  text-align: left;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--color-text, inherit);
  white-space: nowrap;
}

.launchpad-view__menu-item:hover {
  background: var(--color-surface, #edf2f7);
}

.launchpad-view__menu-item--sub {
  padding-left: 24px;
  font-size: 0.8rem;
  color: var(--color-text-muted, #718096);
}

.launchpad-view__snooze-options {
  border-top: 1px solid var(--color-border, #e2e8f0);
  margin-top: 2px;
  padding-top: 2px;
}

/* Snoozed bandeau */
.launchpad-view__snoozed-bandeau {
  margin-top: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--color-surface, #edf2f7);
  color: var(--color-text-muted, #718096);
  font-size: 0.8rem;
  cursor: pointer;
  user-select: none;
}

.launchpad-view__snoozed-bandeau:hover {
  background: var(--color-border, #e2e8f0);
}

.launchpad-view__snoozed-show-label {
  margin-left: 8px;
  opacity: 0.75;
  font-size: 0.75rem;
}

.launchpad-view__snoozed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.launchpad-view__snoozed-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--color-surface, #edf2f7);
  font-size: 0.8rem;
  opacity: 0.75;
}

.launchpad-view__snoozed-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted, #718096);
}

.launchpad-view__snoozed-until {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  white-space: nowrap;
}

.launchpad-view__snooze-cancel {
  padding: 2px 8px;
  font-size: 0.75rem;
  border-radius: 4px;
  border: 1px solid var(--color-border, #e2e8f0);
  background: none;
  cursor: pointer;
  color: var(--color-text, inherit);
  flex-shrink: 0;
}

.launchpad-view__snooze-cancel:hover {
  background: var(--color-surface-raised, #f7fafc);
}

/* Issues list */
.launchpad-view__issue-filters {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.launchpad-view__filter-btn {
  padding: 3px 10px;
  font-size: 0.8rem;
  border-radius: 12px;
  border: 1px solid var(--color-border, #e2e8f0);
  background: none;
  cursor: pointer;
  color: var(--color-text, inherit);
}

.launchpad-view__filter-btn--active {
  background: var(--color-accent, #3182ce);
  color: #fff;
  border-color: var(--color-accent, #3182ce);
}

.launchpad-view__issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.launchpad-view__issue-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--color-surface-raised, #f7fafc);
  font-size: 0.875rem;
  position: relative;
}

.launchpad-view__issue-title {
  flex: 1;
  min-width: 200px;
  font-weight: 500;
}

.launchpad-view__issue-title a {
  color: inherit;
  text-decoration: none;
}

.launchpad-view__issue-title a:hover {
  text-decoration: underline;
}

.launchpad-view__issue-milestone {
  font-size: 0.75rem;
  color: var(--color-text-muted, #718096);
  background: var(--color-surface, #edf2f7);
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
</style>
