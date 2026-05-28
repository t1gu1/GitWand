/**
 * Parity tests — `git_submodule_branches` (Rust) vs
 * `/api/git-submodule-branches` (Node dev-server). v2.15.1.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { startDevServer } from "./dev-server-runner.mjs";
import { assertParity } from "./harness.mjs";
import { fixtureSubmodule } from "./fixtures.mjs";

describe("parity: git-submodule-branches", () => {
  /** @type {Awaited<ReturnType<typeof startDevServer>>} */
  let dev;

  beforeAll(async () => {
    dev = await startDevServer();
  }, 15_000);

  afterAll(async () => {
    await dev?.stop();
  });

  it("fixtureSubmodule → branches du sous-dépôt libs/inner", async () => {
    const { cwd, subPath } = fixtureSubmodule();
    await assertParity(dev, {
      command: "git-submodule-branches",
      args: { cwd, path: subPath },
      httpPath: `/api/git-submodule-branches?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(subPath)}`,
    });
  });
});
