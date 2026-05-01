<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "../composables/useI18n";
import { useSettings } from "../composables/useSettings";

const { t } = useI18n();
const { settings, saveSettings } = useSettings();

// ─── Helpers ─────────────────────────────────────────────

const lastRunMap = computed<Record<string, string>>(() => {
  try {
    return JSON.parse(localStorage.getItem("gitwand-scheduler-last-run") ?? "{}");
  } catch {
    return {};
  }
});

function lastRunLabel(key: string): string {
  const iso = lastRunMap.value[key];
  if (!iso) return t("automations.neverRun");
  const d = new Date(iso);
  return t("automations.lastRun").replace(
    "{0}",
    d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  );
}

function formatNightlyTime(): string {
  const { hour, minute } = settings.value.automations.nightlyPull;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ─── Toggle helpers ───────────────────────────────────────

function toggleAutoResolve(e: Event) {
  settings.value.automations.autoResolve.enabled = (e.target as HTMLInputElement).checked;
  saveSettings(settings.value);
}

function toggleNightlyPull(e: Event) {
  settings.value.automations.nightlyPull.enabled = (e.target as HTMLInputElement).checked;
  saveSettings(settings.value);
}

function setNightlyHour(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value);
  if (!isNaN(v)) {
    settings.value.automations.nightlyPull.hour = Math.max(0, Math.min(23, v));
    saveSettings(settings.value);
  }
}

function setNightlyMinute(e: Event) {
  const v = parseInt((e.target as HTMLInputElement).value);
  if (!isNaN(v)) {
    settings.value.automations.nightlyPull.minute = Math.max(0, Math.min(59, v));
    saveSettings(settings.value);
  }
}

function toggleReleaseNotes(e: Event) {
  settings.value.automations.releaseNotes.enabled = (e.target as HTMLInputElement).checked;
  saveSettings(settings.value);
}

function toggleAiCommitBatch(e: Event) {
  settings.value.automations.aiCommitBatch.enabled = (e.target as HTMLInputElement).checked;
  saveSettings(settings.value);
}

// ─── Manual run tracking ──────────────────────────────────
const runningTask = ref<string | null>(null);
</script>

<template>
  <div class="aup-panel">
    <p class="aup-subtitle">{{ t("automations.subtitle") }}</p>

    <!-- ── Auto-resolve ─────────────────────────────────── -->
    <div class="aup-card">
      <div class="aup-card-head">
        <div class="aup-card-info">
          <div class="aup-card-title">
            <!-- lightning bolt icon -->
            <svg class="aup-task-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            {{ t("automations.taskAutoResolve") }}
          </div>
          <p class="aup-card-desc">{{ t("automations.taskAutoResolveDesc") }}</p>
          <span class="aup-trigger">{{ t("automations.taskAutoResolveTrigger") }}</span>
        </div>
        <label class="aup-toggle">
          <input
            type="checkbox"
            :checked="settings.automations.autoResolve.enabled"
            @change="toggleAutoResolve"
          />
          <span class="aup-toggle-track"><span class="aup-toggle-thumb" /></span>
        </label>
      </div>
      <div class="aup-card-foot">
        <span class="aup-last-run">{{ lastRunLabel("autoResolve") }}</span>
      </div>
    </div>

    <!-- ── Nightly pull ──────────────────────────────────── -->
    <div class="aup-card">
      <div class="aup-card-head">
        <div class="aup-card-info">
          <div class="aup-card-title">
            <!-- clock icon -->
            <svg class="aup-task-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            {{ t("automations.taskNightlyPull") }}
          </div>
          <p class="aup-card-desc">{{ t("automations.taskNightlyPullDesc") }}</p>
          <span class="aup-trigger">
            {{ t("automations.taskNightlyPullTrigger").replace("{0}", formatNightlyTime()) }}
          </span>
          <!-- Time pickers (only visible when enabled) -->
          <div v-if="settings.automations.nightlyPull.enabled" class="aup-time-row">
            <label class="aup-time-label">
              {{ t("automations.taskNightlyPullHour") }}
              <input
                type="number"
                class="aup-time-input"
                :value="settings.automations.nightlyPull.hour"
                min="0" max="23"
                @change="setNightlyHour"
              />
            </label>
            <label class="aup-time-label">
              {{ t("automations.taskNightlyPullMinute") }}
              <input
                type="number"
                class="aup-time-input"
                :value="settings.automations.nightlyPull.minute"
                min="0" max="59"
                @change="setNightlyMinute"
              />
            </label>
          </div>
        </div>
        <label class="aup-toggle">
          <input
            type="checkbox"
            :checked="settings.automations.nightlyPull.enabled"
            @change="toggleNightlyPull"
          />
          <span class="aup-toggle-track"><span class="aup-toggle-thumb" /></span>
        </label>
      </div>
      <div class="aup-card-foot">
        <span class="aup-last-run">{{ lastRunLabel("nightlyPull") }}</span>
      </div>
    </div>

    <!-- ── Release notes ─────────────────────────────────── -->
    <div class="aup-card" :class="{ 'aup-card--requires-ai': !settings.aiEnabled }">
      <div class="aup-card-head">
        <div class="aup-card-info">
          <div class="aup-card-title">
            <!-- tag icon -->
            <svg class="aup-task-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
              <line x1="7" y1="7" x2="7.01" y2="7"/>
            </svg>
            {{ t("automations.taskReleaseNotes") }}
          </div>
          <p class="aup-card-desc">{{ t("automations.taskReleaseNotesDesc") }}</p>
          <span class="aup-trigger">{{ t("automations.taskReleaseNotesTrigger") }}</span>
          <span v-if="!settings.aiEnabled" class="aup-requires-ai">{{ t("automations.requiresAi") }}</span>
        </div>
        <label class="aup-toggle">
          <input
            type="checkbox"
            :checked="settings.automations.releaseNotes.enabled"
            :disabled="!settings.aiEnabled"
            @change="toggleReleaseNotes"
          />
          <span class="aup-toggle-track"><span class="aup-toggle-thumb" /></span>
        </label>
      </div>
      <div class="aup-card-foot">
        <span class="aup-last-run">{{ lastRunLabel("releaseNotes") }}</span>
      </div>
    </div>

    <!-- ── AI commit batch ───────────────────────────────── -->
    <div class="aup-card" :class="{ 'aup-card--requires-ai': !settings.aiEnabled }">
      <div class="aup-card-head">
        <div class="aup-card-info">
          <div class="aup-card-title">
            <!-- sparkle icon -->
            <svg class="aup-task-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/>
            </svg>
            {{ t("automations.taskAiCommitBatch") }}
          </div>
          <p class="aup-card-desc">{{ t("automations.taskAiCommitBatchDesc") }}</p>
          <span class="aup-trigger">{{ t("automations.taskAiCommitBatchTrigger") }}</span>
          <span v-if="!settings.aiEnabled" class="aup-requires-ai">{{ t("automations.requiresAi") }}</span>
        </div>
        <label class="aup-toggle">
          <input
            type="checkbox"
            :checked="settings.automations.aiCommitBatch.enabled"
            :disabled="!settings.aiEnabled"
            @change="toggleAiCommitBatch"
          />
          <span class="aup-toggle-track"><span class="aup-toggle-thumb" /></span>
        </label>
      </div>
      <div class="aup-card-foot">
        <span class="aup-last-run">{{ lastRunLabel("aiCommitBatch") }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aup-panel {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.aup-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
  line-height: 1.5;
}

/* ── Card ───────────────────────────────────────────────── */
.aup-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-alt, rgba(255,255,255,0.03));
  overflow: hidden;
  transition: border-color 0.12s;
}

.aup-card:hover {
  border-color: var(--color-accent);
}

.aup-card--requires-ai {
  opacity: 0.7;
}

.aup-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 14px 10px;
  gap: 12px;
}

.aup-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.aup-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.aup-task-icon {
  color: var(--color-accent);
  flex-shrink: 0;
}

.aup-card-desc {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.aup-trigger {
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  background: var(--color-surface, rgba(255,255,255,0.06));
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 1px 6px;
  display: inline-block;
  width: fit-content;
}

.aup-requires-ai {
  font-size: 11px;
  color: var(--color-warning, #d69e2e);
  font-style: italic;
}

.aup-card-foot {
  border-top: 1px solid var(--color-border);
  padding: 6px 14px;
  background: var(--color-bg-tertiary, rgba(0,0,0,0.06));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.aup-last-run {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
}

/* ── Time row ───────────────────────────────────────────── */
.aup-time-row {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.aup-time-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.aup-time-input {
  width: 52px;
  padding: 3px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 11px;
  text-align: center;
}

.aup-time-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}

/* ── Toggle switch ──────────────────────────────────────── */
.aup-toggle {
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  margin-top: 2px;
}

.aup-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.aup-toggle-track {
  display: flex;
  align-items: center;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--color-border);
  padding: 2px;
  transition: background 0.2s;
}

.aup-toggle input:checked ~ .aup-toggle-track {
  background: var(--color-accent, #6366f1);
}

.aup-toggle input:disabled ~ .aup-toggle-track {
  opacity: 0.4;
  cursor: not-allowed;
}

.aup-toggle-thumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
}

.aup-toggle input:checked ~ .aup-toggle-track .aup-toggle-thumb {
  transform: translateX(14px);
}
</style>
