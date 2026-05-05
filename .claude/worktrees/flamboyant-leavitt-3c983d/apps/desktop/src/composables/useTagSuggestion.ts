/**
 * useTagSuggestion — AI-assisted tag name + message generation.
 *
 * Given the current repo, it:
 *   1. Finds the most recent tag (via gitListTags).
 *   2. Fetches the commits between that tag and HEAD.
 *   3. Asks the AI to suggest the next semantic-version tag name and a
 *      one-line annotated-tag message summarising the changes.
 *
 * Follows the same pattern as useBranchName / useCommitMessage.
 */

import { ref } from "vue";
import { gitListTags, gitExec } from "../utils/backend";
import { useAIProvider } from "./useAIProvider";
import { t } from "./useI18n";

export interface TagSuggestion {
  name: string;     // e.g. "v1.9.0"
  message: string;  // e.g. "Tags manager, commit context menu, 12 new git operations"
}

// ─── Shared state (module-level, reset each call) ────────
const isGenerating = ref(false);
const lastError = ref<string | null>(null);

// ─── Prompts ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a release engineer helping create a Git tag.
Given the latest tag and the list of commits since it, you must output:
1. The next semantic-version tag name following semver (e.g. v1.9.0).
   - Major bump (X.0.0): only if commits include a breaking change (BREAKING CHANGE in footer, or "!" after type).
   - Minor bump (x.Y.0): if any commit has type "feat".
   - Patch bump (x.y.Z): otherwise (fix, chore, docs, refactor, style, test, perf, ci, build).
   - If no previous tag exists, suggest "v0.1.0".
2. A concise annotated-tag message (one sentence, max 80 chars) summarising the main changes.
   Focus on user-visible features; skip pure chore/docs entries.

Output format — exactly two lines, nothing else:
NAME: <tag name>
MSG: <one-sentence message>`;
}

function buildUserPrompt(lastTag: string, commits: string): string {
  return `Latest tag: ${lastTag || "(none)"}

Commits since last tag (newest first):
${commits || "(no commits)"}

Suggest the next tag.`;
}

// ─── Parsing ─────────────────────────────────────────────

function parseResponse(raw: string): TagSuggestion | null {
  const lines = raw.trim().split("\n");
  let name = "";
  let message = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("NAME:")) name = trimmed.slice(5).trim();
    if (trimmed.startsWith("MSG:")) message = trimmed.slice(4).trim();
  }
  if (!name) return null;
  // Sanitise name: must look like vX.Y.Z or similar
  name = name.replace(/[^a-zA-Z0-9._/-]/g, "").slice(0, 30);
  // Strip leading/trailing quotes from message
  message = message.replace(/^["']|["']$/g, "").slice(0, 100);
  return { name, message };
}

// ─── Composable ──────────────────────────────────────────

export function useTagSuggestion() {
  const ai = useAIProvider();

  async function suggest(cwd: string): Promise<TagSuggestion> {
    isGenerating.value = true;
    lastError.value = null;

    try {
      if (!ai.isAvailable.value) {
        throw new Error(t("errors.noAiProvider"));
      }

      // 1. Find the most recent tag
      let lastTag = "(none)";
      try {
        const tags = await gitListTags(cwd);
        if (tags.length > 0) lastTag = tags[0].name;
      } catch {
        // No tags yet — that's fine
      }

      // 2. Get commits since last tag (max 60 for context)
      let commits = "";
      try {
        const range = lastTag !== "(none)" ? `${lastTag}..HEAD` : "HEAD";
        const logArgs = ["log", range, "--oneline", "--no-decorate", "--max-count=60"];
        const res = await gitExec(cwd, logArgs);
        commits = (res.stdout ?? "").trim();
      } catch {
        // If the range fails (e.g. no commits yet), leave empty
      }

      // 3. Ask AI
      const raw = await ai.rawPrompt(
        buildSystemPrompt(),
        buildUserPrompt(lastTag, commits),
      );
      if (!raw) throw new Error(t("errors.emptyAiResponse"));

      const parsed = parseResponse(raw);
      if (!parsed || !parsed.name) {
        throw new Error(t("errors.aiResponseInvalidJson"));
      }

      return parsed;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError.value = msg;
      throw err;
    } finally {
      isGenerating.value = false;
    }
  }

  return {
    isGenerating,
    lastError,
    suggest,
  };
}
