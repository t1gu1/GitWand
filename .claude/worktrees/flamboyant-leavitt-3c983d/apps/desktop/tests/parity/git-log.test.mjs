/**
 * Parity tests — `git_log` (Rust) vs `/api/git-log` (Node dev-server).
 *
 * Portée :
 *  - fixture clean, count par défaut          → 3 entrées linéaires
 *  - fixture clean, count=2                   → troncation
 *  - fixture branches, all=false              → log de la branche courante
 *  - fixture branches, all=true               → inclut les commits d'autres refs
 *
 * Les hashes courts/longs sont déterministes car la fixture fige
 * GIT_AUTHOR_DATE + GIT_COMMITTER_DATE + identité auteur. Donc la parité
 * valide aussi les hashes (pas juste la structure).
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { startDevServer } from "./dev-server-runner.mjs";
import { assertParity } from "./harness.mjs";
import { fixtureClean, fixtureBranches } from "./fixtures.mjs";

describe("parity: git-log", () => {
  /** @type {Awaited<ReturnType<typeof startDevServer>>} */
  let dev;

  beforeAll(async () => {
    dev = await startDevServer();
  }, 15_000);

  afterAll(async () => {
    await dev?.stop();
  });

  it("fixtureClean, count défaut → 3 commits linéaires", async () => {
    const cwd = fixtureClean();
    const count = 50;
    await assertParity(dev, {
      command: "git-log",
      args: { cwd, count, all: false },
      httpPath: `/api/git-log?cwd=${encodeURIComponent(cwd)}&count=${count}`,
    });
  });

  it("fixtureClean, count=2 → respecte la limite", async () => {
    const cwd = fixtureClean();
    const count = 2;
    await assertParity(dev, {
      command: "git-log",
      args: { cwd, count, all: false },
      httpPath: `/api/git-log?cwd=${encodeURIComponent(cwd)}&count=${count}`,
    });
  });

  it("fixtureBranches, all=false → log courant uniquement", async () => {
    const cwd = fixtureBranches();
    const count = 50;
    await assertParity(dev, {
      command: "git-log",
      args: { cwd, count, all: false },
      httpPath: `/api/git-log?cwd=${encodeURIComponent(cwd)}&count=${count}`,
    });
  });

  it("fixtureBranches, all=true → inclut les branches feature/*", async () => {
    const cwd = fixtureBranches();
    const count = 50;
    await assertParity(dev, {
      command: "git-log",
      args: { cwd, count, all: true },
      httpPath: `/api/git-log?cwd=${encodeURIComponent(cwd)}&count=${count}&all=true`,
    });
  });
});
