/**
 * @file forge/AzureProvider.ts
 *
 * Azure DevOps Services implementation of ForgeProvider.
 *
 * Uses the Azure DevOps REST API (api-version 7.1) via `curl` through the Rust
 * Tauri commands in `commands/azure.rs`. Authentication is an Entra ID OAuth
 * access token, obtained through the device flow in Settings > Accounts and
 * stored in the OS keychain (service "gitwand:azure", account "oauth").
 *
 * **Scope (initial):** PR list/count/detail/diff/files/create/merge/checkout +
 * draft→ready. Diff and file lists are produced from local git (Azure DevOps
 * has no unified-patch endpoint).
 *
 * **Not yet implemented** (degrade gracefully / throw, matching the GitLab and
 * Bitbucket stub conventions): comments, reviews, reviewer candidates, CI
 * checks, and the per-file intelligence widgets. The conflict preview and
 * hotspot analysis are forge-agnostic (local git) and are reused as-is.
 */

import {
  azCurrentUser,
  azListPrs,
  azPrCount,
  azPrDetail,
  azPrDiff,
  azPrFiles,
  azCreatePr,
  azMergePr,
  azPrReady,
  azCheckoutPr,
  ghPrConflictPreview,
  ghPrHotspots,
} from "../../utils/backend";

import {
  ForgeNotImplementedError,
  type ForgeProvider,
  type ForgeName,
  type ListPRsOptions,
  type CreatePRInput,
  type SubmitReviewOptions,
  type PullRequest,
  type PullRequestDetail,
  type CICheck,
  type PrReviewComment,
  type CreatePrCommentParams,
  type PrReview,
  type PrConflictPreview,
  type PrHotspot,
  type PrFileHistory,
  type ReviewerCandidate,
  type Account,
} from "./types";

export class AzureProvider implements ForgeProvider {
  readonly name: ForgeName = "azure";

  /** Active account — stored for API completeness; auth resolves via keychain. */
  private _account: Account | null = null;

  setAccount(account: Account | null): void {
    this._account = account;
  }

  detectFromRemote(remoteUrl: string): boolean {
    return remoteUrl.includes("dev.azure.com") || remoteUrl.includes("visualstudio.com");
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  getCurrentUser(_cwd: string): Promise<string> {
    return azCurrentUser();
  }

  async listReviewerCandidates(_cwd: string): Promise<ReviewerCandidate[]> {
    // Azure DevOps identity picker not wired yet — UI degrades to free-text.
    return [];
  }

  // ── PR listing ─────────────────────────────────────────────────────────────

  listPRs(cwd: string, opts: ListPRsOptions = {}): Promise<PullRequest[]> {
    return azListPrs(cwd, opts.state ?? "open", opts.limit ?? 10, opts.offset ?? 0);
  }

  getPRCount(cwd: string, state: string = "open"): Promise<number> {
    return azPrCount(cwd, state);
  }

  getPRFiles(cwd: string, prNumber: number): Promise<string[]> {
    return azPrFiles(cwd, prNumber);
  }

  // ── PR detail ──────────────────────────────────────────────────────────────

  getPR(cwd: string, number: number): Promise<PullRequestDetail> {
    return azPrDetail(cwd, number);
  }

  getPRDiff(cwd: string, number: number): Promise<string> {
    return azPrDiff(cwd, number);
  }

  async getCIChecks(_cwd: string, _number: number): Promise<CICheck[]> {
    // Azure Pipelines status not wired yet — empty rollup (no checks shown).
    return [];
  }

  // ── PR actions ─────────────────────────────────────────────────────────────

  createPR(cwd: string, input: CreatePRInput): Promise<PullRequest> {
    // baseRepo (cross-fork) and reviewers are GitHub-only here — ignored.
    return azCreatePr(cwd, input.title, input.body ?? "", input.base, input.draft);
  }

  mergePR(cwd: string, number: number, method: "merge" | "squash" | "rebase" = "merge"): Promise<void> {
    return azMergePr(cwd, number, method);
  }

  checkoutPR(cwd: string, number: number): Promise<void> {
    return azCheckoutPr(cwd, number);
  }

  convertDraftToReady(cwd: string, number: number): Promise<void> {
    return azPrReady(cwd, number);
  }

  // ── Comments (not yet implemented) ─────────────────────────────────────────

  async listComments(_cwd: string, _prNumber: number): Promise<PrReviewComment[]> {
    return [];
  }

  createComment(_cwd: string, _prNumber: number, _params: CreatePrCommentParams): Promise<PrReviewComment> {
    throw new ForgeNotImplementedError("azure", "createComment");
  }

  updateComment(_cwd: string, _commentId: number, _body: string, _prNumber?: number): Promise<void> {
    throw new ForgeNotImplementedError("azure", "updateComment");
  }

  deleteComment(_cwd: string, _commentId: number, _prNumber?: number): Promise<void> {
    throw new ForgeNotImplementedError("azure", "deleteComment");
  }

  // ── Reviews (not yet implemented) ──────────────────────────────────────────

  async listReviews(_cwd: string, _prNumber: number): Promise<PrReview[]> {
    return [];
  }

  submitReview(_cwd: string, _prNumber: number, _opts: SubmitReviewOptions): Promise<PrReview> {
    throw new ForgeNotImplementedError("azure", "submitReview");
  }

  // ── Intelligence ───────────────────────────────────────────────────────────

  getConflictPreview(cwd: string, prNumber: number): Promise<PrConflictPreview> {
    // git merge-tree is local git data — forge-agnostic.
    return ghPrConflictPreview(cwd, prNumber);
  }

  getHotspots(cwd: string, paths: string[]): Promise<PrHotspot[]> {
    // git log --merges analysis is purely local — forge-agnostic.
    return ghPrHotspots(cwd, paths);
  }

  async getFileHistory(_cwd: string, paths: string[]): Promise<Record<string, PrFileHistory>> {
    const result: Record<string, PrFileHistory> = {};
    for (const path of paths) {
      result[path] = { reviewCommentCount: 0, reviewers: [], lastComment: null };
    }
    return result;
  }
}

/** Singleton — instantiated once, shared via useForge(). */
export const azureProvider = new AzureProvider();
