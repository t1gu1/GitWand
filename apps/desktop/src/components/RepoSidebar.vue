<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { type RepoFileEntry, type ViewMode } from "../composables/useGitRepo";
import { gitRemoteInfo, gitStashList, getGitUser, type GitLogEntry, type GitBranch, type RemoteInfo, type GitUser } from "../utils/backend";
import CommitLog from "./CommitLog.vue";
import PrListSidebar from "./PrListSidebar.vue";
import { useI18n } from "../composables/useI18n";
import { useCommitMessage } from "../composables/useCommitMessage";
import { useAIProvider } from "../composables/useAIProvider";
import { supportedLocales, localeLabels } from "../locales";
import { useAbsorb, type AbsorbCandidate } from "../composables/useAbsorb";

const props = defineProps<{
  /** Repo directory, used by AI commit message generation. */
  cwd: string;
  files: RepoFileEntry[];
  selectedFile: string | null;
  viewMode: ViewMode;
  repoStats: { staged: number; unstaged: number; untracked: number; conflicted: number };
  commitSummary: string;
  commitDescription: string;
  canCommit: boolean;
  isCommitting: boolean;
  // History mode props
  logEntries: GitLogEntry[];
  logLoading: boolean;
  selectedCommitHash: string | null;
  aheadCount: number;
  /** True when the current branch has no upstream (no origin/<branch>). */
  needsPublish?: boolean;
  /** Scope of the commit log: only the current branch, or all refs. */
  logScope: "current" | "all";
  /** Author filter: show all commits, or only those by the current git user. */
  logAuthorFilter: "all" | "mine";
  /** Display name of the current branch (for the toggle label). */
  currentBranch: string;
  /** Files inside the currently-selected untracked directory */
  dirFiles?: string[];
  /** All branches (local + remote) — used by the dashboard sidebar section. */
  branches?: GitBranch[];
  /** Current git user — used to auto-fill Signed-off-by trailer. */
  gitUser?: GitUser | null;
}>();

const emit = defineEmits<{
  select: [path: string, staged: boolean];
  changeView: [mode: ViewMode];
  stageFile: [path: string];
  unstageFile: [path: string];
  stageAll: [];
  /** Stage a specific list of file paths (used by section "+" buttons). */
  stagePaths: [paths: string[]];
  unstageAll: [];
  /** Emitted when user confirms commit; carries the pre-formatted trailer block (may be empty). */
  commit: [trailers: string];
  "update:commitSummary": [value: string];
  "update:commitDescription": [value: string];
  selectCommit: [hash: string];
  editCommit: [entry: GitLogEntry];
  splitCommit: [entry: GitLogEntry];
  // v1.9 — commit context menu actions
  checkoutCommit: [entry: GitLogEntry];
  resetToCommit: [entry: GitLogEntry];
  revertCommit: [entry: GitLogEntry];
  createBranchFromCommit: [entry: GitLogEntry];
  tagCommit: [entry: GitLogEntry];
  cherryPickCommit: [entry: GitLogEntry];
  viewOnForge: [entry: GitLogEntry];
  /** Change the log scope toggle (current branch vs all refs). */
  "update:logScope": [scope: "current" | "all"];
  /** Toggle the author filter (all commits vs mine only). */
  "update:logAuthorFilter": [filter: "all" | "mine"];
  /** Select a specific file inside an expanded untracked directory */
  "select-dir-file": [path: string];
  /** Discard changes to a file (tracked: restore, untracked: delete) */
  discard: [path: string, section: string];
  /** Append file path to .gitignore */
  addToGitignore: [path: string];
  /** Request a full repo state refresh (after absorb, etc.) */
  refresh: [];
  /** Open the stash manager panel. */
  openStash: [];
  openTags: [];
  openWorkspace: [];
  openAgents: [];
}>();

const { t, locale } = useI18n();

// ─── Context menu ─────────────────────────────────────────────
interface CtxMenu {
  visible: boolean;
  x: number;
  y: number;
  file: RepoFileEntry | null;
}
const ctxMenu = ref<CtxMenu>({ visible: false, x: 0, y: 0, file: null });

function openContextMenu(e: MouseEvent, file: RepoFileEntry) {
  e.preventDefault();
  e.stopPropagation();
  ctxMenu.value = { visible: true, x: e.clientX, y: e.clientY, file };
}

function closeContextMenu() {
  ctxMenu.value.visible = false;
}

function onCtxDiscard() {
  if (!ctxMenu.value.file) return;
  emit("discard", ctxMenu.value.file.path, ctxMenu.value.file.section);
  closeContextMenu();
}

function onCtxGitignore() {
  if (!ctxMenu.value.file) return;
  emit("addToGitignore", ctxMenu.value.file.path);
  closeContextMenu();
}

// ─── Absorb ────────────────────────────────────────────
const absorbApi = useAbsorb();
const absorbCandidate = ref<AbsorbCandidate | null>(null);
const absorbError = ref<string | null>(null);

async function onCtxAbsorb() {
  const file = ctxMenu.value.file;
  if (!file || !props.cwd) return;
  closeContextMenu();
  absorbCandidate.value = null;
  absorbError.value = null;

  try {
    const staged = file.section === "staged";
    const results = await absorbApi.analyze(props.cwd, [file.path], staged);
    if (results.length === 0) {
      absorbError.value = t("absorb.noCandidate");
      return;
    }
    absorbCandidate.value = results[0];
    // Confirm. When the AI picked the target because blame returned
    // multiple candidates, flag it in the dialog so the user knows to
    // sanity-check before confirming.
    let msg = t("absorb.confirmDesc")
      .replace("{0}", file.path)
      .replace("{1}", results[0].targetShortHash + " " + results[0].targetMessage);
    if (results[0].aiRanked) {
      msg += `\n\n${t("absorb.aiRanked")}`;
      if (results[0].aiReason) msg += `\n${results[0].aiReason}`;
      if (results[0].alternates && results[0].alternates.length > 0) {
        msg += `\n\n${t("absorb.aiAlternates")}`;
        for (const alt of results[0].alternates) {
          msg += `\n  ${alt.targetShortHash} ${alt.targetMessage}`;
        }
      }
    }
    if (!confirm(msg)) {
      absorbCandidate.value = null;
      return;
    }
    await absorbApi.absorb(props.cwd, results[0]);
    absorbCandidate.value = null;
    // Trigger repo refresh
    emit("refresh");
  } catch (err: unknown) {
    absorbError.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => {
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("contextmenu", closeContextMenu);
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") closeContextMenu();
  });
});
onUnmounted(() => {
  window.removeEventListener("click", closeContextMenu);
  window.removeEventListener("contextmenu", closeContextMenu);
});

// ─── Remote info (for the "Open repository" quick action) ─────
const remoteInfo = ref<RemoteInfo | null>(null);

async function loadRemoteInfo() {
  if (!props.cwd) { remoteInfo.value = null; return; }
  try { remoteInfo.value = await gitRemoteInfo(props.cwd); }
  catch { remoteInfo.value = null; }
}
onMounted(loadRemoteInfo);
watch(() => props.cwd, loadRemoteInfo);

// ─── Stash count (badge on the icon-only stash button) ────────
// Re-fetched on cwd change AND on repo-state mutations (staging a
// file, committing, popping a stash from the modal…), since the
// only in-app stash mutations come from the StashManager modal which
// emits `@refresh` → App.vue calls `repoRefresh()` → props change.
const stashCount = ref<number>(0);

async function loadStashCount() {
  if (!props.cwd) { stashCount.value = 0; return; }
  try {
    const list = await gitStashList(props.cwd);
    stashCount.value = Array.isArray(list) ? list.length : 0;
  } catch {
    stashCount.value = 0;
  }
}
onMounted(loadStashCount);
watch(() => props.cwd, loadStashCount);
// Cheap "repo state mutated" signature — any staged/unstaged/untracked/
// conflicted count delta triggers a reload. Covers stash create (wt goes
// clean) and pop (files come back) via StashManager's refresh emit.
watch(
  () => props.repoStats.staged + props.repoStats.unstaged + props.repoStats.untracked + props.repoStats.conflicted,
  loadStashCount,
);

/**
 * Browser-friendly URL of the current repo's remote, or null if unknown.
 * Prefers a clean `https://<host>/<owner>/<repo>` when the provider is
 * recognized; falls back to normalizing a raw SSH/HTTPS URL otherwise.
 */
const repoWebUrl = computed<string | null>(() => {
  const info = remoteInfo.value;
  if (!info || !info.url) return null;

  const hosts: Record<string, string> = {
    github: "github.com",
    gitlab: "gitlab.com",
    bitbucket: "bitbucket.org",
  };

  if (info.owner && info.repo && info.provider in hosts) {
    return `https://${hosts[info.provider]}/${info.owner}/${info.repo}`;
  }

  // Fallback: normalize the raw URL.
  let u = info.url.trim();
  if (u.endsWith(".git")) u = u.slice(0, -4);
  if (u.startsWith("http://") || u.startsWith("https://")) return u;

  // git@github.com:owner/repo  →  https://github.com/owner/repo
  const sshMatch = u.match(/^(?:ssh:\/\/)?(?:git@)?([^:/]+)[:/](.+)$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  return null;
});

/** Short provider name for the button label ("GitHub", "GitLab", ...) or null. */
const repoProviderName = computed<string | null>(() => {
  const names: Record<string, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    bitbucket: "Bitbucket",
  };
  const p = remoteInfo.value?.provider;
  return p && p in names ? names[p] : null;
});

/** Localized label, e.g. "Open on GitHub" or (fallback) "Open repository". */
const openRepoLabel = computed<string>(() => {
  const name = repoProviderName.value;
  return name ? t("sidebar.openRepoOn", name) : t("sidebar.openRepo");
});

// ─── AI commit message generation ─────────────────────────
const ai = useAIProvider();
const { isGenerating, lastError: aiError, generate: generateCommitMsg, transform: transformCommitMsg } = useCommitMessage();
const aiMenuOpen = ref(false);
const aiLangMenuOpen = ref(false);

// ─── Trailers ────────────────────────────────────────────
const trailerSob = ref(false);
const trailerRbValue = ref("");
const trailerRbEnabled = ref(false);
/** Section is collapsed by default — only experts need it */
const trailerSectionOpen = ref(false);

/** Local git user — loaded eagerly on mount for Signed-off-by auto-fill. */
const localGitUser = ref<GitUser | null>(null);
watch(() => props.cwd, async (cwd) => {
  if (!cwd) return;
  try { localGitUser.value = await getGitUser(cwd); } catch { /* ignore */ }
}, { immediate: true });

/** Resolved git user: prefer locally-fetched, fall back to prop. */
const resolvedGitUser = computed(() => localGitUser.value ?? props.gitUser ?? null);

/** Auto-fill Signed-off-by value from git user. */
const sobValue = computed(() => {
  const u = resolvedGitUser.value;
  if (!u?.name && !u?.email) return "";
  if (u.name && u.email) return `${u.name} <${u.email}>`;
  return u.name || u.email || "";
});

/** Build the formatted trailer block to append to the commit message. */
function buildTrailers(): string {
  const lines: string[] = [];
  if (trailerSob.value && sobValue.value) {
    lines.push(`Signed-off-by: ${sobValue.value}`);
  }
  if (trailerRbEnabled.value && trailerRbValue.value.trim()) {
    lines.push(`Reviewed-by: ${trailerRbValue.value.trim()}`);
  }
  return lines.join("\n");
}

/** Read the commit-message language from settings (empty string = follow UI locale). */
function getCommitMessageLang(): string {
  try {
    const raw = localStorage.getItem("gitwand-settings");
    if (raw) {
      const s = JSON.parse(raw);
      if (s.commitMessageLang) return s.commitMessageLang;
    }
  } catch { /* ignore */ }
  return "";
}

/** Resolve the effective language code for AI generation. */
function resolveCommitLang(): string {
  const explicit = getCommitMessageLang();
  if (explicit) return explicit;
  // Fallback: derive from UI locale
  return locale.value.startsWith("en") ? "en" : locale.value.split("-")[0] || "fr";
}

/** Persist the commit-message language setting. */
function setCommitMessageLang(lang: string) {
  try {
    const raw = localStorage.getItem("gitwand-settings");
    const s = raw ? JSON.parse(raw) : {};
    s.commitMessageLang = lang;
    localStorage.setItem("gitwand-settings", JSON.stringify(s));
  } catch { /* ignore */ }
}

/** Close AI menu when clicking outside */
function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".commit-ai-wrapper")) {
    aiMenuOpen.value = false;
    aiLangMenuOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

function applyMessage(msg: string) {
  const [summary, ...rest] = msg.split("\n");
  emit("update:commitSummary", summary.trim());
  let body = rest.join("\n").trim();

  // Append signature if setting is enabled
  try {
    const raw = localStorage.getItem("gitwand-settings");
    const sig = !raw || JSON.parse(raw).commitSignature !== false;
    if (sig) {
      const signature = "\u{1FA84} Commit via GitWand";
      body = body ? `${body}\n\n${signature}` : signature;
    }
  } catch { /* ignore */ }

  emit("update:commitDescription", body);
}

async function onGenerateCommitMessage() {
  if (!props.cwd || isGenerating.value) return;
  aiMenuOpen.value = false;
  const lang = resolveCommitLang();
  try {
    const msg = await generateCommitMsg(props.cwd, { locale: lang as string });
    applyMessage(msg);
  } catch {
    // lastError is already set by the composable — the UI shows it.
  }
}

async function onAiAction(action: "regenerate" | "shorten" | "detail" | "changeLang", targetLocale?: string) {
  aiMenuOpen.value = false;
  aiLangMenuOpen.value = false;
  if (isGenerating.value) return;
  if (action === "regenerate") {
    await onGenerateCommitMessage();
    return;
  }
  // When changing language, also persist as new default
  if (action === "changeLang" && targetLocale) {
    setCommitMessageLang(targetLocale);
  }
  const currentMsg = [props.commitSummary, props.commitDescription].filter(Boolean).join("\n");
  if (!currentMsg.trim()) return;
  try {
    const msg = await transformCommitMsg(action, currentMsg, targetLocale);
    applyMessage(msg);
  } catch {
    // aiError is set by the composable.
  }
}

const sections = computed(() => {
  const map: Record<string, RepoFileEntry[]> = {
    conflicted: [],
    staged: [],
    unstaged: [],
    untracked: [],
  };
  for (const f of props.files) {
    map[f.section].push(f);
  }
  return map;
});

const sectionMeta = computed((): Record<string, { label: string; color: string; icon: string }> => ({
  conflicted: { label: t('sidebar.sectionConflicts'), color: "var(--color-danger)", icon: "!" },
  staged: { label: t('sidebar.sectionStaged'), color: "var(--color-success)", icon: "+" },
  unstaged: { label: t('sidebar.sectionModified'), color: "var(--color-warning)", icon: "~" },
  untracked: { label: t('sidebar.sectionUntracked'), color: "var(--color-text-muted)", icon: "?" },
}));

function statusBadge(status: string): string {
  const map: Record<string, string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };
  return map[status] ?? "?";
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    added: "var(--color-success)",
    modified: "var(--color-warning)",
    deleted: "var(--color-danger)",
    renamed: "var(--color-accent)",
  };
  return map[status] ?? "var(--color-text-muted)";
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function fileDir(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
}

const totalChanges = computed(() => props.files.length);

const unstagedCount = computed(() => props.repoStats.unstaged + props.repoStats.untracked);

function onStageClick(e: Event, path: string) {
  e.stopPropagation();
  emit("stageFile", path);
}

function onUnstageClick(e: Event, path: string) {
  e.stopPropagation();
  emit("unstageFile", path);
}

function onSummaryInput(e: Event) {
  emit("update:commitSummary", (e.target as HTMLInputElement).value);
}

// ─── Conventional Commits prefix picker ──────────────────
const CC_TYPES = ["feat", "fix", "docs", "chore", "refactor", "test", "style", "perf", "ci"] as const;
const CC_PREFIX_RE = /^([a-z]+)(\([^)]*\))?!?:\s*/;

/** The active type prefix extracted from the current summary, or "" if none. */
const activePrefix = computed(() => {
  const m = props.commitSummary.match(CC_PREFIX_RE);
  return m ? m[1] : "";
});

function setCommitType(type: string) {
  // Strip any existing conventional prefix first
  const bare = props.commitSummary.replace(CC_PREFIX_RE, "");
  // Toggle: clicking the same type removes it
  const next = type && type !== activePrefix.value ? `${type}: ${bare}` : bare;
  emit("update:commitSummary", next);
}

function onDescriptionInput(e: Event) {
  emit("update:commitDescription", (e.target as HTMLTextAreaElement).value);
}

function onCommitKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    if (props.canCommit) emit("commit", buildTrailers());
  }
}

// ─── Dashboard sidebar helpers ────────────────────────────────
/** Local branches sorted with the current branch first, then by activity. */
const pinnedBranches = computed(() => {
  const list = (props.branches ?? []).filter((b) => !b.isRemote);
  return list
    .slice()
    .sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return (b.ahead + b.behind) - (a.ahead + a.behind);
    })
    .slice(0, 5);
});

/** Up to 3 most recent commits — shown as a mini-activity feed. */
const recentActivity = computed(() => props.logEntries.slice(0, 3));

function activityInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function activityAvatarStyle(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`,
  };
}

function formatActivityDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return t("date.now");
  if (diffMins < 60) return t("date.minutesAgo", diffMins);
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return t("date.hoursAgo", diffHrs);
  const diffDays = Math.floor(diffHrs / 24);
  return t("date.daysAgo", diffDays);
}
</script>

<template>
  <nav class="repo-sidebar" :aria-label="t('sidebar.tabChanges')">
    <!-- ── Navigation tabs (content-switching) ─────────────────── -->
    <div class="view-tabs">
      <button
        class="view-tab"
        :class="{ 'view-tab--active': viewMode === 'changes' }"
        @click="emit('changeView', 'changes')"
      >
        {{ t('sidebar.tabChanges') }}
        <span class="tab-badge" v-if="totalChanges > 0">{{ totalChanges }}</span>
      </button>
      <button
        class="view-tab"
        :class="{ 'view-tab--active': viewMode === 'history' }"
        @click="emit('changeView', 'history')"
      >
        {{ t('sidebar.tabLog') }}
      </button>
      <button
        class="view-tab"
        :class="{ 'view-tab--active': viewMode === 'graph' }"
        @click="emit('changeView', 'graph')"
      >
        {{ t('sidebar.tabGraph') }}
      </button>
      <button
        class="view-tab view-tab--pr"
        :class="{ 'view-tab--active': viewMode === 'prs' }"
        @click="emit('changeView', 'prs')"
      >
        PRs
      </button>
    </div>

    <!-- File sections -->
    <div class="sections" v-if="viewMode === 'changes'">
      <template v-for="sectionKey in ['conflicted', 'staged', 'unstaged', 'untracked']" :key="sectionKey">
        <div
          v-if="sections[sectionKey].length > 0"
          class="section"
        >
          <div class="section-header">
            <span class="section-icon" :style="{ color: sectionMeta[sectionKey].color }">
              {{ sectionMeta[sectionKey].icon }}
            </span>
            <span class="section-label">{{ sectionMeta[sectionKey].label }}</span>
            <span class="section-count">{{ sections[sectionKey].length }}</span>
            <!-- Stage all / Unstage all buttons -->
            <button
              v-if="sectionKey === 'unstaged' || sectionKey === 'untracked'"
              class="section-action"
              @click="emit('stagePaths', sections[sectionKey].map(f => f.path))"
              :title="t('sidebar.stageAll')"
            >+</button>
            <button
              v-if="sectionKey === 'staged'"
              class="section-action"
              @click="emit('unstageAll')"
              :title="t('sidebar.unstageAll')"
            >-</button>
          </div>

          <ul class="file-items" role="listbox">
            <template
              v-for="file in sections[sectionKey]"
              :key="`${file.section}-${file.path}`"
            >
              <!-- Directory or regular file item -->
              <li
                class="file-item"
                :class="{ 'file-item--selected': selectedFile === file.path }"
                role="option"
                :aria-selected="selectedFile === file.path"
                tabindex="0"
                @click="emit('select', file.path, file.section === 'staged')"
                @keydown.enter="emit('select', file.path, file.section === 'staged')"
                @keydown.space.prevent="emit('select', file.path, file.section === 'staged')"
                @contextmenu.prevent.stop="openContextMenu($event, file)"
              >
                <span
                  class="file-status-badge mono"
                  :style="{ color: statusColor(file.status) }"
                  :title="file.status"
                >
                  {{ statusBadge(file.status) }}
                </span>
                <div class="file-info">
                  <span class="file-name mono">{{ fileName(file.path) }}</span>
                  <span class="file-dir muted" v-if="fileDir(file.path)">{{ fileDir(file.path) }}</span>
                </div>
                <!-- Stage / Unstage per file -->
                <button
                  v-if="file.section === 'unstaged' || file.section === 'untracked'"
                  class="file-action"
                  @click="onStageClick($event, file.path)"
                  :title="t('sidebar.stage')"
                >+</button>
                <button
                  v-if="file.section === 'staged'"
                  class="file-action"
                  @click="onUnstageClick($event, file.path)"
                  :title="t('sidebar.unstage')"
                >-</button>
              </li>

              <!-- Sub-files for expanded untracked directory -->
              <!-- Stay expanded when directory OR one of its sub-files is selected -->
              <li
                v-if="file.path.endsWith('/') && dirFiles?.length && (selectedFile === file.path || dirFiles.includes(selectedFile ?? ''))"
                v-for="subFile in dirFiles"
                :key="`dir-sub-${subFile}`"
                class="file-item file-item--sub"
                :class="{ 'file-item--selected': selectedFile === subFile }"
                role="option"
                tabindex="0"
                @click.stop="emit('select-dir-file', subFile)"
                @keydown.enter.stop="emit('select-dir-file', subFile)"
              >
                <span class="file-status-badge mono file-status-badge--added">A</span>
                <div class="file-info">
                  <span class="file-name mono">{{ fileName(subFile) }}</span>
                  <span class="file-dir muted">{{ subFile }}</span>
                </div>
              </li>
            </template>
          </ul>
        </div>
      </template>

      <!-- Empty state -->
      <div class="empty-section" v-if="totalChanges === 0">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 12l2 2 4-4" stroke="var(--color-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="9" stroke="var(--color-success)" stroke-width="1.5" opacity="0.4"/>
        </svg>
        <span class="empty-text">{{ t('sidebar.cleanTree') }}</span>
      </div>

    </div>

    <!-- Commit panel — fixed at bottom, always visible in changes view -->
    <div class="commit-panel" v-if="viewMode === 'changes'">
      <!-- Conventional Commits type picker -->
      <div class="cc-types" :title="t('sidebar.ccTypesTitle')">
        <button
          v-for="type in CC_TYPES"
          :key="type"
          class="cc-chip"
          :class="{ 'cc-chip--active': activePrefix === type }"
          @click="setCommitType(type)"
          :title="t(`sidebar.ccType_${type}`)"
        >{{ type }}</button>
      </div>
      <div class="commit-summary-row">
        <input
          class="commit-summary mono"
          type="text"
          :value="commitSummary"
          @input="onSummaryInput"
          @keydown="onCommitKeydown"
          :placeholder="t('sidebar.summaryPlaceholder')"
        />
        <!-- AI commit message: split-button with dropdown -->
        <div v-if="ai.isAvailable.value" class="commit-ai-wrapper">
          <button
            class="commit-ai-btn"
            :class="{ 'commit-ai-btn--loading': isGenerating }"
            :disabled="isGenerating || repoStats.staged === 0"
            :title="isGenerating ? t('sidebar.aiGeneratingTooltip') : t('sidebar.aiGenerateTooltip')"
            @click="onGenerateCommitMessage"
          >
            <svg v-if="isGenerating" class="commit-spinner" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
              <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2l1.5 3.5L13 7l-3.5 1.5L8 12l-1.5-3.5L3 7l3.5-1.5L8 2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
            </svg>
          </button>
          <button
            class="commit-ai-chevron"
            :disabled="isGenerating"
            @click.stop="aiMenuOpen = !aiMenuOpen"
            aria-label="AI actions"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <ul v-if="aiMenuOpen" class="commit-ai-menu">
            <li @click="onAiAction('regenerate')" :class="{ disabled: repoStats.staged === 0 }">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 0110.47-4M14 8a6 6 0 01-10.47 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M12 1v3h-3M4 15v-3h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ t('sidebar.aiRegenerate') }}
            </li>
            <li @click="onAiAction('shorten')" :class="{ disabled: !commitSummary }">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h6M3 12h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              {{ t('sidebar.aiShorten') }}
            </li>
            <li @click="onAiAction('detail')" :class="{ disabled: !commitSummary }">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              {{ t('sidebar.aiDetail') }}
            </li>
            <li class="commit-ai-menu-parent" :class="{ disabled: !commitSummary }" @click.stop="commitSummary && (aiLangMenuOpen = !aiLangMenuOpen)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 8h11M8 2.5c-1.5 2-1.5 9 0 11M8 2.5c1.5 2 1.5 9 0 11" stroke="currentColor" stroke-width="1.2"/></svg>
              {{ t('sidebar.aiChangeLang') }}
              <svg class="commit-ai-menu-arrow" width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M3 1.5L5.5 4L3 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <ul v-if="aiLangMenuOpen" class="commit-ai-submenu">
                <li v-for="loc in supportedLocales" :key="loc" @click.stop="onAiAction('changeLang', loc)" :class="{ 'is-active': loc === resolveCommitLang() }">
                  <svg v-if="loc === resolveCommitLang()" class="commit-ai-check" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {{ localeLabels[loc] }}
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
      <!-- AI error feedback -->
      <div v-if="aiError" class="commit-ai-error">{{ aiError }}</div>
      <textarea
        class="commit-description mono"
        :value="commitDescription"
        @input="onDescriptionInput"
        @keydown="onCommitKeydown"
        :placeholder="t('sidebar.descriptionPlaceholder')"
        rows="4"
      ></textarea>
      <!-- Trailers — collapsed by default, unlocked by a toggle -->
      <div class="commit-trailers">
        <button
          type="button"
          class="trailer-toggle"
          :class="{ 'trailer-toggle--open': trailerSectionOpen }"
          @click="trailerSectionOpen = !trailerSectionOpen"
          :title="t('sidebar.trailerToggleTitle')"
        >
          <svg class="trailer-toggle-caret" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2.5 3.5L5 6l2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ t('sidebar.trailerToggleLabel') }}</span>
          <!-- Dot when any trailer is active -->
          <span v-if="trailerSob || trailerRbEnabled" class="trailer-active-dot" :title="t('sidebar.trailerActiveTitle')"></span>
        </button>

        <template v-if="trailerSectionOpen">
          <!-- Signed-off-by -->
          <label v-if="sobValue" class="trailer-row">
            <input type="checkbox" v-model="trailerSob" class="trailer-check" />
            <span class="trailer-main-label">{{ t('sidebar.trailerSobLabel') }}</span>
            <span class="trailer-git-key">Signed-off-by</span>
            <button type="button" class="trailer-help" :title="t('sidebar.trailerSobHelp')" tabindex="-1" @click.prevent>?</button>
          </label>
          <div v-if="trailerSob && sobValue" class="trailer-value-line">{{ sobValue }}</div>

          <!-- Reviewed-by -->
          <label class="trailer-row">
            <input type="checkbox" v-model="trailerRbEnabled" class="trailer-check" />
            <span class="trailer-main-label">{{ t('sidebar.trailerRbLabel') }}</span>
            <span class="trailer-git-key">Reviewed-by</span>
            <button type="button" class="trailer-help" :title="t('sidebar.trailerRbHelp')" tabindex="-1" @click.prevent>?</button>
          </label>
          <input
            v-if="trailerRbEnabled"
            v-model="trailerRbValue"
            type="text"
            class="trailer-input"
            :placeholder="t('sidebar.trailerRbPlaceholder')"
            @click.stop
          />
        </template>
      </div>
      <div class="commit-actions">
        <button
          class="commit-stage-all"
          v-if="unstagedCount > 0"
          @click="emit('stageAll')"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span>{{ t('sidebar.stageAllButton', unstagedCount) }}</span>
        </button>
        <button
          class="commit-btn"
          :class="{ 'commit-btn--disabled': !canCommit }"
          :disabled="!canCommit"
          @click="emit('commit', buildTrailers())"
        >
          <svg v-if="isCommitting" class="commit-spinner" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
            <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.5 3.5l-7 7L3 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ isCommitting ? t('sidebar.commitButtonLoading') : t('sidebar.commitButton', repoStats.staged) }}</span>
        </button>
      </div>
      <span class="commit-hint muted">{{ t('sidebar.commitHint') }}</span>
    </div>

    <!-- History view: commit log in sidebar -->
    <div class="sidebar-log" v-if="viewMode === 'history'">
      <!-- Scope toggle: current branch vs all refs -->
      <div
        class="log-scope-toggle"
        role="tablist"
        :aria-label="t('sidebar.logScopeLabel')"
      >
        <button
          class="log-scope-btn"
          :class="{ 'log-scope-btn--active': logScope === 'current' }"
          role="tab"
          :aria-selected="logScope === 'current'"
          :title="currentBranch ? t('sidebar.logScopeCurrentTitle', currentBranch) : t('sidebar.logScopeCurrent')"
          @click="emit('update:logScope', 'current')"
        >
          {{ t('sidebar.logScopeCurrent') }}
        </button>
        <button
          class="log-scope-btn"
          :class="{ 'log-scope-btn--active': logScope === 'all' }"
          role="tab"
          :aria-selected="logScope === 'all'"
          :title="t('sidebar.logScopeAllTitle')"
          @click="emit('update:logScope', 'all')"
        >
          {{ t('sidebar.logScopeAll') }}
        </button>
      </div>
      <!-- Author filter: all commits vs mine only -->
      <div class="log-author-filter">
        <button
          class="log-author-btn"
          :class="{ 'log-author-btn--active': logAuthorFilter === 'mine' }"
          :aria-pressed="logAuthorFilter === 'mine'"
          :title="logAuthorFilter === 'mine' ? t('sidebar.logAuthorMineTitle') : t('sidebar.logAuthorAllTitle')"
          @click="emit('update:logAuthorFilter', logAuthorFilter === 'mine' ? 'all' : 'mine')"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" style="flex-shrink:0">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          {{ t('sidebar.logAuthorMine') }}
        </button>
      </div>
      <CommitLog
        :entries="logEntries"
        :loading="logLoading"
        :selected-hash="selectedCommitHash"
        :ahead-count="aheadCount"
        :needs-publish="needsPublish"
        @select-commit="(hash: string) => emit('selectCommit', hash)"
        @edit-commit="(entry) => emit('editCommit', entry)"
        @split-commit="(entry) => emit('splitCommit', entry)"
        @checkout-commit="(entry) => emit('checkoutCommit', entry)"
        @reset-to-commit="(entry) => emit('resetToCommit', entry)"
        @revert-commit="(entry) => emit('revertCommit', entry)"
        @create-branch-from-commit="(entry) => emit('createBranchFromCommit', entry)"
        @tag-commit="(entry) => emit('tagCommit', entry)"
        @cherry-pick-commit="(entry) => emit('cherryPickCommit', entry)"
        @view-on-forge="(entry) => emit('viewOnForge', entry)"
      />
    </div>

    <!-- PRs view: compact PR list in sidebar -->
    <div class="sidebar-prs" v-if="viewMode === 'prs'">
      <PrListSidebar />
    </div>

    <!-- Dashboard view: pinned branches, activity, quick actions -->
    <div class="sidebar-dashboard" v-if="viewMode === 'dashboard'">
      <!-- Pinned branches -->
      <div class="side-block">
        <div class="side-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="12" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          {{ t('sidebar.pinnedBranches') }}
        </div>
        <div class="branch-list">
          <button
            v-for="b in pinnedBranches"
            :key="b.name"
            class="branch-item"
            :class="{ 'branch-item--current': b.isCurrent }"
            @click="emit('changeView', 'graph')"
            :title="b.name"
          >
            <span class="branch-name mono">{{ b.name }}</span>
            <span class="branch-indicator" v-if="b.ahead > 0 || b.behind > 0">
              <span v-if="b.ahead > 0" class="branch-up">↑{{ b.ahead }}</span>
              <span v-if="b.behind > 0" class="branch-down">↓{{ b.behind }}</span>
            </span>
          </button>
          <div class="side-empty" v-if="pinnedBranches.length === 0">
            {{ t('sidebar.noBranches') }}
          </div>
        </div>
      </div>

      <!-- Recent activity -->
      <div class="side-block" v-if="recentActivity.length > 0">
        <div class="side-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          {{ t('sidebar.recentActivity') }}
        </div>
        <button
          v-for="c in recentActivity"
          :key="c.hashFull"
          class="activity-item"
          @click="emit('changeView', 'history')"
          :title="c.message"
        >
          <span class="activity-dot" :style="activityAvatarStyle(c.email || c.author)">
            {{ activityInitials(c.author) }}
          </span>
          <div class="activity-body">
            <div class="activity-msg">{{ c.message }}</div>
            <div class="activity-time">{{ formatActivityDate(c.date) }}</div>
          </div>
        </button>
      </div>

      <!-- Quick actions -->
      <div class="side-block">
        <div class="side-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          {{ t('sidebar.quickActions') }}
        </div>
        <div class="quick-actions">
          <button class="qa" @click="emit('changeView', 'changes')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {{ t('sidebar.tabChanges') }}
          </button>
          <button class="qa" @click="emit('changeView', 'history')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
            </svg>
            {{ t('sidebar.tabLog') }}
          </button>
          <button class="qa" @click="emit('changeView', 'graph')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="12" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            {{ t('sidebar.tabGraph') }}
          </button>
          <button class="qa" @click="emit('changeView', 'prs')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>
            </svg>
            PRs
          </button>
          <a
            v-if="repoWebUrl"
            class="qa qa--full"
            :href="repoWebUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="repoWebUrl"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            {{ openRepoLabel }}
          </a>
        </div>
      </div>
    </div>
    <!-- ── Footer toolbar (utility actions + dashboard) ───────── -->
    <div class="sidebar-footer">
      <button
        class="sf-btn"
        :class="{ 'sf-btn--active': viewMode === 'dashboard' }"
        @click="emit('changeView', 'dashboard')"
        :title="t('sidebar.tabDashboard')"
        :aria-label="t('sidebar.tabDashboard')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
        </svg>
        <span class="sf-btn__label">{{ t('sidebar.tabDashboard') }}</span>
      </button>
      <div class="sf-sep" aria-hidden="true"></div>
      <button
        class="sf-btn"
        @click="emit('openStash')"
        :title="t('sidebar.stashTitle')"
        :aria-label="t('sidebar.stashTitle')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 8v13H3V8"/>
          <path d="M1 3h22v5H1z"/>
          <path d="M10 12h4"/>
        </svg>
        <span class="sf-btn__label">{{ t('sidebar.stashTitle') }}<template v-if="stashCount > 0"> ({{ stashCount }})</template></span>
      </button>
      <button
        class="sf-btn"
        @click="emit('openTags')"
        :title="t('tags.title')"
        :aria-label="t('tags.title')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 2h6l6 6-6 6-6-6V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/>
        </svg>
        <span class="sf-btn__label">{{ t('tags.title') }}</span>
      </button>
      <button
        class="sf-btn"
        @click="emit('openWorkspace')"
        :title="t('workspace.title')"
        :aria-label="t('workspace.title')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <rect x="1" y="4" width="14" height="10" rx="2"/>
          <path d="M1 7h14M5 4V3a2 2 0 014 0v1" stroke-linejoin="round"/>
        </svg>
        <span class="sf-btn__label">{{ t('workspace.title') }}</span>
      </button>
      <button
        class="sf-btn"
        @click="emit('openAgents')"
        :title="t('agents.sidebarTooltip')"
        :aria-label="t('agents.title')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M12 2v4M8 11V9a4 4 0 0 1 8 0v2"/>
          <circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/>
          <path d="M9 20h6"/>
        </svg>
        <span class="sf-btn__label">{{ t('agents.title') }}</span>
      </button>
    </div>
  </nav>

  <!-- Context menu (Teleport to body to avoid overflow clipping) -->
  <Teleport to="body">
    <div
      v-if="ctxMenu.visible && ctxMenu.file"
      class="ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <!-- Discard : libellé selon la section -->
      <button
        v-if="ctxMenu.file.section !== 'staged'"
        class="ctx-item ctx-item--danger"
        @click="onCtxDiscard"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span>{{ ctxMenu.file.section === 'untracked' ? t('sidebar.ctxDeleteFile') : t('sidebar.ctxDiscardChanges') }}</span>
      </button>

      <!-- Separator -->
      <div class="ctx-separator" v-if="ctxMenu.file.section !== 'staged'"></div>

      <!-- Absorb into original commit -->
      <button
        v-if="ctxMenu.file.section === 'unstaged' || ctxMenu.file.section === 'staged'"
        class="ctx-item"
        @click="onCtxAbsorb"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="4" r="2.5" stroke="currentColor" stroke-width="1.3"/>
          <circle cx="8" cy="12" r="2.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M8 6.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <path d="M5.5 8l2.5 2 2.5-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ t('absorb.action') }}</span>
      </button>

      <div class="ctx-separator" v-if="ctxMenu.file.section === 'unstaged' || ctxMenu.file.section === 'staged'"></div>

      <!-- Add to .gitignore -->
      <button class="ctx-item" @click="onCtxGitignore">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.5"/>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>{{ t('sidebar.ctxAddToGitignore') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.repo-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.view-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.view-tabs::-webkit-scrollbar {
  display: none;
}

.view-tab {
  flex: 1 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-3);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
  background: none;
  border-bottom: 2px solid transparent;
  transition: color var(--transition-hover), border-color var(--transition-hover);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-tab:hover {
  color: var(--color-text);
}

.view-tab--active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}

/* ── Footer toolbar ────────────────────────────────────────── */
.sidebar-footer {
  display: flex;
  align-items: stretch;
  gap: 1px;
  padding: 4px 6px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
  /* Always pin to the bottom of the flex column, regardless of content height */
  margin-top: auto;
  background: var(--color-bg-secondary, var(--color-surface-alt, rgba(0,0,0,0.03)));
}

.sf-sep {
  width: 1px;
  align-self: stretch;
  background: var(--color-border);
  margin: 4px 4px;
  flex-shrink: 0;
}

.sf-btn {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 6px;
  min-width: 38px;
  border-radius: var(--radius-sm, 5px);
  background: none;
  color: var(--color-text-muted);
  border: 1px solid transparent;
  cursor: pointer;
  transition: color var(--transition-hover), background var(--transition-hover);
  flex-shrink: 0;
}

.sf-btn:hover {
  color: var(--color-text);
  background: var(--color-bg-tertiary, rgba(0,0,0,0.06));
}

.sf-btn--active {
  color: var(--color-accent);
  background: var(--color-accent-soft, rgba(99,102,241,0.1));
}

.sf-btn--active:hover {
  background: var(--color-accent-soft, rgba(99,102,241,0.15));
}

.sf-btn__label {
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  color: inherit;
}

.sf-btn__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  font-size: 8px;
  font-weight: var(--font-weight-semibold);
  line-height: 13px;
  text-align: center;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: var(--radius-pill);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.tab-badge {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  background: var(--color-accent);
  color: var(--color-accent-text);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-variant-numeric: tabular-nums;
}

.sections {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sidebar-log {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Log scope toggle (current branch vs all refs) */
.log-scope-toggle {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.log-scope-btn {
  flex: 1;
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background var(--transition-hover), color var(--transition-hover), border-color var(--transition-hover);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

.log-scope-btn:hover {
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--color-text);
}

.log-scope-btn--active {
  background: var(--color-accent, #3b82f6);
  color: var(--color-accent-text, #ffffff);
  border-color: var(--color-accent, #3b82f6);
}

.log-scope-btn--active:hover {
  background: var(--color-accent, #3b82f6);
  color: var(--color-accent-text, #ffffff);
}

/* Author filter row */
.log-author-filter {
  display: flex;
  padding: var(--space-2) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.log-author-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background var(--transition-hover), color var(--transition-hover), border-color var(--transition-hover);
  white-space: nowrap;
}

.log-author-btn:hover {
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--color-text);
}

.log-author-btn--active {
  background: var(--color-accent, #3b82f6);
  color: var(--color-accent-text, #ffffff);
  border-color: var(--color-accent, #3b82f6);
}

.log-author-btn--active:hover {
  background: var(--color-accent, #3b82f6);
  color: var(--color-accent-text, #ffffff);
}

.sidebar-prs {
  flex: 1;
  overflow: hidden;
}

.section {
  border-bottom: 1px solid var(--color-border);
}

.section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
  background: var(--color-bg);
  position: sticky;
  top: 0;
  z-index: 1;
}

.section-icon {
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  width: 16px;
  text-align: center;
}

.section-label {
  flex: 1;
}

.section-count {
  font-variant-numeric: tabular-nums;
  background: var(--color-bg-tertiary);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
}

.section-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  background: none;
  transition: background var(--transition-hover), color var(--transition-hover);
}

.section-action:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.file-items {
  list-style: none;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6) var(--space-3) 18px;
  cursor: pointer;
  transition: background var(--transition-hover);
  border-left: 3px solid transparent;
}

.file-item:hover {
  background: var(--color-bg-tertiary);
}

.file-item--selected {
  background: var(--color-bg-tertiary);
  border-left-color: var(--color-accent);
}

/* Sub-files inside an expanded untracked directory */
.file-item--sub {
  padding-left: 30px;
  background: var(--color-bg);
  border-left-color: transparent;
  border-left-width: 1px;
  position: relative;
}

.file-item--sub::before {
  content: '';
  position: absolute;
  left: 17px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
}

.file-item--sub:first-of-type::before {
  top: 50%;
}

.file-item--sub:hover {
  background: var(--color-bg-tertiary);
}

.file-item--sub.file-item--selected {
  background: var(--color-bg-tertiary);
  border-left-color: var(--color-accent);
}

.file-item:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.file-status-badge {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.file-status-badge--added { color: var(--color-status-added); }

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.file-name {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-dir {
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-muted);
  background: none;
  opacity: 0;
  transition: opacity var(--transition-hover), background var(--transition-hover), color var(--transition-hover);
  flex-shrink: 0;
}

.file-item:hover .file-action {
  opacity: 1;
}

.file-action:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.empty-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  padding: var(--space-10) var(--space-7);
}

.empty-text {
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
}

/* Commit panel — fixed at bottom of sidebar */
.commit-panel {
  border-top: 1px solid var(--color-border);
  padding: var(--space-5) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}

.commit-summary-row {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.commit-summary {
  flex: 1;
  min-width: 0;
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  transition: border-color var(--transition-hover);
}

.commit-ai-wrapper {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

/*
 * Split-button: main sparkle action + dropdown chevron for alternative AI
 * actions. We keep the split because the chevron opens a menu — the
 * global `.btn--ai` can't represent that affordance on its own. Color
 * comes from the shared `--color-ai` token so it still reads as "AI"
 * and not "brand accent".
 */
.commit-ai-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  background: var(--color-ai-soft);
  color: var(--color-ai);
  border: 1px solid var(--color-ai);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-hover), border-color var(--transition-hover), color var(--transition-hover);
}

.commit-ai-chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  background: var(--color-ai-soft);
  color: var(--color-ai);
  border: 1px solid var(--color-ai);
  margin-left: -1px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  cursor: pointer;
  transition: background var(--transition-hover), border-color var(--transition-hover);
}

.commit-ai-chevron:hover:not(:disabled) {
  background: var(--color-ai);
  color: var(--color-ai-text);
  z-index: 1;
}

.commit-ai-chevron:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.commit-ai-btn:hover:not(:disabled) {
  background: var(--color-ai);
  color: var(--color-ai-text);
  z-index: 1;
}

.commit-ai-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.commit-ai-btn--loading {
  color: var(--color-warning);
}

.commit-ai-menu {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: var(--space-2);
  min-width: 180px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-popover);
  z-index: 100;
  list-style: none;
  padding: var(--space-2) 0;
}

.commit-ai-menu li {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: background var(--transition-hover);
}

.commit-ai-menu li:hover:not(.disabled) {
  background: var(--color-bg-tertiary);
}

.commit-ai-menu li.disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.commit-ai-menu-parent {
  position: relative;
}

.commit-ai-menu-arrow {
  margin-left: auto;
  opacity: 0.5;
}

.commit-ai-submenu {
  position: absolute;
  right: 100%;
  bottom: 0;
  margin-right: var(--space-1);
  min-width: 130px;
  max-height: 300px;
  overflow-y: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-popover);
  list-style: none;
  padding: var(--space-2) 0;
  z-index: 101;
}

.commit-ai-submenu li {
  display: flex;
  align-items: center;
  padding: 6px 12px 6px 30px;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  cursor: pointer;
  transition: background var(--transition-hover);
}

.commit-ai-submenu li:hover {
  background: var(--color-bg-tertiary);
}

.commit-ai-submenu li.is-active {
  font-weight: 600;
  padding-left: 12px;
}

.commit-ai-check {
  margin-right: 6px;
  flex-shrink: 0;
}

.commit-ai-error {
  font-size: var(--font-size-xs);
  color: var(--color-danger);
  padding: 0 var(--space-2);
  line-height: 1.4;
}

.commit-summary:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.commit-summary::placeholder {
  color: var(--color-text-muted);
}

.commit-description {
  width: 100%;
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  resize: vertical;
  min-height: 38px;
  max-height: 120px;
  outline: none;
  transition: border-color var(--transition-hover);
}

.commit-description:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.commit-description::placeholder {
  color: var(--color-text-muted);
  font-style: italic;
}

/* ─── Conventional Commits type chips ───────────────────── */
.cc-types {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  padding: 4px var(--space-3) 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cc-types::-webkit-scrollbar { display: none; }

.cc-chip {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  font-weight: var(--font-weight-medium);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.cc-chip:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.cc-chip--active {
  background: var(--color-accent-soft, rgba(124,58,237,0.12));
  border-color: var(--color-accent);
  color: var(--color-accent);
  font-weight: var(--font-weight-bold);
}

/* ─── Trailers ───────────────────────────────────────────── */
.commit-trailers {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}

/* Toggle button */
.trailer-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 0;
  width: 100%;
  text-align: left;
  transition: color var(--transition-fast);
}

.trailer-toggle:hover {
  color: var(--color-text);
}

.trailer-toggle-caret {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
  transform: rotate(-90deg);
}

.trailer-toggle--open .trailer-toggle-caret {
  transform: rotate(0deg);
}

.trailer-active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  flex-shrink: 0;
}

/* Row inside expanded section */
.trailer-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  min-height: 20px;
  padding-left: var(--space-2);
}

.trailer-check {
  flex-shrink: 0;
  accent-color: var(--color-accent);
  cursor: pointer;
}

.trailer-main-label {
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
}

.trailer-git-key {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  opacity: 0.7;
}

.trailer-help {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: bold;
  cursor: help;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
}

.trailer-help:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.trailer-value-line {
  font-size: 10px;
  color: var(--color-text-muted);
  padding-left: calc(var(--space-2) + 14px + 5px);  /* indent: padding-left + checkbox + gap */
  margin-top: -1px;
  font-family: var(--font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trailer-input {
  margin-left: calc(var(--space-2) + 14px + 5px);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  padding: 2px var(--space-2);
  outline: none;
  width: calc(100% - var(--space-2) - 14px - 5px);
  box-sizing: border-box;
}

.trailer-input:focus {
  border-color: var(--color-accent);
}

.commit-actions {
  display: flex;
  gap: var(--space-3);
}

.commit-stage-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background: var(--color-bg-tertiary);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: background var(--transition-hover), border-color var(--transition-hover), color var(--transition-hover);
  white-space: nowrap;
}

.commit-stage-all:hover {
  background: var(--color-bg);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.commit-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: var(--radius-pill);
  transition: background var(--transition-hover), opacity var(--transition-hover);
}

.commit-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.commit-btn--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.commit-spinner {
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.commit-hint {
  font-size: var(--font-size-xs);
  text-align: center;
}

/* ─── Dashboard sidebar ──────────────────────────────── */
.sidebar-dashboard {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-7) var(--space-5) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.side-block { display: flex; flex-direction: column; gap: var(--space-4); }

.side-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--color-text-subtle);
}

.side-label svg {
  width: 14px;
  height: 14px;
  padding: 3px;
  box-sizing: content-box;
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.branch-list { display: flex; flex-direction: column; gap: var(--space-1); }

.branch-item {
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-md);
  background: none;
  border: none;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  transition: background var(--transition-hover), transform var(--transition-hover);
}

.branch-item:hover {
  background: var(--color-bg-tertiary);
  transform: translateX(2px);
}

.branch-item--current {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.branch-item--current:hover {
  transform: none;
  background: var(--color-accent-soft);
}

.branch-item--current .branch-name { font-weight: 700; }

.branch-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--font-size-sm);
}

.branch-indicator {
  display: inline-flex;
  gap: var(--space-3);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.branch-up { color: var(--color-success); }
.branch-down { color: var(--color-info); }

.side-empty {
  padding: var(--space-5) var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
  text-align: center;
}

.activity-item {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-md);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--transition-hover), transform var(--transition-hover);
}

.activity-item:hover {
  background: var(--color-bg-tertiary);
  transform: translateX(2px);
}

.activity-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: white;
  flex-shrink: 0;
  box-shadow: var(--shadow-xs);
  letter-spacing: 0.02em;
}

.activity-body { min-width: 0; align-self: center; }

.activity-msg {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
}

.activity-time {
  font-size: 11px;
  color: var(--color-text-subtle);
  margin-top: 3px;
}

.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  padding: 0 var(--space-3);
}

.qa {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  font-size: var(--font-size-sm);
  font-weight: 600;
  background: var(--color-bg-tertiary);
  color: var(--color-text);
  /* Bordure transparente par défaut pour éviter tout layout shift
     quand la couleur apparaît au hover. */
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color var(--transition-hover),
              background var(--transition-hover),
              color var(--transition-hover),
              box-shadow var(--transition-hover);
}

.qa svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 6px;
  box-sizing: content-box;
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  transition: background var(--transition-hover), color var(--transition-hover);
}

.qa:hover {
  color: var(--color-text);
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.qa:hover svg {
  background: var(--color-accent);
  color: var(--color-accent-text);
}

.qa:active {
  box-shadow: none;
}

/* Full-width quick action (e.g. "Open on GitHub") — spans both grid columns. */
.qa--full {
  grid-column: 1 / -1;
  justify-content: center;
  text-decoration: none;
}
</style>

<style>
/* Context menu — non-scoped pour Teleport */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: var(--color-bg-secondary, #1e1e2e);
  border: 1px solid var(--color-border, #313244);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  animation: ctx-fade-in var(--transition-base) ease;
}

@keyframes ctx-fade-in {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to   { opacity: 1; transform: scale(1)   translateY(0); }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--color-text, #cdd6f4);
  background: none;
  border-radius: var(--radius-sm);
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-hover), color var(--transition-hover);
}

.ctx-item:hover {
  background: var(--color-bg-tertiary, #313244);
}

.ctx-item--danger {
  color: var(--color-danger, #f38ba8);
}

.ctx-item--danger:hover {
  background: var(--color-danger-soft);
}

.ctx-separator {
  height: 1px;
  background: var(--color-border, #313244);
  margin: var(--space-xs) var(--space-3);
}
</style>
