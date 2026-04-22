<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  gitSubmoduleList,
  gitSubmoduleUpdate,
  gitSubmoduleAdd,
  type SubmoduleEntry,
} from "../utils/backend";
import { useI18n } from "../composables/useI18n";

const props = defineProps<{
  cwd: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-tab", path: string): void;
}>();

const { t } = useI18n();

const submodules = ref<SubmoduleEntry[]>([]);
const loading = ref(false);
const updating = ref(false);
const error = ref<string | null>(null);

// Add form
const showForm = ref(false);
const formUrl = ref("");
const formPath = ref("");
const adding = ref(false);

async function loadSubmodules() {
  loading.value = true;
  error.value = null;
  try {
    submodules.value = await gitSubmoduleList(props.cwd);
  } catch (err: any) {
    error.value = t("submodule.errorList").replace("{0}", String(err?.message ?? err));
  } finally {
    loading.value = false;
  }
}

async function initUpdateAll() {
  updating.value = true;
  error.value = null;
  try {
    await gitSubmoduleUpdate(props.cwd, true, true);
    await loadSubmodules();
  } catch (err: any) {
    error.value = t("submodule.errorUpdate").replace("{0}", String(err?.message ?? err));
  } finally {
    updating.value = false;
  }
}

async function addSubmodule() {
  if (!formUrl.value.trim() || !formPath.value.trim()) return;
  adding.value = true;
  error.value = null;
  try {
    await gitSubmoduleAdd(props.cwd, formUrl.value.trim(), formPath.value.trim());
    formUrl.value = "";
    formPath.value = "";
    showForm.value = false;
    await loadSubmodules();
  } catch (err: any) {
    error.value = t("submodule.errorAdd").replace("{0}", String(err?.message ?? err));
  } finally {
    adding.value = false;
  }
}

function openInTab(sub: SubmoduleEntry) {
  // Submodule path is relative to cwd
  const fullPath = props.cwd.replace(/\\/g, "/").replace(/\/$/, "") + "/" + sub.path;
  emit("open-tab", fullPath);
}

function statusLabel(status: SubmoduleEntry["status"]): string {
  if (status === "modified") return t("submodule.statusModified");
  if (status === "uninitialized") return t("submodule.statusUninitialized");
  return t("submodule.statusClean");
}

const uninitCount = () => submodules.value.filter(s => s.status === "uninitialized").length;

onMounted(loadSubmodules);
</script>

<template>
  <div class="submodule-panel">
    <!-- Header -->
    <div class="sm-header">
      <h3>{{ t("submodule.title") }}</h3>
      <div class="sm-header-actions">
        <button
          class="btn btn-xs"
          :title="t('submodule.initUpdateTooltip')"
          :disabled="updating"
          @click="initUpdateAll"
        >
          {{ updating ? t("submodule.updating") : t("submodule.initUpdateAll") }}
        </button>
        <button class="btn btn-xs btn-primary" @click="showForm = !showForm">
          + {{ t("submodule.addSubmodule") }}
        </button>
        <button class="btn btn-xs btn-icon" @click="emit('close')" aria-label="Close">✕</button>
      </div>
    </div>

    <!-- Uninitialized warning -->
    <div
      v-if="!loading && uninitCount() > 0"
      class="sm-warning"
      @click="initUpdateAll"
    >
      ⚠ {{ t("submodule.warningUninitialized").replace("{0}", String(uninitCount())) }}
    </div>

    <!-- Add form -->
    <div v-if="showForm" class="sm-form">
      <div class="sm-form-row">
        <label class="sm-label" for="sub-form-url">{{ t("submodule.formUrl") }}</label>
        <input
          id="sub-form-url"
          v-model="formUrl"
          class="sm-input"
          :placeholder="t('submodule.formUrlPlaceholder')"
        />
      </div>
      <div class="sm-form-row">
        <label class="sm-label" for="sub-form-path">{{ t("submodule.formPath") }}</label>
        <input
          id="sub-form-path"
          v-model="formPath"
          class="sm-input"
          :placeholder="t('submodule.formPathPlaceholder')"
          @keydown.enter="addSubmodule"
        />
      </div>
      <div class="sm-form-actions">
        <button
          class="btn btn-primary"
          :disabled="adding || !formUrl.trim() || !formPath.trim()"
          @click="addSubmodule"
        >
          {{ adding ? t("submodule.adding") : t("submodule.add") }}
        </button>
        <button class="btn btn-outline" @click="showForm = false">
          {{ t("common.cancel") }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="sm-error">{{ error }}</div>

    <!-- Loading -->
    <div v-if="loading" class="sm-state">{{ t("common.loading") }}</div>

    <!-- Empty -->
    <div v-else-if="!loading && submodules.length === 0" class="sm-state sm-empty">
      {{ t("submodule.empty") }}
    </div>

    <!-- List -->
    <div v-else class="sm-list">
      <div v-for="sub in submodules" :key="sub.path" class="sm-item">
        <div class="sm-item-info">
          <div class="sm-item-top">
            <span class="sm-item-path">{{ sub.path }}</span>
            <span
              class="sm-status-badge"
              :class="`status-${sub.status}`"
            >{{ statusLabel(sub.status) }}</span>
          </div>
          <div class="sm-item-url" :title="sub.url">{{ sub.url }}</div>
          <div class="sm-item-meta">
            <span v-if="sub.sha" class="sm-sha">{{ sub.sha.slice(0, 7) }}</span>
            <span v-if="sub.branch" class="sm-branch">⎇ {{ sub.branch }}</span>
          </div>
        </div>
        <div class="sm-item-actions">
          <button
            class="btn btn-xs"
            :disabled="sub.status === 'uninitialized'"
            @click="openInTab(sub)"
          >
            {{ t("submodule.openInTab") }}
          </button>
          <button
            v-if="sub.status === 'uninitialized'"
            class="btn btn-xs btn-primary"
            :disabled="updating"
            @click="initUpdateAll"
          >
            {{ t("submodule.initUpdate") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.submodule-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  max-height: inherit;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.35));
  overflow: hidden;
}

/* ── Header ────────────────────────────────────────────── */
.sm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-shrink: 0;
}

.sm-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}

.sm-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

/* ── Warning banner ─────────────────────────────────────── */
.sm-warning {
  padding: 8px 18px;
  font-size: var(--font-size-sm);
  background: var(--color-warning-soft, rgba(234, 179, 8, 0.12));
  color: var(--color-warning, #ca8a04);
  border-bottom: 1px solid var(--color-warning-border, rgba(234, 179, 8, 0.3));
  cursor: pointer;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}

.sm-warning:hover {
  background: var(--color-warning-soft-hover, rgba(234, 179, 8, 0.2));
}

/* ── Form ───────────────────────────────────────────────── */
.sm-form {
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.sm-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sm-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-muted);
}

.sm-input {
  height: 34px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--font-size-md);
  padding: 0 10px;
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.sm-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.sm-form-actions {
  display: flex;
  gap: 8px;
}

/* ── Error ──────────────────────────────────────────────── */
.sm-error {
  margin: 12px 18px 0;
  padding: 8px 12px;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

/* ── States ─────────────────────────────────────────────── */
.sm-state {
  padding: 32px 24px;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
  text-align: center;
}

/* ── List ───────────────────────────────────────────────── */
.sm-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-secondary);
  transition: border-color var(--transition-fast);
}

.sm-item:hover {
  border-color: var(--color-accent);
}

.sm-item-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sm-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sm-item-path {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  font-family: var(--font-mono);
}

.sm-status-badge {
  font-size: 10px;
  font-weight: var(--font-weight-semibold);
  padding: 1px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.status-clean {
  background: var(--color-success-soft, rgba(34, 197, 94, 0.12));
  color: var(--color-success, #16a34a);
}

.status-modified {
  background: var(--color-warning-soft, rgba(234, 179, 8, 0.12));
  color: var(--color-warning, #ca8a04);
}

.status-uninitialized {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.sm-item-url {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-item-meta {
  display: flex;
  gap: 10px;
}

.sm-sha,
.sm-branch {
  font-size: var(--font-size-xs, 11px);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.sm-item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Outline variant ────────────────────────────────────── */
.btn-outline {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-outline:hover:not(:disabled) {
  background: var(--color-bg-hover);
  border-color: var(--color-text-muted);
}
</style>
