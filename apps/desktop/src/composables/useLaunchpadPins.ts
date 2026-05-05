import { ref, computed } from "vue";

export interface PinnedItem {
  url: string;
  type: "pr" | "issue";
  pinnedAt: string; // ISO 8601
}

export interface SnoozedItem {
  url: string;
  type: "pr" | "issue";
  snoozedUntil: string; // ISO 8601 — item reappears after this date
}

export const LAUNCHPAD_PINS_STORAGE_KEY = "gitwand-launchpad-pins";
const STORAGE_KEY = LAUNCHPAD_PINS_STORAGE_KEY;

interface StoredData {
  pins: PinnedItem[];
  snoozes: SnoozedItem[];
}

function loadFromStorage(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pins: [], snoozes: [] };
    return JSON.parse(raw) as StoredData;
  } catch {
    return { pins: [], snoozes: [] };
  }
}

function saveToStorage(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── Module-level singleton state ──────────────────────────────────────────────
const _pins = ref<PinnedItem[]>([]);
const _snoozes = ref<SnoozedItem[]>([]);

function _init(): void {
  const stored = loadFromStorage();
  _pins.value = stored.pins;
  _snoozes.value = stored.snoozes;
}

_init();

/** Reset state from localStorage. Only exported for use in Vitest tests. */
export function _resetPinsForTesting(): void {
  _init();
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useLaunchpadPins() {
  /** All non-expired snooze entries. Recomputed reactively. */
  const activeSnoozed = computed<readonly SnoozedItem[]>(() =>
    _snoozes.value.filter((s) => new Date(s.snoozedUntil).getTime() > Date.now())
  );

  function persist(): void {
    // Lazily prune expired snoozes on every write
    const now = Date.now();
    _snoozes.value = _snoozes.value.filter(
      (s) => new Date(s.snoozedUntil).getTime() > now
    );
    saveToStorage({ pins: _pins.value, snoozes: _snoozes.value });
  }

  function pin(url: string, type: "pr" | "issue"): void {
    if (_pins.value.some((p) => p.url === url)) return;
    _pins.value = [..._pins.value, { url, type, pinnedAt: new Date().toISOString() }];
    persist();
  }

  function unpin(url: string): void {
    _pins.value = _pins.value.filter((p) => p.url !== url);
    persist();
  }

  function snooze(url: string, type: "pr" | "issue", days: 1 | 3 | 7 | 14): void {
    const snoozedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    // Replace any existing snooze for this URL
    _snoozes.value = _snoozes.value.filter((s) => s.url !== url);
    _snoozes.value = [..._snoozes.value, { url, type, snoozedUntil }];
    persist();
  }

  function unsnooze(url: string): void {
    _snoozes.value = _snoozes.value.filter((s) => s.url !== url);
    persist();
  }

  function isPinned(url: string): boolean {
    return _pins.value.some((p) => p.url === url);
  }

  /** Returns true only if a non-expired snooze exists for this URL. */
  function isSnoozed(url: string): boolean {
    const s = _snoozes.value.find((s) => s.url === url);
    if (!s) return false;
    return new Date(s.snoozedUntil).getTime() > Date.now();
  }

  /** Returns the ISO 8601 snoozedUntil string, or null if not snoozed (or snooze expired). */
  function snoozedUntil(url: string): string | null {
    const s = _snoozes.value.find((s) => s.url === url);
    if (!s) return null;
    return new Date(s.snoozedUntil).getTime() > Date.now() ? s.snoozedUntil : null;
  }

  return {
    pins: computed(() => _pins.value as readonly PinnedItem[]),
    activeSnoozed,
    pin,
    unpin,
    snooze,
    unsnooze,
    isPinned,
    isSnoozed,
    snoozedUntil,
  };
}
