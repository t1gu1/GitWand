<script setup lang="ts">
import { onMounted } from "vue";
import { useLaunchpadWip } from "../composables/useLaunchpadWip";
import { useI18n } from "../composables/useI18n";
import type { WorkspaceRepo } from "../utils/backend";

const props = defineProps<{
  repos: WorkspaceRepo[];
}>();

const { t } = useI18n();
const { wip, loading, error, refresh } = useLaunchpadWip();

onMounted(() => refresh(props.repos));
</script>

<template>
  <div class="launchpad-view">
    <div class="launchpad-view__header">
      <h2 class="launchpad-view__title">{{ t("launchpad.title") }}</h2>
      <button
        class="launchpad-view__refresh"
        :disabled="loading"
        @click="refresh(props.repos)"
      >
        {{ loading ? t("launchpad.loading") : t("launchpad.refresh") }}
      </button>
    </div>

    <div v-if="error" class="launchpad-view__error">
      {{ t("launchpad.errorFetch", error) }}
    </div>

    <div class="launchpad-view__tabs">
      <span class="launchpad-view__tab launchpad-view__tab--active">
        {{ t("launchpad.wipTab") }}
      </span>
    </div>

    <div class="launchpad-view__wip">
      <p v-if="!loading && wip.length === 0" class="launchpad-view__empty">
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
            <span v-if="item.ahead > 0" class="launchpad-view__ahead">
              ↑{{ item.ahead }}
            </span>
            <span v-if="item.behind > 0" class="launchpad-view__behind">
              ↓{{ item.behind }}
            </span>
          </template>

          <template
            v-if="item.stagedCount === 0 && item.unstagedCount === 0 && item.untrackedCount === 0"
          >
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

          <span v-if="item.error" class="launchpad-view__repo-error">
            {{ item.error }}
          </span>
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
  gap: 8px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}

.launchpad-view__tab {
  padding: 6px 12px;
  font-size: 0.875rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.launchpad-view__tab--active {
  border-bottom-color: var(--color-accent, #3182ce);
  font-weight: 600;
}

.launchpad-view__empty {
  color: var(--color-text-muted, #718096);
  font-size: 0.875rem;
  margin: 12px 0;
}

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

.launchpad-view__repo-name {
  font-weight: 600;
  min-width: 100px;
}

.launchpad-view__repo-branch {
  color: var(--color-text-muted, #718096);
  font-family: monospace;
  font-size: 0.8rem;
}

.launchpad-view__ahead { color: var(--color-success, #38a169); }
.launchpad-view__behind { color: var(--color-warning, #d69e2e); }
.launchpad-view__staged { color: var(--color-accent, #3182ce); }
.launchpad-view__unstaged { color: var(--color-warning, #d69e2e); }
.launchpad-view__untracked { color: var(--color-text-muted, #718096); }
.launchpad-view__clean { color: var(--color-success, #38a169); }
.launchpad-view__no-upstream { color: var(--color-text-muted, #718096); font-style: italic; }
.launchpad-view__last-commit { color: var(--color-text-muted, #718096); font-size: 0.8rem; margin-left: auto; }
.launchpad-view__repo-error { color: var(--color-danger, #e53e3e); font-size: 0.8rem; }
</style>
