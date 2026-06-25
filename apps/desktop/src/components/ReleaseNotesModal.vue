<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { gitListTags, getGitBranches, gitExec, type GitBranch } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import { useReleaseNotes } from "../composables/useReleaseNotes";
import BaseModal from "./BaseModal.vue";

const props = defineProps<{
  cwd: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { t, locale } = useI18n();
const {
  isGenerating,
  generate: generateReleaseNotes,
  lastError,
} = useReleaseNotes();

const from = ref("");
const to = ref("HEAD");
const markdown = ref("");
const copied = ref(false);

// Ref pickers (tags + branches) for the from/to selects.
const branches = ref<GitBranch[]>([]);
const tagNames = ref<string[]>([]);
const localBranchNames = computed(() =>
  branches.value.filter((b) => !b.isRemote).map((b) => b.name),
);
const remoteBranchNames = computed(() =>
  branches.value.filter((b) => b.isRemote).map((b) => b.name),
);

/** Two short/long SHAs refer to the same commit if either is a prefix of the other. */
function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
}

onMounted(async () => {
  const [, tags, headSha] = await Promise.all([
    getGitBranches(props.cwd)
      .then((b) => { branches.value = b; })
      .catch(() => { branches.value = []; }),
    gitListTags(props.cwd).catch(() => []),
    gitExec(props.cwd, ["rev-parse", "HEAD"])
      .then((r) => (r.exitCode === 0 ? (r.stdout ?? "").trim() : ""))
      .catch(() => ""),
  ]);

  // Newest tag first (max tagger/committer date).
  const sorted = [...tags].sort((a, b) => b.date.localeCompare(a.date));
  tagNames.value = sorted.map((tg) => tg.name);

  // Default "from" = newest tag that is NOT on HEAD — otherwise `tag..HEAD`
  // would be an empty range. Fall back to the newest tag if every tag is on HEAD.
  const beforeHead = headSha
    ? sorted.find((tg) => !sameCommit(tg.hash, headSha))
    : undefined;
  from.value = (beforeHead ?? sorted[0])?.name ?? "";
});

async function runGenerate() {
  copied.value = false;
  try {
    markdown.value = await generateReleaseNotes(
      props.cwd,
      from.value,
      to.value,
      { locale: locale.value },
    );
  } catch {
    markdown.value = "";
  }
}

async function copy() {
  if (!markdown.value) return;
  try {
    await navigator.clipboard.writeText(markdown.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* clipboard perms may be denied */ }
}
</script>

<template>
  <BaseModal
    :title="t('dashboard.releaseNotesTitle')"
    size="lg"
    @close="emit('close')"
  >
    <p class="rn-desc">{{ t('dashboard.releaseNotesDesc') }}</p>
    <div class="rn-refs">
      <label class="rn-field">
        <span>{{ t('dashboard.releaseNotesFrom') }}</span>
        <select v-model="from" class="rn-input mono">
          <option value="HEAD">HEAD</option>
          <optgroup v-if="tagNames.length" :label="t('dashboard.releaseNotesTags')">
            <option v-for="tn in tagNames" :key="`f-${tn}`" :value="tn">{{ tn }}</option>
          </optgroup>
          <optgroup v-if="localBranchNames.length" :label="t('dashboard.releaseNotesBranches')">
            <option v-for="b in localBranchNames" :key="`f-${b}`" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="remoteBranchNames.length" :label="t('dashboard.releaseNotesRemoteBranches')">
            <option v-for="b in remoteBranchNames" :key="`f-${b}`" :value="b">{{ b }}</option>
          </optgroup>
        </select>
      </label>
      <span class="rn-sep">..</span>
      <label class="rn-field">
        <span>{{ t('dashboard.releaseNotesTo') }}</span>
        <select v-model="to" class="rn-input mono">
          <option value="HEAD">HEAD</option>
          <optgroup v-if="tagNames.length" :label="t('dashboard.releaseNotesTags')">
            <option v-for="tn in tagNames" :key="`t-${tn}`" :value="tn">{{ tn }}</option>
          </optgroup>
          <optgroup v-if="localBranchNames.length" :label="t('dashboard.releaseNotesBranches')">
            <option v-for="b in localBranchNames" :key="`t-${b}`" :value="b">{{ b }}</option>
          </optgroup>
          <optgroup v-if="remoteBranchNames.length" :label="t('dashboard.releaseNotesRemoteBranches')">
            <option v-for="b in remoteBranchNames" :key="`t-${b}`" :value="b">{{ b }}</option>
          </optgroup>
        </select>
      </label>
      <button
        class="bm-btn bm-btn--primary rn-btn-sm"
        :disabled="isGenerating || !from.trim() || !to.trim()"
        @click="runGenerate"
      >
        {{ isGenerating ? '…' : t('dashboard.releaseNotesGenerate') }}
      </button>
    </div>
    <p v-if="lastError" class="rn-error">{{ lastError }}</p>
    <textarea
      v-model="markdown"
      class="rn-textarea mono"
      rows="14"
      spellcheck="false"
      :placeholder="t('dashboard.releaseNotesPlaceholder')"
    />
    <template #footer>
      <button class="bm-btn bm-btn--ghost" :disabled="!markdown" @click="copy">
        {{ copied ? t('dashboard.releaseNotesCopied') : t('dashboard.releaseNotesCopy') }}
      </button>
      <button class="bm-btn bm-btn--primary" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.rn-desc { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: 0 0 var(--space-4); }
.rn-refs {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.rn-field { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-xs); color: var(--color-text-muted); }
.rn-sep { padding-bottom: var(--space-3); color: var(--color-text-muted); }

.rn-btn-sm {
  height: 32px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  line-height: 1;
}

.rn-input,
.rn-textarea {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  resize: vertical;
}

.rn-input:focus,
.rn-textarea:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.rn-field .rn-input { min-width: 140px; }
select.rn-input {
  cursor: pointer;
  max-width: 220px;
  height: 32px;
  padding-top: 0;
  padding-bottom: 0;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--space-3) center;
  padding-right: var(--space-8);
}

.rn-error {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-danger, #ef4444);
  background: var(--color-danger-soft, rgba(239, 68, 68, 0.06));
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-danger, #ef4444);
}
</style>
