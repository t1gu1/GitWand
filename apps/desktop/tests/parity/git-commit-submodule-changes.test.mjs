/**
 * Parity tests — `git_commit_submodule_changes` (Rust) vs
 * `/api/git-commit-submodule-changes` (Node dev-server). v2.15.1.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { startDevServer } from "./dev-server-runner.mjs";
import { assertParity } from "./harness.mjs";
import { fixtureSubmodule } from "./fixtures.mjs";

describe("parity: git-commit-submodule-changes", () => {
  /** @type {Awaited<ReturnType<typeof startDevServer>>} */
  let dev;

  beforeAll(async () => {
    dev = await startDevServer();
  }, 15_000);

  afterAll(async () => {
    await dev?.stop();
  });

  it("fixtureSubmodule → le commit parent pose un gitlink sur libs/inner", async () => {
    const { cwd } = fixtureSubmodule();
    await assertParity(dev, {
      command: "git-commit-submodule-changes",
      args: { cwd },
      httpPath: `/api/git-commit-submodule-changes?cwd=${encodeURIComponent(cwd)}`,
    });
  });
});
