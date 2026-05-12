/**
 * @file forge/GitLabProvider.ts
 *
 * GitLab implementation of ForgeProvider — v2.10 §2.x.
 *
 * Uses the `glab` CLI (gitlab.com/gitlab-org/cli) via Rust Tauri commands.
 * Auth is managed by `glab auth login` — no token ever passes through IPC.
 *
 * **Scope v2.10:**
 * - MR list, detail, diff, pipelines, create, merge, checkout, draft→ready
 * - Notes (comments) — general notes; diff-line anchoring via Discussions API
 *   is deferred to v2.11
 * - Approvals — approve + list approved-by users
 * - Reviewer candidates (project members)
 *
 * **Stubs (throw ForgeNotImplementedError):**
 * - updateComment / deleteComment — require MR iid alongside note_id; interface
 *   extension needed (v2.11)
 * - getConflictPreview — GitHub-specific git merge-tree analysis
 * - getHotspots — GitHub-specific commit graph analysis
 * - getFileHistory — GitHub-specific review history
 *
 * **Terminology**: GitLab uses "Merge Request" (MR) instead of "Pull Request"
 * (PR). The ForgeProvider interface uses PR terminology uniformly; the UI
 * renders the correct label by checking `forge.name`.
 */

import {
  glListMrs,
  glMrCount,
  glGetMr,
  glMrDiff,
  glMrPipelines,
  glCreateMr,
  glMergeMr,
  glCheckoutMr,
  glConvertDraftToReady,
  glMrNotes,
  glMrCreateNote,
  glApproveMr,
  glListReviews,
  glCurrentUser,
  glReviewerCandidates,
  glMrFiles,
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

export class GitLabProvider implements ForgeProvider {
  readonly name: ForgeName = "gitlab";

  detectFromRemote(remoteUrl: string): boolean {
    return remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab.");
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  getCurrentUser(cwd: string): Promise<string> {
    return glCurrentUser(cwd);
  }

  listReviewerCandidates(cwd: string): Promise<ReviewerCandidate[]> {
    return glReviewerCandidates(cwd);
  }

  // ── MR listing ─────────────────────────────────────────────────────────────

  listPRs(cwd: string, opts: ListPRsOptions = {}): Promise<PullRequest[]> {
    // Map ForgeProvider "open" → GitLab "opened"
    const state = opts.state === "open" ? "opened" : (opts.state ?? "opened");
    return glListMrs(cwd, state, opts.limit ?? 10, opts.offset ?? 0);
  }

  getPRCount(cwd: string, state: string = "open"): Promise<number> {
    const glState = state === "open" ? "opened" : state;
    return glMrCount(cwd, glState);
  }

  getPRFiles(cwd: string, prNumber: number): Promise<string[]> {
    return glMrFiles(cwd, prNumber);
  }

  // ── MR detail ──────────────────────────────────────────────────────────────

  getPR(cwd: string, number: number): Promise<PullRequestDetail> {
    return glGetMr(cwd, number);
  }

  getPRDiff(cwd: string, number: number): Promise<string> {
    return glMrDiff(cwd, number);
  }

  getCIChecks(cwd: string, number: number): Promise<CICheck[]> {
    return glMrPipelines(cwd, number);
  }

  // ── MR actions ─────────────────────────────────────────────────────────────

  createPR(cwd: string, input: CreatePRInput): Promise<PullRequest> {
    // source_branch is inferred by glab from the current HEAD when empty.
    return glCreateMr(
      cwd,
      input.title,
      input.body,
      /* sourceBranch — inferred from HEAD */ "",
      input.base ?? "",
      input.draft ?? false,
      input.reviewers,
    );
  }

  mergePR(cwd: string, number: number, method: "merge" | "squash" | "rebase" = "merge"): Promise<void> {
    return glMergeMr(cwd, number, method);
  }

  checkoutPR(cwd: string, number: number): Promise<void> {
    return glCheckoutMr(cwd, number);
  }

  convertDraftToReady(cwd: string, number: number): Promise<void> {
    return glConvertDraftToReady(cwd, number);
  }

  // ── Notes (comments) ───────────────────────────────────────────────────────
  //
  // v2.10 scope: general MR-level notes only. Diff-anchored inline comments
  // require the GitLab Discussions API and are deferred to v2.11.
  // The `path`, `line`, `diff_hunk` fields are always empty on GL notes.

  listComments(cwd: string, prNumber: number): Promise<PrReviewComment[]> {
    return glMrNotes(cwd, prNumber);
  }

  async createComment(
    cwd: string,
    prNumber: number,
    params: CreatePrCommentParams,
  ): Promise<PrReviewComment> {
    return glMrCreateNote(cwd, prNumber, params.body);
  }

  updateComment(_cwd: string, _commentId: number, _body: string): Promise<void> {
    // GitLab's notes endpoint requires the MR iid in addition to the note_id.
    // The ForgeProvider.updateComment signature only passes commentId (= note_id).
    // Requires a ForgeProvider interface extension in v2.11.
    throw new ForgeNotImplementedError(
      "gitlab",
      "updateComment — interface needs MR iid alongside note_id (v2.11)",
    );
  }

  deleteComment(_cwd: string, _commentId: number): Promise<void> {
    // Same limitation as updateComment.
    throw new ForgeNotImplementedError(
      "gitlab",
      "deleteComment — interface needs MR iid alongside note_id (v2.11)",
    );
  }

  // ── Reviews (approvals) ────────────────────────────────────────────────────
  //
  // GitLab uses an approval model rather than GitHub's review states:
  //   APPROVE          → POST /merge_requests/:iid/approve
  //   REQUEST_CHANGES  → no equivalent; create a blocking note
  //   COMMENT          → create a general note

  listReviews(cwd: string, prNumber: number): Promise<PrReview[]> {
    return glListReviews(cwd, prNumber);
  }

  async submitReview(cwd: string, prNumber: number, opts: SubmitReviewOptions): Promise<PrReview> {
    if (opts.event === "APPROVE") {
      await glApproveMr(cwd, prNumber);
      // glab mr approve doesn't return a review object — synthesize one.
      return {
        id: 0,
        state: "APPROVED",
        body: opts.body ?? "",
        user: { login: "", avatar_url: "" },
        submitted_at: new Date().toISOString(),
        html_url: "",
      };
    }

    // REQUEST_CHANGES or COMMENT: create a note with the body.
    if (opts.body) {
      const prefix = opts.event === "REQUEST_CHANGES" ? "**Changes requested:**\n\n" : "";
      await glMrCreateNote(cwd, prNumber, prefix + opts.body);
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
  //
  // These features rely on GitHub-specific APIs:
  //   - getConflictPreview: git merge-tree analysis via gh API
  //   - getHotspots: commit graph hotspot analysis via git log
  //   - getFileHistory: review history from GitHub review comments API
  //
  // getHotspots and getFileHistory could theoretically be reimplemented for
  // GitLab but are out of scope for v2.10.

  getConflictPreview(_cwd: string, _prNumber: number): Promise<PrConflictPreview> {
    throw new ForgeNotImplementedError("gitlab", "getConflictPreview");
  }

  getHotspots(_cwd: string, _paths: string[]): Promise<PrHotspot[]> {
    throw new ForgeNotImplementedError("gitlab", "getHotspots");
  }

  getFileHistory(_cwd: string, _paths: string[]): Promise<Record<string, PrFileHistory>> {
    throw new ForgeNotImplementedError("gitlab", "getFileHistory");
  }
}

/** Singleton — instancié une seule fois, partagé via useForge(). */
export const gitlabProvider = new GitLabProvider();
