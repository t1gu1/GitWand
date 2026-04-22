import { ref, watch } from "vue";
import { useFolderHistory } from "./useFolderHistory";

/**
 * Unique identifier for a tab. Ids are regenerated every module load
 * (they're just an in-memory handle), so we never persist them — the
 * `path` is the stable identity we save to localStorage instead.
 */
let nextTabId = 1;

export interface RepoTab {
  /** Unique numeric ID for this tab (memory-only, resets on reload). */
  id: number;
  /** Path to the repository. */
  path: string;
  /** Display name (last path segment). */
  name: string;
}

const STORAGE_KEY = "gitwand-open-tabs";
const MAX_TABS = 10;

/**
 * Persisted shape. We keep paths + the active path (not id — ids are
 * regenerated on every module load so a numeric id wouldn't survive a
 * restart). Older releases saved just `string[]`; `load()` still reads
 * that shape so first-run-after-update doesn't lose tabs.
 */
interface PersistedTabs {
  paths: string[];
  activePath: string | null;
}

/** Extract display name from a path. */
function nameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() ?? path;
}

/** Persist open tab paths + which one is active to localStorage. */
function save(entries: RepoTab[], activeId: number | null) {
  try {
    const active = entries.find((t) => t.id === activeId);
    const payload: PersistedTabs = {
      paths: entries.map((t) => t.path),
      activePath: active?.path ?? null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* not fatal — persistence is best-effort */
  }
}

/**
 * Read from localStorage at module load. Handles two formats:
 *   - current: `{ paths: string[], activePath: string | null }`
 *   - legacy:  `string[]` (just paths, no active marker)
 * Any parse error or shape mismatch → returns empty; never throws.
 */
function load(): PersistedTabs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { paths: [], activePath: null };
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Legacy format — array of paths only.
      return {
        paths: parsed.filter((p): p is string => typeof p === "string"),
        activePath: null,
      };
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as PersistedTabs).paths)) {
      const obj = parsed as PersistedTabs;
      return {
        paths: obj.paths.filter((p): p is string => typeof p === "string"),
        activePath: typeof obj.activePath === "string" ? obj.activePath : null,
      };
    }
    return { paths: [], activePath: null };
  } catch {
    return { paths: [], activePath: null };
  }
}

// ─── Singleton state ────────────────────────────────────────
// Hydrate from localStorage immediately so the very first render already
// has the tabs ready and no "empty-tab-strip flash" happens on launch.
// Running this at module load is fine: localStorage is synchronous and
// available before any Vue component mounts.
const persisted = load();
const tabs = ref<RepoTab[]>(
  persisted.paths.map((path) => ({
    id: nextTabId++,
    path,
    name: nameFromPath(path),
  })),
);
const activeTabId = ref<number | null>(
  (() => {
    if (tabs.value.length === 0) return null;
    if (persisted.activePath) {
      const match = tabs.value.find((t) => t.path === persisted.activePath);
      if (match) return match.id;
    }
    // Fallback: first tab (legacy format or the saved active path was
    // removed from the list for some reason).
    return tabs.value[0]?.id ?? null;
  })(),
);

// Persist whenever the active tab changes, even without add/close —
// so the "active on relaunch" marker stays fresh as the user switches
// between tabs. Add/close paths already call save() explicitly, so we
// skip the change-detection dance there.
watch(activeTabId, (id) => save(tabs.value, id));

/**
 * Lightweight tab tracker — stores only paths and display names.
 * The actual repo state lives in a single useGitRepo() instance in App.vue,
 * which reloads when the active tab changes.
 */
export function useRepoTabs() {
  const { addToHistory } = useFolderHistory();

  /**
   * Open a path in a tab. If already open, switch to it.
   * Returns the tab.
   */
  function openTab(path: string): RepoTab {
    const normalized = path.replace(/\/+$/, "") || path;

    // Already open? Just switch.
    const existing = tabs.value.find((t) => t.path === normalized);
    if (existing) {
      activeTabId.value = existing.id;
      return existing;
    }

    // Enforce max tabs
    if (tabs.value.length >= MAX_TABS) {
      const toClose = tabs.value.find((t) => t.id !== activeTabId.value);
      if (toClose) closeTab(toClose.id);
    }

    const id = nextTabId++;
    const tab: RepoTab = { id, path: normalized, name: nameFromPath(normalized) };

    tabs.value.push(tab);
    activeTabId.value = id;

    addToHistory(normalized);
    save(tabs.value, activeTabId.value);
    return tab;
  }

  /**
   * Close a tab by ID. Switches to an adjacent tab if active.
   */
  function closeTab(tabId: number) {
    const index = tabs.value.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    tabs.value.splice(index, 1);

    if (activeTabId.value === tabId) {
      if (tabs.value.length > 0) {
        const newIndex = Math.min(index, tabs.value.length - 1);
        activeTabId.value = tabs.value[newIndex].id;
      } else {
        activeTabId.value = null;
      }
    }

    save(tabs.value, activeTabId.value);
  }

  /**
   * Switch to a tab by ID.
   */
  function switchTab(tabId: number) {
    if (tabs.value.some((t) => t.id === tabId)) {
      activeTabId.value = tabId;
    }
  }

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    switchTab,
  };
}
