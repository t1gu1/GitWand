/**
 * Parity tests — `git_branches` (Rust) vs `/api/git-branches` (Node dev-server).
 *
 * Portée :
 *  - fixture branches → main + feature/alpha + feature/beta (tous locaux)
 *
 * La normalisation efface `lastCommit` et `lastCommitDate` — ce sont des
 * champs sensibles au fuseau horaire local / au format ISO de git(1). Le
 * cœur de la parité ici, c'est la liste des branches, `isCurrent`,
 * `upstream`, `ahead`/`behind`, `isRemote` : tout ce qui sert effectivement
 * le frontend pour décider quoi afficher.
 *
 * Pas de fixture « clean » distincte ici : un repo sans branches secondaires
 * retourne juste `[{ name: "main", ... }]`, cas trop pauvre pour révéler des
 * divergences. `fixtureBranches` couvre aussi implicitement ce cas.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { startDevServer } from "./dev-server-runner.mjs";
import { assertParity } from "./harness.mjs";
import { fixtureBranches } from "./fixtures.mjs";

describe("parity: git-branches", () => {
  /** @type {Awaited<ReturnType<typeof startDevServer>>} */
  let dev;

  beforeAll(async () => {
    dev = await startDevServer();
  }, 15_000);

  afterAll(async () => {
    await dev?.stop();
  });

  it("fixtureBranches → main (courant) + feature/alpha + feature/beta", async () => {
    const cwd = fixtureBranches();
    await assertParity(dev, {
      command: "git-branches",
      args: { cwd },
      httpPath: `/api/git-branches?cwd=${encodeURIComponent(cwd)}`,
    });
  });
});
