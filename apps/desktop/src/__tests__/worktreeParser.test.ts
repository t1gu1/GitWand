/**
 * Worktree parser — jeu de tests complet
 *
 * Couvre les fonctions pures de `utils/worktreeParser.ts` qui reflètent
 * la logique Rust de `src-tauri/src/commands/ops.rs`.
 *
 * Fixtures basées sur un dépôt fictif (/home/user/projects/myrepo).
 * Aucune dépendance réseau, aucun Tauri : tests purement unitaires (vitest).
 *
 * Scénarios couverts :
 *  1. Worktree principal seul (git ≥ 2.36, attribut `main`)
 *  2. Worktree principal + 1 worktree additionnel
 *  3. Attribut `locked` sans raison
 *  4. Attribut `locked` avec raison inline
 *  5. Attribut `prunable` sans raison
 *  6. Attribut `prunable` avec raison inline
 *  7. HEAD détaché (detached HEAD)
 *  8. Bare worktree
 *  9. Fallback git < 2.36 (pas d'attribut `main` → premier = main)
 * 10. Sortie vide → tableau vide
 * 11. Plusieurs worktrees, ordre préservé
 * 12. Branche refs/heads/ strippée correctement
 * 13. Status : zéro ligne → 0/0
 * 14. Status : uniquement modifiés
 * 15. Status : uniquement conflits (UU, AA, DD, AU, UA, DU, UD)
 * 16. Status : mélange conflits + modifiés
 * 17. Status : ligne vide ignorée
 * 18. deriveQuickWorktreePath : nom simple
 * 19. deriveQuickWorktreePath : nom avec slash (fix/login)
 * 20. deriveQuickWorktreePath : nom avec caractères spéciaux sanitisés
 * 21. hasPrunableWorktrees : aucun prunable
 * 22. hasPrunableWorktrees : un prunable
 */

import { describe, expect, it } from "vitest";
import {
  parseWorktreePorcelain,
  parseWorktreeStatus,
  deriveQuickWorktreePath,
  hasPrunableWorktrees,
  CONFLICT_CODES,
} from "../utils/worktreeParser";

// ─── Chemins de référence (repo fictif pour les tests) ───────────────────────

const TURBULLES = "/home/user/projects/myrepo";
const TURBULLES_FIX = "/home/user/projects/myrepo-fix-login";
const TURBULLES_FEAT = "/home/user/projects/myrepo-feat-dashboard";
const TURBULLES_HEAD = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Indente un porcelain brut comme git le fait (ligne vide entre stanzas). */
function porcelain(...stanzas: string[]): string {
  return stanzas.join("\n\n") + "\n";
}

function mainStanza(path = TURBULLES, head = TURBULLES_HEAD, branch = "master"): string {
  return `worktree ${path}\nHEAD ${head}\nbranch refs/heads/${branch}\nmain`;
}

function wtStanza(path: string, branch: string, head = "aabbcc0011223344556677889900aabbcc001122"): string {
  return `worktree ${path}\nHEAD ${head}\nbranch refs/heads/${branch}`;
}

// ─── 1. parseWorktreePorcelain ────────────────────────────────────────────────

describe("parseWorktreePorcelain", () => {

  // ── Cas 1 : Worktree principal seul (git ≥ 2.36) ────────────────────────

  it("cas 1 — worktree principal seul (attribut main présent)", () => {
    const raw = porcelain(mainStanza());
    const result = parseWorktreePorcelain(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: TURBULLES,
      branch: "master",
      head: TURBULLES_HEAD,
      is_main: true,
      is_locked: false,
      lock_reason: null,
      is_bare: false,
      is_prunable: false,
      prunable_reason: null,
    });
  });

  // ── Cas 2 : Principal + 1 worktree additionnel ───────────────────────────

  it("cas 2 — principal + un worktree additionnel", () => {
    const raw = porcelain(
      mainStanza(),
      wtStanza(TURBULLES_FIX, "fix/login-bug"),
    );
    const result = parseWorktreePorcelain(raw);

    expect(result).toHaveLength(2);

    expect(result[0].is_main).toBe(true);
    expect(result[0].path).toBe(TURBULLES);
    expect(result[0].branch).toBe("master");

    expect(result[1].is_main).toBe(false);
    expect(result[1].path).toBe(TURBULLES_FIX);
    expect(result[1].branch).toBe("fix/login-bug");
  });

  // ── Cas 3 : locked sans raison ───────────────────────────────────────────

  it("cas 3 — attribut locked sans raison", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/fix/auth\nlocked`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].is_locked).toBe(true);
    expect(result[1].lock_reason).toBeNull();
  });

  // ── Cas 4 : locked avec raison inline ───────────────────────────────────

  it("cas 4 — attribut locked avec raison inline", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/fix/auth\nlocked added manually by CI pipeline`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].is_locked).toBe(true);
    expect(result[1].lock_reason).toBe("added manually by CI pipeline");
  });

  // ── Cas 5 : prunable sans raison ────────────────────────────────────────

  it("cas 5 — attribut prunable sans raison", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/fix/auth\nprunable`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].is_prunable).toBe(true);
    expect(result[1].prunable_reason).toBeNull();
  });

  // ── Cas 6 : prunable avec raison inline ─────────────────────────────────

  it("cas 6 — attribut prunable avec raison inline", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/fix/auth\nprunable gitdir file points to non-existent location`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].is_prunable).toBe(true);
    expect(result[1].prunable_reason).toBe("gitdir file points to non-existent location");
  });

  // ── Cas 7 : detached HEAD ───────────────────────────────────────────────

  it("cas 7 — detached HEAD", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\ndetached`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].branch).toBe("(detached HEAD)");
  });

  // ── Cas 8 : bare worktree ────────────────────────────────────────────────

  it("cas 8 — bare worktree", () => {
    const raw = `worktree /srv/git/turbulles.git\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/master\nbare\n`;
    const result = parseWorktreePorcelain(raw);

    expect(result[0].is_bare).toBe(true);
  });

  // ── Cas 9 : fallback git < 2.36 (pas d'attribut `main`) ─────────────────

  it("cas 9 — fallback git < 2.36 : premier worktree marqué main", () => {
    // Pas de ligne "main" dans la sortie (git < 2.36)
    const raw = porcelain(
      `worktree ${TURBULLES}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/master`,
      wtStanza(TURBULLES_FIX, "fix/auth"),
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[0].is_main).toBe(true);
    expect(result[1].is_main).toBe(false);
  });

  // ── Cas 10 : sortie vide ─────────────────────────────────────────────────

  it("cas 10 — sortie vide → tableau vide", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("\n\n")).toEqual([]);
  });

  // ── Cas 11 : plusieurs worktrees, ordre préservé ─────────────────────────

  it("cas 11 — trois worktrees, ordre préservé", () => {
    const raw = porcelain(
      mainStanza(),
      wtStanza(TURBULLES_FIX, "fix/login-bug"),
      wtStanza(TURBULLES_FEAT, "feat/dashboard"),
    );
    const result = parseWorktreePorcelain(raw);

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.path)).toEqual([TURBULLES, TURBULLES_FIX, TURBULLES_FEAT]);
  });

  // ── Cas 12 : refs/heads/ strippé ─────────────────────────────────────────

  it("cas 12 — préfixe refs/heads/ strippé", () => {
    const raw = `worktree ${TURBULLES}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/feature/super-long-branch-name\nmain\n`;
    const result = parseWorktreePorcelain(raw);

    expect(result[0].branch).toBe("feature/super-long-branch-name");
  });

  // ── Cas bonus : locked + prunable simultanément ──────────────────────────

  it("bonus — locked et prunable simultanément", () => {
    const raw = porcelain(
      mainStanza(),
      `worktree ${TURBULLES_FIX}\nHEAD ${TURBULLES_HEAD}\nbranch refs/heads/fix/auth\nlocked CI lock\nprunable directory gone`,
    );
    const result = parseWorktreePorcelain(raw);

    expect(result[1].is_locked).toBe(true);
    expect(result[1].lock_reason).toBe("CI lock");
    expect(result[1].is_prunable).toBe(true);
    expect(result[1].prunable_reason).toBe("directory gone");
  });
});

// ─── 2. parseWorktreeStatus ───────────────────────────────────────────────────

describe("parseWorktreeStatus", () => {

  it("cas 13 — sortie vide → 0 conflits, 0 modifiés", () => {
    expect(parseWorktreeStatus("")).toEqual({ conflicted: 0, modified: 0 });
  });

  it("cas 14 — uniquement fichiers modifiés", () => {
    const raw = [
      " M src/components/WorktreeManager.vue",
      "M  apps/desktop/src/utils/backend.ts",
      "A  apps/desktop/src/utils/worktreeParser.ts",
    ].join("\n");
    expect(parseWorktreeStatus(raw)).toEqual({ conflicted: 0, modified: 3 });
  });

  it("cas 15 — uniquement conflits (tous les codes)", () => {
    const conflictLines = [...CONFLICT_CODES].map((code) => `${code} path/to/file-${code}.ts`).join("\n");
    const result = parseWorktreeStatus(conflictLines);
    expect(result.conflicted).toBe(CONFLICT_CODES.size); // 7 codes
    expect(result.modified).toBe(0);
  });

  it("cas 15b — code UU seul (le plus courant)", () => {
    const raw = "UU src/conflict.ts\nUU src/another.ts";
    expect(parseWorktreeStatus(raw)).toEqual({ conflicted: 2, modified: 0 });
  });

  it("cas 16 — mélange conflits + modifiés", () => {
    const raw = [
      "UU src/models/user.ts",      // conflit
      " M src/views/Login.vue",      // modifié
      "AA CHANGELOG.md",             // conflit
      "M  package.json",             // modifié
      "DU src/old-file.ts",          // conflit
    ].join("\n");
    expect(parseWorktreeStatus(raw)).toEqual({ conflicted: 3, modified: 2 });
  });

  it("cas 17 — lignes vides ignorées", () => {
    const raw = "\n M src/file.ts\n\nUU src/conflict.ts\n\n";
    expect(parseWorktreeStatus(raw)).toEqual({ conflicted: 1, modified: 1 });
  });
});

// ─── 3. deriveQuickWorktreePath ──────────────────────────────────────────────

describe("deriveQuickWorktreePath", () => {

  it("cas 18 — nom simple", () => {
    expect(deriveQuickWorktreePath(TURBULLES, "fix-auth")).toBe(
      `${TURBULLES}-fix-auth`,
    );
  });

  it("cas 19 — nom avec slash (fix/login)", () => {
    expect(deriveQuickWorktreePath(TURBULLES, "fix/login")).toBe(
      `${TURBULLES}-fix/login`,
    );
  });

  it("cas 20 — caractères spéciaux sanitisés", () => {
    const result = deriveQuickWorktreePath(TURBULLES, "Fix Auth Bug!!!");
    // Lettres majuscules conservées, espaces et ! → tirets fusionnés
    expect(result).toBe(`${TURBULLES}-Fix-Auth-Bug`);
  });

  it("cas 20b — tirets redondants fusionnés", () => {
    const result = deriveQuickWorktreePath(TURBULLES, "fix--double--dash");
    expect(result).toBe(`${TURBULLES}-fix-double-dash`);
  });

  it("tirets initiaux et finaux supprimés du slug", () => {
    const result = deriveQuickWorktreePath(TURBULLES, "-fix-auth-");
    expect(result).toBe(`${TURBULLES}-fix-auth`);
  });

  it("chemin principal avec trailing slash nettoyé", () => {
    expect(deriveQuickWorktreePath(`${TURBULLES}/`, "fix")).toBe(
      `${TURBULLES}-fix`,
    );
  });
});

// ─── 4. hasPrunableWorktrees ─────────────────────────────────────────────────

describe("hasPrunableWorktrees", () => {
  const makeEntry = (is_prunable: boolean) => ({
    path: TURBULLES,
    branch: "master",
    head: TURBULLES_HEAD,
    is_main: true,
    is_locked: false,
    lock_reason: null,
    is_bare: false,
    is_prunable,
    prunable_reason: null,
  });

  it("cas 21 — tableau vide → false", () => {
    expect(hasPrunableWorktrees([])).toBe(false);
  });

  it("cas 21b — tous propres → false", () => {
    expect(hasPrunableWorktrees([makeEntry(false), makeEntry(false)])).toBe(false);
  });

  it("cas 22 — un prunable → true", () => {
    expect(hasPrunableWorktrees([makeEntry(false), makeEntry(true)])).toBe(true);
  });

  it("cas 22b — le principal lui-même prunable → true", () => {
    expect(hasPrunableWorktrees([makeEntry(true)])).toBe(true);
  });
});

// ─── 5. CONFLICT_CODES — exhaustivité ─────────────────────────────────────────

describe("CONFLICT_CODES", () => {
  it("contient exactement les 7 codes de conflit git", () => {
    // Source : git documentation — git-status(1) XY format
    const expected = ["UU", "AA", "DD", "AU", "UA", "DU", "UD"];
    for (const code of expected) {
      expect(CONFLICT_CODES.has(code)).toBe(true);
    }
    expect(CONFLICT_CODES.size).toBe(expected.length);
  });

  it("ne contient pas de codes de modification simples", () => {
    const notConflicts = ["M ", " M", "MM", "A ", " A", "D ", " D", "R ", "C ", "??"];
    for (const code of notConflicts) {
      expect(CONFLICT_CODES.has(code)).toBe(false);
    }
  });
});
