<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { gitListTags, gitDeleteTag, gitPushTags, gitDeleteRemoteTag, gitRemoteInfo, type GitTag } from "../utils/backend";
import { useI18n } from "../composables/useI18n";
import BaseModal from "./BaseModal.vue";

const props = defineProps<{
  cwd: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "create-tag"): void;  // ask host to open the tag creation flow
}>();

const { t } = useI18n();

// ─── State ──────────────────────────────────────────────
const tags = ref<GitTag[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const remoteName = ref("origin");
const busyTag = ref<string | null>(null);   // name of tag currently being acted on
const busyPushAll = ref(false);
const confirmDelete = ref<{ name: string; withRemote: boolean } | null>(null);

// ─── Load ────────────────────────────────────────────────
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [tagList, remoteInfo] = await Promise.all([
      gitListTags(props.cwd),
      gitRemoteInfo(props.cwd).catch(() => null),
    ]);
    tags.value = tagList;
    if (remoteInfo?.name) remoteName.value = remoteInfo.name;
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ─── Computed ────────────────────────────────────────────
const hasRemote = computed(() => !!remoteName.value);

function relativeDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 1) return t("date.now");
  if (diffDays < 7) return t("date.daysAgo", diffDays);
  if (diffDays < 30) return t("date.weeksAgo", Math.floor(diffDays / 7));
  if (diffDays < 365) return t("date.monthsAgo", Math.floor(diffDays / 30));
  return t("date.yearsAgo", Math.floor(diffDays / 365));
}

// ─── Actions ─────────────────────────────────────────────
function askDelete(name: string) {
  confirmDelete.value = { name, withRemote: false };
}

async function confirmDeleteTag() {
  if (!confirmDelete.value) return;
  const { name, withRemote } = confirmDelete.value;
  busyTag.value = name;
  error.value = null;
  try {
    await gitDeleteTag(props.cwd, name);
    if (withRemote && hasRemote.value) {
      await gitDeleteRemoteTag(props.cwd, remoteName.value, name).catch(() => {
        // Remote delete failure is non-fatal — tag is gone locally
      });
    }
    confirmDelete.value = null;
    await load();
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    busyTag.value = null;
  }
}

async function pushTag(name: string) {
  if (!hasRemote.value) return;
  busyTag.value = name;
  error.value = null;
  try {
    await gitPushTags(props.cwd, remoteName.value, "single", name);
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    busyTag.value = null;
  }
}

async function pushAllTags() {
  if (!hasRemote.value) return;
  busyPushAll.value = true;
  error.value = null;
  try {
    await gitPushTags(props.cwd, remoteName.value, "all");
  } catch (err: any) {
    error.value = err?.message ?? String(err);
  } finally {
    busyPushAll.value = false;
  }
}
</script>

<template>
  <BaseModal
    :title="t('tags.title')"
    :subtitle="t('tags.subtitle', tags.length)"
    size="md"
    @close="emit('close')"
  >
    <!-- Toolbar -->
    <template #toolbar>
      <div class="tp-toolbar">
        <button class="bm-btn bm-btn--ghost tp-btn-sm" @click="emit('create-tag')">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          {{ t('tags.newTag') }}
        </button>
        <button
          v-if="hasRemote"
          class="bm-btn bm-btn--ghost tp-btn-sm"
          :disabled="busyPushAll || tags.length === 0"
          @click="pushAllTags"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 11V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          {{ busyPushAll ? t('common.loading') : t('tags.pushAll', remoteName) }}
        </button>
      </div>
    </template>

    <!-- Error banner -->
    <p v-if="error" class="tp-error">{{ error }}</p>

    <!-- Loading -->
    <div v-if="loading" class="tp-empty">
      <div class="tp-spinner"></div>
      <span>{{ t('common.loading') }}</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="tags.length === 0" class="tp-empty">
      <svg width="32" height="32" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="tp-empty-icon">
        <path d="M2 2h6l6 6-6 6-6-6V2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        <circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>
      </svg>
      <p class="tp-empty-text">{{ t('tags.empty') }}</p>
      <button class="bm-btn bm-btn--primary" @click="emit('create-tag')">{{ t('tags.newTag') }}</button>
    </div>

    <!-- Tag list -->
    <ul v-else class="tp-list">
      <li v-for="tag in tags" :key="tag.name" class="tp-item">
        <div class="tp-item-main">
          <div class="tp-item-top">
            <span class="tp-name">{{ tag.name }}</span>
            <span class="tp-badge" :class="tag.isAnnotated ? 'tp-badge--annotated' : 'tp-badge--light'">
              {{ tag.isAnnotated ? t('tags.annotated') : t('tags.lightweight') }}
            </span>
          </div>
          <div class="tp-item-meta">
            <span class="tp-hash mono">{{ tag.hash }}</span>
            <span class="tp-sep">·</span>
            <span class="tp-date">{{ relativeDate(tag.date) }}</span>
            <template v-if="tag.message">
              <span class="tp-sep">·</span>
              <span class="tp-message">{{ tag.message }}</span>
            </template>
          </div>
        </div>
        <div class="tp-item-actions">
          <button
            v-if="hasRemote"
            class="tp-action-btn"
            :disabled="busyTag === tag.name"
            :title="t('tags.pushTag', remoteName)"
            @click="pushTag(tag.name)"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 11V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 13h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="tp-action-btn tp-action-btn--danger"
            :disabled="busyTag === tag.name"
            :title="t('tags.deleteTag')"
            @click="askDelete(tag.name)"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 4h10M6 4V2h4v2M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </li>
    </ul>

    <!-- Delete confirmation sub-modal -->
    <BaseModal
      v-if="confirmDelete"
      :title="t('tags.deleteConfirmTitle')"
      :subtitle="confirmDelete.name"
      size="sm"
      role="alertdialog"
      @close="confirmDelete = null"
    >
      <label v-if="hasRemote" class="tp-check-label">
        <input type="checkbox" v-model="confirmDelete.withRemote" />
        <span>{{ t('tags.deleteAlsoRemote', remoteName) }}</span>
      </label>
      <template #footer>
        <button class="bm-btn bm-btn--ghost" @click="confirmDelete = null">{{ t('common.cancel') }}</button>
        <button class="bm-btn bm-btn--danger" :disabled="busyTag === confirmDelete.name" @click="confirmDeleteTag">
          {{ busyTag === confirmDelete.name ? t('common.loading') : t('tags.deleteConfirm') }}
        </button>
      </template>
    </BaseModal>
  </BaseModal>
</template>

<style scoped>
/* ─── Toolbar ───────────────────────────────────────────── */
.tp-toolbar {
  display: flex;
  gap: var(--space-2);
}

/* Standardise les boutons d'action de la barre d'outils sur la
   hauteur 32 px utilisée ailleurs dans l'app (cf. StashManager
   `.sm-btn-sm`). La base `.bm-btn` (padding vertical var(--space-3))
   reste destinée aux footers de modales, plus compacts. */
.tp-btn-sm {
  height: 32px;
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
  line-height: 1;
}


/* ─── List ──────────────────────────────────────────────── */
.tp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tp-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-1);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.tp-item:hover {
  background: var(--color-bg-tertiary);
}

.tp-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tp-item-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tp-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text);
}

.tp-badge {
  font-size: 10px;
  font-weight: var(--font-weight-bold);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.tp-badge--annotated {
  background: var(--color-accent-soft, rgba(124, 58, 237, 0.12));
  color: var(--color-accent);
}

.tp-badge--light {
  background: var(--color-bg-tertiary);
  color: var(--color-text-muted);
}

.tp-item-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.tp-hash {
  color: var(--color-accent);
}

.tp-sep {
  opacity: 0.4;
}

.tp-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* ─── Actions ───────────────────────────────────────────── */
.tp-item-actions {
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.tp-item:hover .tp-item-actions {
  opacity: 1;
}

.tp-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  border: none;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.tp-action-btn:hover:not(:disabled) {
  background: var(--color-bg);
  color: var(--color-text);
}

.tp-action-btn--danger:hover:not(:disabled) {
  color: var(--color-danger, #ef4444);
}

.tp-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ─── Empty / loading ───────────────────────────────────── */
.tp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-10) 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.tp-empty-icon {
  opacity: 0.35;
}

.tp-empty-text {
  margin: 0;
}

.tp-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: tp-spin 0.7s linear infinite;
}

@keyframes tp-spin {
  to { transform: rotate(360deg); }
}

/* ─── Error ─────────────────────────────────────────────── */
.tp-error {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-sm);
  color: var(--color-danger, #ef4444);
  background: var(--color-danger-soft, rgba(239, 68, 68, 0.06));
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--color-danger, #ef4444);
}

/* ─── Delete confirm ────────────────────────────────────── */
.tp-check-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
</style>
