/**
 * useSettings — Centralized settings reader.
 *
 * SettingsPanel owns the write logic (localStorage + emit for immediate effects).
 * This composable provides a read path for any component that needs settings
 * at action time (switch behavior, notifications gate, default branch sort, etc.)
 *
 * Usage:
 *   const { settings, refreshSettings } = useSettings()
 */

import { ref } from "vue";
import type { DiffMode } from "../utils/diffMode";
import type { BlameAlgorithm } from "../utils/backend";
import type { AIProvider } from "./useAIProvider";

// ─── Types ────────────────────────────────────────────────

export type PullMode = "merge" | "rebase";
export type SwitchBehavior = "stash" | "ask" | "refuse";
export type LaunchpadTab = "wip" | "prs" | "issues" | "team";

/** Named committer identity — stored in AppSettings, selected per-commit or per-repo (v2.12). */
export interface IdentityProfile {
  /** UUID v4 — stable key across renames. */
  id: string;
  /** Human label shown in the selector, e.g. "Perso", "Pro", "Client Acme". */
  label: string;
  /** git user.name */
  gitName: string;
  /** git user.email */
  gitEmail: string;
  /** Optional GPG key ID (short, e.g. "A1B2C3D4"). */
  gpgKey?: string;
}

/** Named commit message template (v2.12). */
export interface CommitTemplate {
  /** UUID v4. */
  id: string;
  /** Display name, e.g. "Fix one-liner", "RFC", "ADR". */
  name: string;
  /** Subject line. Use ${cursor} to mark caret position after insertion. */
  subject: string;
  /** Optional body text. */
  body: string;
}

export interface AppSettings {
  editor: string;
  gitPath: string;
  defaultBranch: string;
  commitSignature: boolean;
  diffMode: DiffMode;
  pullMode: PullMode;
  switchBehavior: SwitchBehavior;
  fontSize: number;
  tabSize: number;
  notifications: boolean;
  /** Diff algorithm used for git blame. "histogram" gives the best blame results for most codebases. */
  blameAlgorithm: BlameAlgorithm;
  /** Auto-update channel (v2.0). "stable" = Tauri plugin auto-install; "beta" = manual fetch + browser-open. */
  updateChannel: "stable" | "beta";
  /** Language used for AI-generated commit messages. "" = follow UI locale. */
  commitMessageLang: string;
  /** Whether AI features are enabled. */
  aiEnabled: boolean;
  /** Active AI provider. */
  aiProvider: AIProvider;
  /** API key for Claude / OpenAI providers. */
  aiApiKey: string;
  /** API endpoint override (Claude / OpenAI-compatible). */
  aiApiEndpoint: string;
  /** Model name for Claude / OpenAI providers. */
  aiModel: string;
  /** Ollama base URL. */
  aiOllamaUrl: string;
  /** Ollama model name. */
  aiOllamaModel: string;
  /** Last active tab in Launchpad — persisted between openings (v2.9). */
  launchpadActiveTab: LaunchpadTab;
  /**
   * Whether the Launchpad Team tab is enabled (v2.9). When false, the tab
   * is hidden and the (expensive) team activity fetch — one `gh pr view
   * --json files` per colleague PR, ~10s on a 50-PR workspace — is never
   * triggered. Default: true.
   */
  launchpadTeamTabEnabled: boolean;
  /** Automation settings (v2.8). */
  automations: {
    /** Auto-resolve conflicts the moment MERGE_HEAD appears. */
    autoResolve: { enabled: boolean };
    /** Pull + rebase all repos in workspace at a fixed time each day. */
    nightlyPull: { enabled: boolean; hour: number; minute: number };
    /** Generate release notes when a v* tag is created. */
    releaseNotes: { enabled: boolean };
    /** Suggest an AI commit message when staged files are present at app close. */
    aiCommitBatch: { enabled: boolean };
  };

  // ── v2.12 Branch Management & Identity ────────────────────

  /**
   * Branches archived by the user, keyed by normalised repo path (cwd).
   * Archived branches are hidden from the main branch list and shown in a
   * collapsed "Archivées" section. Never deleted from git — only hidden in GitWand.
   */
  archivedBranches: Record<string, string[]>;

  /**
   * User-chosen pinned branches, keyed by cwd, in display order.
   * Replaces the former auto-computed top-5-by-activity heuristic.
   */
  pinnedBranchesByRepo: Record<string, string[]>;

  /**
   * Number of days without a commit after which a branch receives an "Inactif"
   * badge in the sidebar. 0 = disabled. Default: 30.
   */
  inactiveBranchDays: number;

  /** Named committer identity profiles (v2.12). */
  identities: IdentityProfile[];

  /**
   * ID of the globally active identity profile, or null to use the git
   * global config (user.name / user.email).
   */
  activeIdentityId: string | null;

  /**
   * Per-repo identity override. Keys are normalised cwd paths; values are
   * IdentityProfile.id. Takes precedence over activeIdentityId.
   */
  identityOverrideByRepo: Record<string, string>;

  /** Saved commit message templates (v2.12). */
  commitTemplates: CommitTemplate[];
}

// ─── Defaults ─────────────────────────────────────────────

export const defaultAppSettings: AppSettings = {
  editor: "",
  gitPath: "",
  defaultBranch: "main",
  commitSignature: true,
  diffMode: "inline",
  pullMode: "merge",
  switchBehavior: "ask",
  fontSize: 12,
  tabSize: 4,
  notifications: true,
  blameAlgorithm: "histogram",
  updateChannel: "stable",
  commitMessageLang: "",
  aiEnabled: false,
  aiProvider: "none",
  aiApiKey: "",
  aiApiEndpoint: "https://api.anthropic.com",
  aiModel: "claude-sonnet-4-20250514",
  aiOllamaUrl: "http://localhost:11434",
  aiOllamaModel: "codellama",
  launchpadActiveTab: "wip",
  launchpadTeamTabEnabled: true,
  automations: {
    autoResolve:    { enabled: false },
    nightlyPull:    { enabled: false, hour: 8, minute: 0 },
    releaseNotes:   { enabled: false },
    aiCommitBatch:  { enabled: false },
  },
  // v2.12
  archivedBranches:       {},
  pinnedBranchesByRepo:   {},
  inactiveBranchDays:     30,
  identities:             [],
  activeIdentityId:       null,
  identityOverrideByRepo: {},
  commitTemplates:        [],
};

const SETTINGS_KEY = "gitwand-settings";

// ─── Load / save helpers ──────────────────────────────────

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultAppSettings, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...defaultAppSettings };
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// ─── Singleton reactive ref ───────────────────────────────
// Shared across all useSettings() calls in the same Vue app instance.

const _settings = ref<AppSettings>(loadSettings());

/** Re-read all settings from localStorage (call after SettingsPanel saves). */
export function refreshSettings(): void {
  _settings.value = loadSettings();
}

// ─── Composable ───────────────────────────────────────────

export function useSettings() {
  return {
    /** Reactive settings ref. Updated by refreshSettings(). */
    settings: _settings,
    /** Re-sync settings from localStorage (call on settings panel close). */
    refreshSettings,
    /** One-shot read without reactivity. Useful in event handlers. */
    loadSettings,
    /** Persist the current settings object to localStorage. */
    saveSettings,
  };
}
