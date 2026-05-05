/**
 * patchBuilder.ts — Builds a unified diff patch from selected lines/hunks.
 *
 * Used for partial staging (git add -p equivalent):
 * Given a GitDiff and a selection of lines, produce a valid patch
 * that can be applied with `git apply --cached`.
 */
import type { GitDiff, DiffHunk, DiffLine } from "./backend";

/**
 * Selection map: hunkIdx → Set of line indices within that hunk that are selected.
 * If a hunk is fully selected, all add/delete line indices should be in the set.
 */
export type LineSelection = Map<number, Set<number>>;

/**
 * Build a unified diff patch string from selected lines.
 *
 * Rules for building a partial hunk:
 * - Context lines are always included
 * - Selected `add` lines are included as `+` lines
 * - Unselected `add` lines are omitted entirely
 * - Selected `delete` lines are included as `-` lines
 * - Unselected `delete` lines become context lines (the line stays in the new file)
 */
export function buildPatch(
  diff: GitDiff,
  selection: LineSelection,
): string | null {
  const path = diff.path;
  const patchHunks: string[] = [];

  for (const [hunkIdx, selectedLines] of selection.entries()) {
    const hunk = diff.hunks[hunkIdx];
    if (!hunk || selectedLines.size === 0) continue;

    const result = buildPartialHunk(hunk, selectedLines);
    if (result) patchHunks.push(result);
  }

  if (patchHunks.length === 0) return null;

  // Build complete patch. The extended header (`new file mode` / `deleted
  // file mode`) and the `---`/`+++` anchors have to match the file-level
  // status — `git apply --cached` enforces this: applying a new-file patch
  // with `--- a/<path>` to an index that doesn't contain `<path>` fails with
  // "does not exist in index". Status is resolved from `diff.status` which
  // the `git show` parser derives from the same extended-header lines.
  const status = diff.status ?? "modified";
  const headerLines: string[] = [`diff --git a/${path} b/${path}`];

  if (status === "added") {
    headerLines.push("new file mode 100644");
    headerLines.push("--- /dev/null");
    headerLines.push(`+++ b/${path}`);
  } else if (status === "deleted") {
    headerLines.push("deleted file mode 100644");
    headerLines.push(`--- a/${path}`);
    headerLines.push("+++ /dev/null");
  } else if (status === "renamed" && diff.oldPath) {
    // Rare inside a split-commit flow but harmless to support. A rename with
    // in-place edits uses the old path as source anchor.
    headerLines.push(`rename from ${diff.oldPath}`);
    headerLines.push(`rename to ${path}`);
    headerLines.push(`--- a/${diff.oldPath}`);
    headerLines.push(`+++ b/${path}`);
  } else {
    headerLines.push(`--- a/${path}`);
    headerLines.push(`+++ b/${path}`);
  }

  return headerLines.join("\n") + "\n" + patchHunks.join("\n") + "\n";
}

/**
 * Build a single hunk from selected lines.
 * Returns null if the result would be empty (no changes).
 */
function buildPartialHunk(
  hunk: DiffHunk,
  selected: Set<number>,
): string | null {
  const outputLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  let hasChanges = false;

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    const isSelected = selected.has(i);

    if (line.type === "context") {
      outputLines.push(` ${line.content}`);
      oldCount++;
      newCount++;
    } else if (line.type === "delete") {
      if (isSelected) {
        outputLines.push(`-${line.content}`);
        oldCount++;
        hasChanges = true;
      } else {
        // Unselected delete → keep as context (line stays in new file)
        outputLines.push(` ${line.content}`);
        oldCount++;
        newCount++;
      }
    } else if (line.type === "add") {
      if (isSelected) {
        outputLines.push(`+${line.content}`);
        newCount++;
        hasChanges = true;
      }
      // Unselected add → omit entirely
    }
  }

  if (!hasChanges) return null;

  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
  return header + "\n" + outputLines.join("\n");
}

/**
 * Build a selection map for an entire hunk (all add/delete lines selected).
 */
export function selectWholeHunk(hunk: DiffHunk, hunkIdx: number): LineSelection {
  const sel: LineSelection = new Map();
  const lines = new Set<number>();
  for (let i = 0; i < hunk.lines.length; i++) {
    if (hunk.lines[i].type !== "context") {
      lines.add(i);
    }
  }
  sel.set(hunkIdx, lines);
  return sel;
}
