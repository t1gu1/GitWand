import { computed, ref } from "vue";

/**
 * useLogs — in-memory ring buffer for runtime errors / warnings / info events.
 *
 * Replaces the previous "red error banner" pattern with a non-blocking
 * status-bar indicator + dedicated Settings → Logs tab. The buffer lives at
 * module scope so every caller across the app shares the same singleton — no
 * Pinia, just a module-level `ref` (cf. apps/desktop/src/CLAUDE.md).
 *
 * Constraints from the spec (PLAN-quick-fixes.md §P6):
 *  - In-memory only. No localStorage persistence (errors should not survive a
 *    reload — that would surface stale issues from a previous session).
 *  - Cap at 500 entries (oldest-first eviction).
 *  - `unreadCount` is independent of `entries.length`. It increments on every
 *    `pushLog()` call and only resets via `markAllRead()` — typically when the
 *    user opens the Logs tab.
 *
 * Public surface:
 *  - `entries` (alias `logs`)        — the bounded ring buffer
 *  - `unreadCount` / `hasUnread`     — drives the status-bar badge
 *  - `pushLog(level, message, ctx?)` — appends + bumps unread
 *  - `clearLogs()` / `clear()`       — empties + resets unread
 *  - `markAllRead()`                 — resets unread (called when Logs tab opens)
 *  - `formatEntry(entry)`            — `[YYYY-MM-DD HH:mm:ss] LEVEL message`
 *
 * `log()` / `clear()` are retained as legacy aliases — the codebase used them
 * before the spec settled on `pushLog` / `clearLogs`.
 */

export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  /**
   * Stable id used as the Vue render key. Built from a monotonic counter +
   * timestamp so it's unique even when two entries land in the same ms tick.
   */
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  /** Optional extra context — stack trace, file path, request id, etc. */
  context?: string;
}

const MAX_ENTRIES = 500;

// Singleton state — module scope. Every `useLogs()` call returns refs that
// point to the same underlying arrays.
const entries = ref<LogEntry[]>([]);
const unreadCount = ref(0);

// Monotonic counter to disambiguate ids when two events share a millisecond.
let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `${Date.now()}-${_idCounter}`;
}

function pushLog(level: LogLevel, message: string, context?: string) {
  const trimmed = (message ?? "").toString();
  if (!trimmed) return;
  entries.value.push({
    id: nextId(),
    timestamp: Date.now(),
    level,
    message: trimmed,
    context: context && context.length > 0 ? context : undefined,
  });
  if (entries.value.length > MAX_ENTRIES) {
    // Drop oldest entries (FIFO) so the buffer stays bounded.
    entries.value.splice(0, entries.value.length - MAX_ENTRIES);
  }
  unreadCount.value += 1;
}

function clearLogs() {
  entries.value = [];
  unreadCount.value = 0;
}

function markAllRead() {
  unreadCount.value = 0;
}

/**
 * Format an entry to a single-line string suitable for clipboard / display:
 *   `[YYYY-MM-DD HH:mm:ss] LEVEL message`
 *
 * LEVEL is upper-cased; the SettingsPanel template renders the three pieces
 * (timestamp, level, message) in separate spans for finer styling and uses
 * the i18n'd level label, but this helper is the canonical single-line form
 * used for clipboard copy and for any console mirror.
 */
function formatEntry(entry: LogEntry): string {
  return `${formatTimestamp(entry.timestamp)} ${entry.level.toUpperCase()} ${entry.message}`;
}

/** Just the bracketed timestamp portion — `[YYYY-MM-DD HH:mm:ss]`. */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`
  );
}

export function useLogs() {
  return {
    entries,
    // `logs` alias so spec callers reading "useAppLogs.logs" still work.
    logs: entries,
    unreadCount,
    hasUnread: computed(() => unreadCount.value > 0),
    pushLog,
    clearLogs,
    // Legacy aliases — kept so existing call sites keep working.
    log: pushLog,
    clear: clearLogs,
    markAllRead,
    formatEntry,
    formatTimestamp,
  };
}
