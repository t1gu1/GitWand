<script setup lang="ts">
/**
 * CommandLogPanel — Transparent git command log (v2.11)
 *
 * Slide-in panel showing the last ≤200 git commands GitWand ran on
 * behalf of the user: label, working directory, duration, exit code,
 * and timestamp.
 *
 * Opened via ⌘⇧L (macOS) / Ctrl+Shift+L (Linux/Windows).
 * Refreshed automatically on each open.
 */
import { computed, watch } from "vue";
import { useCommandLog } from "../composables/useCommandLog";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();
const { entries, loading, lastRefresh, refresh } = useCommandLog();

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

// Refresh every time the panel becomes visible
watch(() => props.visible, (v) => { if (v) refresh(); });

function formatDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffS = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffS < 5)   return "just now";
    if (diffS < 60)  return `${diffS}s ago`;
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function shortCwd(cwd: string): string {
  // Show only the last 2 path segments so the column stays narrow
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return "…/" + parts.slice(-2).join("/");
}

const refreshLabel = computed(() => {
  if (!lastRefresh.value) return "";
  return `Updated ${formatTime(lastRefresh.value.getTime())}`;
});
</script>

<template>
  <Transition name="slide-right">
    <div v-if="visible" class="clp" role="dialog" aria-label="Command Log">
      <!-- Header -->
      <div class="clp-header">
        <span class="clp-title">Command Log</span>
        <span v-if="lastRefresh" class="clp-refresh-time muted">{{ refreshLabel }}</span>
        <button class="clp-refresh icon-btn" :disabled="loading" @click="refresh" title="Refresh (⌘⇧L)">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M11.5 2A5.5 5.5 0 1 0 12 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <polyline points="10,0 12,2 10,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="clp-close icon-btn" @click="emit('close')" title="Close">✕</button>
      </div>

      <!-- Empty / loading -->
      <div v-if="loading && entries.length === 0" class="clp-empty muted">Loading…</div>
      <div v-else-if="entries.length === 0" class="clp-empty muted">
        No commands recorded yet.<br>
        <span style="font-size:11px">Commands appear here after you commit, push, pull, etc.</span>
      </div>

      <!-- Log table -->
      <div v-else class="clp-scroll">
        <table class="clp-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Dir</th>
              <th>Time</th>
              <th>ms</th>
              <th>Exit</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in entries"
              :key="entry.id"
              :class="{ 'clp-row--err': entry.exit_code !== 0 }"
            >
              <td class="clp-cmd mono">{{ entry.label }}</td>
              <td class="clp-cwd muted mono">{{ shortCwd(entry.cwd) }}</td>
              <td class="clp-ts muted">{{ formatTime(entry.timestamp_ms) }}</td>
              <td class="clp-dur muted">{{ formatDur(entry.duration_ms) }}</td>
              <td class="clp-exit" :class="entry.exit_code === 0 ? 'clp-ok' : 'clp-fail'">
                {{ entry.exit_code }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.clp {
  position: fixed;
  top: 0;
  right: 0;
  width: 560px;
  max-width: 90vw;
  height: 100vh;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  z-index: 300;
  box-shadow: -4px 0 24px rgba(0,0,0,0.18);
}

/* Slide-in from the right */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.22s cubic-bezier(.4,0,.2,1);
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}

.clp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.clp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.clp-refresh-time {
  font-size: 11px;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 3px 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  font-size: 13px;
  transition: background 0.1s;
}
.icon-btn:hover { background: var(--color-bg-tertiary); }
.icon-btn:disabled { opacity: 0.4; cursor: default; }

.clp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 13px;
  gap: 6px;
  padding: 40px;
}

.clp-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
}

.clp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}

.clp-table thead th {
  position: sticky;
  top: 0;
  background: var(--color-bg-secondary);
  padding: 5px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.clp-table tbody tr {
  border-bottom: 1px solid var(--color-border);
  transition: background 0.1s;
}
.clp-table tbody tr:hover { background: var(--color-bg-tertiary); }
.clp-row--err { background: rgba(var(--color-danger-rgb, 220,53,69), 0.05); }
.clp-row--err:hover { background: rgba(var(--color-danger-rgb, 220,53,69), 0.1); }

.clp-table td {
  padding: 5px 10px;
  vertical-align: middle;
  white-space: nowrap;
}

.clp-cmd {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
  font-size: 11px;
}

.clp-cwd {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
}

.clp-ts { font-size: 10px; }
.clp-dur { font-size: 10px; text-align: right; }

.clp-exit { font-size: 10px; font-weight: 600; text-align: center; width: 36px; }
.clp-ok  { color: var(--color-success); }
.clp-fail { color: var(--color-danger); }
</style>
