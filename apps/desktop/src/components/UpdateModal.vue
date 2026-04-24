<script setup lang="ts">
import { ref, computed } from "vue";
import BaseModal from "./BaseModal.vue";
import type { UpdateInfo } from "../utils/backend";

const props = defineProps<{
  update: UpdateInfo;
}>();

const emit = defineEmits<{
  close: [];
  install: [];
}>();

const installing = ref(false);
const progress = ref(0); // 0–1

/** Expose progress setter so App.vue can relay onProgress callbacks */
function setProgress(fraction: number) {
  progress.value = fraction;
}
defineExpose({ setProgress });

const progressPct = computed(() => Math.round(progress.value * 100));

/** Render very basic markdown: bold, inline code, bullet lists */
function renderBody(text: string): string {
  if (!text) return "";
  return text
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold **text**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Inline code `text`
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // Headings ## / ###
    .replace(/^#{2,3}\s+(.+)$/gm, "<strong>$1</strong>")
    // Bullet list items
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    // Line breaks
    .replace(/\n/g, "<br>");
}

function onInstall() {
  installing.value = true;
  emit("install");
}
</script>

<template>
  <BaseModal
    :title="`GitWand ${update.version} disponible`"
    size="md"
    role="dialog"
    :closable="!installing"
    @close="emit('close')"
  >
    <!-- Version badge -->
    <div class="um-header">
      <span class="um-badge">Nouvelle version</span>
      <span class="um-version">v{{ update.version }}</span>
    </div>

    <!-- Release notes -->
    <div v-if="update.body" class="um-notes">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="um-notes__content" v-html="renderBody(update.body)" />
    </div>
    <p v-else class="um-no-notes">Aucune note de release disponible.</p>

    <!-- Download progress bar (visible during install) -->
    <div v-if="installing" class="um-progress">
      <div class="um-progress__bar" :style="{ width: progressPct + '%' }" />
      <span class="um-progress__label">
        {{ progress > 0 ? `${progressPct}%` : "Téléchargement en cours…" }}
      </span>
    </div>

    <!-- Footer -->
    <template #footer>
      <button
        class="bm-btn bm-btn--ghost"
        :disabled="installing"
        @click="emit('close')"
      >
        Plus tard
      </button>
      <button
        class="bm-btn bm-btn--primary"
        :disabled="installing"
        @click="onInstall"
      >
        <span v-if="installing" class="um-spinner" aria-hidden="true" />
        {{ installing ? "Installation…" : "Installer et redémarrer" }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.um-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.um-badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.um-version {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

/* Release notes box */
.um-notes {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.um-notes :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

.um-notes :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  padding: 1px 4px;
}

.um-notes :deep(ul) {
  margin: var(--space-2) 0;
  padding-left: var(--space-5);
}

.um-notes :deep(li) {
  margin-bottom: var(--space-1);
}

.um-no-notes {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-bottom: var(--space-4);
}

/* Progress bar */
.um-progress {
  position: relative;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: var(--space-3);
}

.um-progress__bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  border-radius: 99px;
  transition: width 0.2s ease;
  min-width: 4%;
}

.um-progress__label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-primary);
  /* shift below bar so text is readable */
  margin-top: 10px;
}

/* Spinner inside button */
.um-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: um-spin 0.7s linear infinite;
  margin-right: var(--space-2);
  vertical-align: middle;
}

@keyframes um-spin {
  to { transform: rotate(360deg); }
}
</style>
