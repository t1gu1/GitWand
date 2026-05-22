/**
 * Parity tests — `git_stash_list` (Rust) vs `/api/git-stash-list` (Node dev-server).
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { startDevServer } from "./dev-server-runner.mjs";
import { assertParity } from "./harness.mjs";
import { fixtureStash } from "./fixtures.mjs";

describe("parity: git-stash-list", () => {
  /** @type {Awaited<ReturnType<typeof startDevServer>>} */
  let dev;

  beforeAll(async () => {
    dev = await startDevServer();
  }, 15_000);

  afterAll(async () => {
    await dev?.stop();
  });

  it("fixtureStash → 2 stashes avec hash, index et message", async () => {
    const cwd = fixtureStash();
    await assertParity(dev, {
      command: "git-stash-list",
      args: { cwd },
      httpPath: `/api/git-stash-list?cwd=${encodeURIComponent(cwd)}`,
    });
  });
});
