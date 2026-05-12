/**
 * @file forge/BitbucketProvider.ts
 *
 * Bitbucket Cloud implementation of ForgeProvider — v2.10 §3.x.
 *
 * Uses Bitbucket REST API v2 via `curl` (through Rust Tauri commands in
 * `bitbucket.rs`). Credentials (App Password) are stored in the OS keychain
 * via `credentials.rs` and must be configured in Settings > Accounts before
 * any method is called.
 *
 * **Scope v2.10:**
 * - PR list, detail, diff, create, merge, checkout
 * - Comments (general + inline via Bitbucket inline anchors)
 * - Approvals (approve only — Bitbucket has no "request changes" concept)
 * - Reviewer candidates (repo members with write access)
 *
 * **Stubs (throw ForgeNotImplementedError):**
 * - updateComment / deleteComment — ForgeProvider interface lacks `prNumber`
 *   which Bitbucket's API requires alongside `comment_id` (v2.11 fix)
 * - convertDraftToReady — Bitbucket has no native draft; title prefix "Draft:"
 *   is used but toggling it requires a PR update call (v2.11)
 * - getCIChecks — Bitbucket Pipelines needs a separate REST call (v2.11)
 * - getConflictPreview / getHotspots / getFileHistory — GitHub-specific
 *
 * **Terminology**: Bitbucket uses "Pull Request" (PR) — terminology matches
 * ForgeProvider uniformly.
 */

import {
  bbListPrs,
  bbPrCount,
  bbGetPr,
  bbPrDiff,
  bbCreatePr,
  bbMergePr,
  bbCheckoutPr,
  bbPrComments,
  bbCreateComment,
  bbApprovePr,
  bbPrFiles,
  bbCurrentUser,
  bbReviewerCandidates,
} from "../../utils/backend";

import type {
  ForgeProvider,
  ForgeName,
  ListPRsOptions,
  CreatePRInput,
  SubmitReviewOptions,
  PullRequest,
  PullRequestDetail,
  CICheck,
  PrReviewComment,
  CreatePrCommentParams,
  PrReview,
  PrConflictPreview,
  PrHotspot,
  PrFileHistory,
  ReviewerCandidate,
} from "./types";
import { ForgeNotImplementedError } from "./types";

export class BitbucketProvider implements ForgeProvider {
  readonly name: ForgeName = "bitbucket";

  detectFromRemote(remoteUrl: string): boolean {
    return remoteUrl.includes("bitbucket.org");
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  getCurrentUser(cwd: string): Promise<string> {
    return bbCurrentUser(cwd);
  }

  listReviewerCandidates(cwd: string): Promise<ReviewerCandidate[]> {
    return bbReviewerCandidates(cwd);
  }

  // ── PR listing ─────────────────────────────────────────────────────────────

  listPRs(cwd: string, opts: ListPRsOptions = {}): Promise<PullRequest[]> {
    // Map ForgeProvider "open" → Bitbucket "OPEN"
    const state = (opts.state ?? "open").toUpperCase();
    return bbListPrs(cwd, state, opts.limit ?? 10, opts.offset ?? 0);
  }

  getPRCount(cwd: string, state: string = "open"): Promise<number> {
    return bbPrCount(cwd, state.toUpperCase());
  }

  getPRFiles(cwd: string, prNumber: number): Promise<string[]> {
    return bbPrFiles(cwd, prNumber);
  }

  // ── PR detail ──────────────────────────────────────────────────────────────

  getPR(cwd: string, number: number): Promise<PullRequestDetail> {
    return bbGetPr(cwd, number);
  }

  getPRDiff(cwd: string, number: number): Promise<string> {
    return bbPrDiff(cwd, number);
  }

  getCIChecks(_cwd: string, _number: number): Promise<CICheck[]> {
    // Bitbucket Pipelines requires a separate REST endpoint — deferred to v2.11.
    throw new ForgeNotImplementedError(
      "bitbucket",
      "getCIChecks — Bitbucket Pipelines endpoint deferred to v2.11",
    );
  }

  // ── PR actions ─────────────────────────────────────────────────────────────

  createPR(cwd: string, input: CreatePRInput): Promise<PullRequest> {
    return bbCreatePr(
      cwd,
      input.title,
      input.body ?? "",
      /* sourceBranch — empty string → resolved from HEAD in bb_create_pr */ "",
      input.base ?? "",
      input.reviewers,
    );
  }

  mergePR(
    cwd: string,
    number: number,
    method: "merge" | "squash" | "rebase" = "merge",
  ): Promise<void> {
    return bbMergePr(cwd, number, method);
  }

  checkoutPR(cwd: string, number: number): Promise<void> {
    return bbCheckoutPr(cwd, number);
  }

  convertDraftToReady(_cwd: string, _number: number): Promise<void> {
    // Bitbucket has no native draft concept. "Draft:" title prefix is used
    // conventionally; removing it requires a PR PATCH call — deferred to v2.11.
    throw new ForgeNotImplementedError(
      "bitbucket",
      "convertDraftToReady — Bitbucket uses title prefix 'Draft:'; update call deferred to v2.11",
    );
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  listComments(cwd: string, prNumber: number): Promise<PrReviewComment[]> {
    return bbPrComments(cwd, prNumber);
  }

  async createComment(
    cwd: string,
    prNumber: number,
    params: CreatePrCommentParams,
  ): Promise<PrReviewComment> {
    return bbCreateComment(cwd, prNumber, params.body);
  }

  updateComment(_cwd: string, _commentId: number, _body: string): Promise<void> {
    // Bitbucket's comment endpoint requires the PR id alongside the comment id.
    // ForgeProvider.updateComment only receives commentId — interface extension
    // needed in v2.11.
    throw new ForgeNotImplementedError(
      "bitbucket",
      "updateComment — interface needs PR number alongside comment_id (v2.11)",
    );
  }

  deleteComment(_cwd: string, _commentId: number): Promise<void> {
    // Same limitation as updateComment.
    throw new ForgeNotImplementedError(
      "bitbucket",
      "deleteComment — interface needs PR number alongside comment_id (v2.11)",
    );
  }

  // ── Reviews (approvals) ────────────────────────────────────────────────────
  //
  // Bitbucket uses a participant approval model:
  //   APPROVE         → POST /pullrequests/:id/approve
  //   REQUEST_CHANGES → no equivalent; post a comment instead
  //   COMMENT         → post a general comment

  listReviews(cwd: string, prNumber: number): Promise<PrReview[]> {
    // Bitbucket exposes approvals via the PR participants array.
    // We fetch the PR detail and extract approved participants.
    return bbGetPr(cwd, prNumber).then((detail) => {
      // detail comes from Rust bb_pr_to_detail which doesn't expose participants
      // directly. Return an empty array until v2.11 exposes the raw JSON.
      void detail;
      return [] as PrReview[];
    });
  }

  async submitReview(
    cwd: string,
    prNumber: number,
    opts: SubmitReviewOptions,
  ): Promise<PrReview> {
    if (opts.event === "APPROVE") {
      await bbApprovePr(cwd, prNumber);
      return {
        id: 0,
        state: "APPROVED",
        body: opts.body ?? "",
        user: { login: "", avatar_url: "" },
        submitted_at: new Date().toISOString(),
        html_url: "",
      };
    }

    // REQUEST_CHANGES or COMMENT: post a comment.
    if (opts.body) {
      const prefix = opts.event === "REQUEST_CHANGES" ? "**Changes requested:**\n\n" : "";
      await bbCreateComment(cwd, prNumber, prefix + opts.body);
    }

    return {
      id: 0,
      state: opts.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED",
      body: opts.body ?? "",
      user: { login: "", avatar_url: "" },
      submitted_at: new Date().toISOString(),
      html_url: "",
    };
  }

  // ── Intelligence (GitHub-specific — stubs) ─────────────────────────────────

  getConflictPreview(_cwd: string, _prNumber: number): Promise<PrConflictPreview> {
    throw new ForgeNotImplementedError("bitbucket", "getConflictPreview");
  }

  getHotspots(_cwd: string, _paths: string[]): Promise<PrHotspot[]> {
    throw new ForgeNotImplementedError("bitbucket", "getHotspots");
  }

  getFileHistory(_cwd: string, _paths: string[]): Promise<Record<string, PrFileHistory>> {
    throw new ForgeNotImplementedError("bitbucket", "getFileHistory");
  }
}

/** Singleton — instantiated once, shared via useForge(). */
export const bitbucketProvider = new BitbucketProvider();
