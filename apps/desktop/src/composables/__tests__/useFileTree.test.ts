import { describe, it, expect } from "vitest";
import { buildFileTree, flattenTree } from "../useFileTree";
import type { RepoFileEntry } from "../useGitRepo";

function file(path: string): RepoFileEntry {
  return { path, status: "modified", section: "unstaged" };
}

const never = () => false;

describe("buildFileTree / flattenTree", () => {
  it("nests files under their folders and rolls up counts", () => {
    const root = buildFileTree([
      file("src/a.ts"),
      file("src/components/B.vue"),
      file("README.md"),
    ]);

    const rows = flattenTree(root, never);
    // Folders before files; folders sorted by name.
    expect(rows.map((r) => `${r.kind}:${r.name}:${r.depth}`)).toEqual([
      "folder:src:0",
      "folder:components:1",
      "file:B.vue:2",
      "file:a.ts:1",
      "file:README.md:0",
    ]);

    const srcFolder = rows.find((r) => r.kind === "folder" && r.path === "src");
    expect(srcFolder?.count).toBe(2);
  });

  it("hides descendants of a collapsed folder", () => {
    const root = buildFileTree([file("src/a.ts"), file("src/b.ts")]);
    const rows = flattenTree(root, (p) => p === "src");
    expect(rows.map((r) => r.name)).toEqual(["src"]);
  });

  it("treats trailing-slash entries (untracked dirs) as a single leaf", () => {
    const root = buildFileTree([file("dist/"), file("logs/nested/")]);
    const rows = flattenTree(root, never);
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "folder:logs",
      "file:nested/",
      "file:dist/",
    ]);
  });

  it("uses folder paths as unique cumulative keys", () => {
    const root = buildFileTree([file("a/b/c.ts")]);
    const rows = flattenTree(root, never);
    expect(rows.filter((r) => r.kind === "folder").map((r) => r.path)).toEqual([
      "a",
      "a/b",
    ]);
  });
});
