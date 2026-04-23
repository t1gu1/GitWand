/**
 * useCommitActions — commit context-menu modal state + handlers (v1.9)
 *
 * Encapsulates the modal lifecycle (checkout, reset, create branch, tag) and
 * the fire-and-forget actions (revert, cherry-pick, view on forge) that the
 * commit right-click menu exposes in CommitLog → RepoSidebar → App.
 *
 * Usage:
 *   const commitActions = useCommitActions({ repoFolderPath, repoError, loadLog, loadBranches, repoRefresh });
 *   // spread handlers on the template: v-bind="commitActions.handlers"
 */

import { ref } from "vue";
import type { Ref } from "vue";
import type { GitLogEntry } from "../utils/backend";
import {
  gitCheckoutCommit,
  gitResetToCommit,
  gitRevertCommit,
  gitCreateBranch,
  gitCreateTag,
  gitCherryPick,
  gitRemoteInfo,
} from "../utils/backend";
import { useI18n } from "./useI18n";

// ─── Types ───────────────────────────────────────────────

export interface CommitActionModal {
  type: "checkout" | "reset" | "createBranch" | "tag" | null;
  entry: GitLogEntry | null;
  resetMode: "soft" | "mixed" | "hard";
  branchName: string;
  tagName: string;
  tagMessage: string;
  busy: boolean;
  error: string;
}

interface Deps {
  repoFolderPath: Ref<string | null>;
  repoError: Ref<string | null>;
  loadLog: () => Promise<void>;
  loadBranches: () => void;
  repoRefresh: () => Promise<void>;
}

// ─── Composable ──────────────────────────────────────────

export function useCommitActions(deps: Deps) {
  const { t } = useI18n();
  const { repoFolderPath, repoError, loadLog, loadBranches, repoRefresh } = deps;

  // ── Modal state ────────────────────────────────────────

  const modal = ref<CommitActionModal>({
    type: null,
    entry: null,
    resetMode: "mixed",
    branchName: "",
    tagName: "",
    tagMessage: "",
    busy: false,
    error: "",
  });

  function closeModal() {
    modal.value = { ...modal.value, type: null, entry: null, busy: false, error: "" };
  }

  // ── Checkout commit ────────────────────────────────────

  function handleCheckoutCommit(entry: GitLogEntry) {
    modal.value = { ...modal.value, type: "checkout", entry, error: "" };
  }

  async function confirmCheckoutCommit() {
    const entry = modal.value.entry;
    const cwd = repoFolderPath.value;
    if (!entry || !cwd) return;
    modal.value.busy = true;
    try {
      await gitCheckoutCommit(cwd, entry.hashFull);
      closeModal();
      await Promise.all([loadLog(), repoRefresh()]);
      loadBranches();
    } catch (err: any) {
      modal.value.error = err?.message ?? String(err);
    } finally {
      modal.value.busy = false;
    }
  }

  // ── Reset to commit ────────────────────────────────────

  function handleResetToCommit(entry: GitLogEntry) {
    modal.value = { ...modal.value, type: "reset", entry, resetMode: "mixed", error: "" };
  }

  async function confirmResetToCommit() {
    const entry = modal.value.entry;
    const cwd = repoFolderPath.value;
    if (!entry || !cwd) return;
    modal.value.busy = true;
    try {
      await gitResetToCommit(cwd, entry.hashFull, modal.value.resetMode);
      closeModal();
      // repoRefresh reloads staged/unstaged status — critical for --hard.
      await Promise.all([loadLog(), repoRefresh()]);
      loadBranches();
    } catch (err: any) {
      modal.value.error = err?.message ?? String(err);
    } finally {
      modal.value.busy = false;
    }
  }

  // ── Revert commit (fire-and-forget) ───────────────────

  async function handleRevertCommit(entry: GitLogEntry) {
    const cwd = repoFolderPath.value;
    if (!cwd) return;
    const isMerge = (entry.parents?.length ?? 0) > 1;
    try {
      const result = await gitRevertCommit(cwd, entry.hashFull, isMerge ? 1 : undefined);
      if (!result.success) {
        repoError.value = result.conflicts
          ? t("commitCtx.revertConflicts")
          : result.message || t("commitCtx.revertFailed");
      }
      await loadLog();
    } catch (err: any) {
      repoError.value = err?.message ?? String(err);
    }
  }

  // ── Create branch from commit ──────────────────────────

  function handleCreateBranchFromCommit(entry: GitLogEntry) {
    modal.value = { ...modal.value, type: "createBranch", entry, branchName: "", error: "" };
  }

  async function confirmCreateBranchFromCommit() {
    const entry = modal.value.entry;
    const cwd = repoFolderPath.value;
    const name = modal.value.branchName.trim();
    if (!entry || !cwd || !name) return;
    modal.value.busy = true;
    try {
      await gitCreateBranch(cwd, name, true, entry.hashFull);
      closeModal();
      await loadLog();
      loadBranches();
    } catch (err: any) {
      modal.value.error = err?.message ?? String(err);
    } finally {
      modal.value.busy = false;
    }
  }

  // ── Tag commit ─────────────────────────────────────────

  function handleTagCommit(entry: GitLogEntry) {
    modal.value = { ...modal.value, type: "tag", entry, tagName: "", tagMessage: "", error: "" };
  }

  async function confirmTagCommit() {
    const entry = modal.value.entry;
    const cwd = repoFolderPath.value;
    const name = modal.value.tagName.trim();
    if (!entry || !cwd || !name) return;
    modal.value.busy = true;
    try {
      await gitCreateTag(cwd, name, entry.hashFull, modal.value.tagMessage || undefined);
      closeModal();
    } catch (err: any) {
      modal.value.error = err?.message ?? String(err);
    } finally {
      modal.value.busy = false;
    }
  }

  // ── Cherry-pick (fire-and-forget) ─────────────────────

  async function handleCherryPickCommit(entry: GitLogEntry) {
    const cwd = repoFolderPath.value;
    if (!cwd) return;
    try {
      const result = await gitCherryPick(cwd, [entry.hashFull]);
      if (!result.success) {
        repoError.value = result.conflicts
          ? t("commitCtx.cherryPickConflicts")
          : result.message || t("commitCtx.cherryPickFailed");
      }
      await loadLog();
    } catch (err: any) {
      repoError.value = err?.message ?? String(err);
    }
  }

  // ── View on forge (fire-and-forget) ───────────────────

  async function handleViewOnForge(entry: GitLogEntry) {
    const cwd = repoFolderPath.value;
    if (!cwd) return;
    try {
      const info = await gitRemoteInfo(cwd);
      if (!info.owner || !info.repo) {
        repoError.value = t("commitCtx.noRemote");
        return;
      }
      const base =
        info.provider === "gitlab"
          ? `https://gitlab.com/${info.owner}/${info.repo}/-/commit/${entry.hashFull}`
          : info.provider === "bitbucket"
            ? `https://bitbucket.org/${info.owner}/${info.repo}/commits/${entry.hashFull}`
            : `https://github.com/${info.owner}/${info.repo}/commit/${entry.hashFull}`;
      window.open(base, "_blank");
    } catch {
      repoError.value = t("commitCtx.noRemote");
    }
  }

  // ── Public API ─────────────────────────────────────────

  return {
    /** Reactive modal state — bind to BaseModal v-if + form inputs in the template. */
    commitActionModal: modal,
    closeCommitActionModal: closeModal,
    // Handlers wired from RepoSidebar emits
    handleCheckoutCommit,
    handleResetToCommit,
    handleRevertCommit,
    handleCreateBranchFromCommit,
    handleTagCommit,
    handleCherryPickCommit,
    handleViewOnForge,
    // Confirm callbacks called from modal footers
    confirmCheckoutCommit,
    confirmResetToCommit,
    confirmCreateBranchFromCommit,
    confirmTagCommit,
  };
}
