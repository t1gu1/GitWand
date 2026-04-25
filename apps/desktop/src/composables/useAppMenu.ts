import { onMounted, onUnmounted, watch, type ComputedRef, type Ref } from "vue";
import { Menu, Submenu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useI18n } from "./useI18n";
import { useFolderHistory } from "./useFolderHistory";
import { isTauri } from "../utils/backend";

/**
 * Native macOS menu bar — File / Edit / Repository / View / Window / Help.
 *
 * Why this composable exists: Tauri 2 exposes a JS-side menu API
 * (`@tauri-apps/api/menu`), so we build the menu entirely from the frontend
 * and pull labels from the existing `useI18n` system instead of duplicating
 * them in Rust. The menu rebuilds on locale change and on repo open/close
 * (so repo-only items are disabled when no repo is loaded).
 *
 * Scope notes:
 * - Predefined items (Cut/Copy/Paste/SelectAll, Minimize/Zoom/Fullscreen,
 *   Hide/HideOthers/ShowAll/Quit, About) are used wherever possible. They
 *   route to the focused responder natively, which means Cmd+Z stays
 *   webview-default for text undo (we deliberately don't claim it for the
 *   GitWand undo stack — text editing in inputs would break otherwise).
 * - Items planned in v2.0.0 but not yet implemented (Clone, Fork, Find in
 *   Log, Open in Terminal, Toggle Sidebar) are omitted. They'll be added
 *   when their respective handlers exist.
 * - Disabled on non-macOS — Linux/Windows menu bars conflict with the
 *   custom AppHeader; we only opt into native menus on macOS where users
 *   expect the system menu bar.
 */

// ─── Action contract ────────────────────────────────────

/**
 * Callbacks the menu needs from App.vue. Each one mirrors an existing
 * handler — the menu is a thin façade, not a new control plane.
 */
export interface AppMenuActions {
  // File
  openFolder: () => void;
  openRecentFolder: (path: string) => void;
  clearRecents: () => void;
  closeWindow: () => void;
  // Repository
  fetch: () => void;
  pull: () => void;
  push: () => void;
  newBranch: () => void;
  openOnForge: () => void;
  // View
  toggleTheme: () => void;
  // Help
  checkForUpdates: () => void;
  // App
  openSettings: () => void;
}

export interface AppMenuState {
  hasRepo: ComputedRef<boolean> | Ref<boolean>;
}

// ─── External URLs ──────────────────────────────────────

const URL_DOCUMENTATION = "https://gitwand.devlint.fr/";
const URL_WHATS_NEW = "https://github.com/devlint/GitWand/releases";
const URL_REPORT_ISSUE = "https://github.com/devlint/GitWand/issues/new";

// ─── Platform detection ─────────────────────────────────

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // navigator.platform is deprecated but still the most reliable shortcut
  // for "user is on macOS" inside a Tauri webview. userAgentData isn't
  // exposed by WebKit reliably.
  const platformStr =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    "";
  return /Mac/i.test(platformStr);
}

// ─── Composable ─────────────────────────────────────────

/**
 * Install the native macOS menu bar. No-op on non-macOS or when running
 * outside Tauri (browser dev mode).
 */
export function useAppMenu(actions: AppMenuActions, state: AppMenuState) {
  const { t, locale } = useI18n();
  const { history } = useFolderHistory();

  const enabled = isTauri() && isMacPlatform();

  /** Build (or rebuild) the entire menu and install it as the app menu. */
  async function build() {
    if (!enabled) return;

    // ── App menu (first submenu — macOS auto-renames it after the bundle)
    const appSubmenu = await Submenu.new({
      text: "GitWand",
      items: [
        await PredefinedMenuItem.new({ item: { About: { name: "GitWand" } } }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "app-settings",
          text: t("menu.preferences"),
          accelerator: "CmdOrCtrl+,",
          action: () => actions.openSettings(),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Services" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Hide" }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });

    // ── File menu — Open Recent populated from useFolderHistory
    const recents = history.value.slice(0, 10);
    const recentItems = recents.length > 0
      ? await Promise.all(
          recents.map((entry) =>
            MenuItem.new({
              id: `recent-${entry.path}`,
              text: entry.name,
              action: () => actions.openRecentFolder(entry.path),
            }),
          ),
        )
      : [
          await MenuItem.new({
            id: "no-recents",
            text: t("menu.noRecents"),
            enabled: false,
          }),
        ];

    const recentSubmenu = await Submenu.new({
      text: t("menu.openRecent"),
      items: [
        ...recentItems,
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "clear-recents",
          text: t("menu.clearRecents"),
          enabled: recents.length > 0,
          action: () => actions.clearRecents(),
        }),
      ],
    });

    const fileSubmenu = await Submenu.new({
      text: t("menu.file"),
      items: [
        await MenuItem.new({
          id: "open-repository",
          text: t("menu.openRepository"),
          accelerator: "CmdOrCtrl+O",
          action: () => actions.openFolder(),
        }),
        recentSubmenu,
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "close-window",
          text: t("menu.closeWindow"),
          accelerator: "CmdOrCtrl+W",
          action: () => actions.closeWindow(),
        }),
      ],
    });

    // ── Edit menu — predefined only. Cmd+Z stays webview-default.
    const editSubmenu = await Submenu.new({
      text: t("menu.edit"),
      items: [
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
      ],
    });

    // ── Repository menu — disabled when no repo loaded
    const hasRepo = state.hasRepo.value;
    const repositorySubmenu = await Submenu.new({
      text: t("menu.repository"),
      enabled: hasRepo,
      items: [
        await MenuItem.new({
          id: "repo-fetch",
          text: t("menu.fetch"),
          accelerator: "CmdOrCtrl+Shift+F",
          enabled: hasRepo,
          action: () => actions.fetch(),
        }),
        await MenuItem.new({
          id: "repo-pull",
          text: t("menu.pull"),
          enabled: hasRepo,
          action: () => actions.pull(),
        }),
        await MenuItem.new({
          id: "repo-push",
          text: t("menu.push"),
          accelerator: "CmdOrCtrl+P",
          enabled: hasRepo,
          action: () => actions.push(),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "repo-new-branch",
          text: t("menu.newBranch"),
          accelerator: "CmdOrCtrl+Shift+B",
          enabled: hasRepo,
          action: () => actions.newBranch(),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "repo-open-on-forge",
          text: t("menu.openOnForge"),
          enabled: hasRepo,
          action: () => actions.openOnForge(),
        }),
      ],
    });

    // ── View menu
    const viewSubmenu = await Submenu.new({
      text: t("menu.view"),
      items: [
        await MenuItem.new({
          id: "view-toggle-theme",
          text: t("menu.toggleTheme"),
          accelerator: "CmdOrCtrl+Shift+T",
          action: () => actions.toggleTheme(),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Fullscreen" }),
      ],
    });

    // ── Window menu — predefined items + macOS auto-adds window list
    const windowSubmenu = await Submenu.new({
      text: t("menu.window"),
      items: [
        await PredefinedMenuItem.new({ item: "Minimize" }),
        await PredefinedMenuItem.new({ item: "Maximize" }),
      ],
    });
    await windowSubmenu.setAsWindowsMenuForNSApp();

    // ── Help menu — opens external URLs + Check for Updates
    const helpSubmenu = await Submenu.new({
      text: t("menu.help"),
      items: [
        await MenuItem.new({
          id: "help-documentation",
          text: t("menu.documentation"),
          action: () => window.open(URL_DOCUMENTATION, "_blank"),
        }),
        await MenuItem.new({
          id: "help-whats-new",
          text: t("menu.whatsNew"),
          action: () => window.open(URL_WHATS_NEW, "_blank"),
        }),
        await MenuItem.new({
          id: "help-report-issue",
          text: t("menu.reportIssue"),
          action: () => window.open(URL_REPORT_ISSUE, "_blank"),
        }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await MenuItem.new({
          id: "help-check-updates",
          text: t("menu.checkForUpdates"),
          action: () => actions.checkForUpdates(),
        }),
      ],
    });
    await helpSubmenu.setAsHelpMenuForNSApp();

    // ── Top-level menu
    const menu = await Menu.new({
      items: [
        appSubmenu,
        fileSubmenu,
        editSubmenu,
        repositorySubmenu,
        viewSubmenu,
        windowSubmenu,
        helpSubmenu,
      ],
    });

    await menu.setAsAppMenu();
  }

  // Rebuild on the things that affect menu shape: locale (all labels),
  // hasRepo (Repository menu enabled state), and recents history (Open Recent).
  let stopWatcher: (() => void) | null = null;

  onMounted(() => {
    void build();
    stopWatcher = watch(
      [
        locale,
        () => state.hasRepo.value,
        () => history.value.map((e) => `${e.pinned ? "p" : ""}${e.path}`).join("|"),
      ],
      () => {
        // Fire-and-forget — Tauri serializes setAsAppMenu calls.
        void build();
      },
    );
  });

  onUnmounted(() => {
    stopWatcher?.();
  });
}
