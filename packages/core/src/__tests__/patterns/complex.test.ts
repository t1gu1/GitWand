/**
 * Tests du pattern complex (priority 999)
 *
 * Fallback universel — toujours détecté quand aucun autre pattern ne s'applique.
 * Jamais auto-résolu : stats.autoResolved === 0.
 * Ne pas utiliser toBe sur mergedContent pour complex (ne résout pas).
 */

import { describe, it, expect } from "vitest";
import { resolve } from "../../resolver.js";

// ─── Cas qui doivent matcher complex ─────────────────────────

describe("complex : modifications conflictuelles sur la même zone (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  level: "warn",`,
    `  format: "json",`,
    `||||||| base`,
    `  level: "info",`,
    `  format: "text",`,
    `=======`,
    `  level: "error",`,
    `  format: "logfmt",`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en complex", () => {
    const result = resolve(input, "src/logger.ts");
    expect(result.hunks[0].type).toBe("complex");
  });

  it("n'est pas auto-résolu (autoResolved === 0)", () => {
    const result = resolve(input, "src/logger.ts");
    expect(result.stats.autoResolved).toBe(0);
  });
});

describe("complex : restructuration incompatible (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `export default class UserService {`,
    `  constructor(private db: Database) {}`,
    `  async getUser(id: string) {`,
    `    return this.db.find(id);`,
    `  }`,
    `}`,
    `=======`,
    `export const userService = {`,
    `  getUser: async (id: string, db: Database) => db.find(id),`,
    `};`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en complex", () => {
    const result = resolve(input, "src/user-service.ts");
    expect(result.hunks[0].type).toBe("complex");
  });

  it("n'est pas auto-résolu", () => {
    const result = resolve(input, "src/user-service.ts");
    expect(result.stats.autoResolved).toBe(0);
  });
});

describe("complex : logique métier conflictuelle (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `  if (user.role === "admin") {`,
    `    return true;`,
    `  }`,
    `  return user.permissions.includes("write");`,
    `||||||| base`,
    `  return user.isAdmin;`,
    `=======`,
    `  const allowed = ["admin", "editor", "moderator"];`,
    `  return allowed.includes(user.role);`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en complex", () => {
    const result = resolve(input, "src/auth.ts");
    expect(result.hunks[0].type).toBe("complex");
  });

  it("n'est pas auto-résolu", () => {
    const result = resolve(input, "src/auth.ts");
    expect(result.stats.autoResolved).toBe(0);
  });
});

describe("complex : renommages incompatibles (diff2)", () => {
  const input = [
    `<<<<<<< ours`,
    `  const fetchUserData = async (userId: string) => {`,
    `    const response = await apiClient.get(\`/users/\${userId}\`);`,
    `    return response.data;`,
    `  };`,
    `=======`,
    `  const loadProfile = async (profileId: string) => {`,
    `    const res = await http.request("GET", \`/profiles/\${profileId}\`);`,
    `    return res.json();`,
    `  };`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en complex", () => {
    const result = resolve(input, "src/api.ts");
    expect(result.hunks[0].type).toBe("complex");
  });

  it("n'est pas auto-résolu", () => {
    const result = resolve(input, "src/api.ts");
    expect(result.stats.autoResolved).toBe(0);
  });
});

describe("complex : changements structurels incompatibles sur le même bloc (diff3)", () => {
  const input = [
    `<<<<<<< ours`,
    `type Status = "active" | "inactive" | "pending" | "banned";`,
    `||||||| base`,
    `type Status = "active" | "inactive";`,
    `=======`,
    `enum Status {`,
    `  Active = "active",`,
    `  Inactive = "inactive",`,
    `  Archived = "archived",`,
    `}`,
    `>>>>>>> theirs`,
  ].join("\n");

  it("classifie en complex", () => {
    const result = resolve(input, "src/types.ts");
    expect(result.hunks[0].type).toBe("complex");
  });

  it("n'est pas auto-résolu", () => {
    const result = resolve(input, "src/types.ts");
    expect(result.stats.autoResolved).toBe(0);
  });
});

// ─── Vérification que complex n'absorbe pas les patterns auto-résolubles ────

describe("complex : ne capture pas les patterns auto-résolubles", () => {
  it("same_change (prio 10) ne tombe pas en complex", () => {
    const input = [
      `<<<<<<< ours`,
      `const x = 1;`,
      `=======`,
      `const x = 1;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("complex");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("delete_no_change (prio 20) ne tombe pas en complex", () => {
    const input = [
      `<<<<<<< ours`,
      `=======`,
      `  someOldLine: true,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    // delete_no_change détecté en diff2 avec confiance "medium" (48) — non auto-résolu
    // par défaut (seuil "high"), mais le type est bien delete_no_change, PAS complex.
    expect(result.hunks[0].type).not.toBe("complex");
    expect(result.hunks[0].type).toBe("delete_no_change");
  });

  it("one_side_change (prio 30) ne tombe pas en complex", () => {
    const input = [
      `<<<<<<< ours`,
      `  timeout: 3000,`,
      `||||||| base`,
      `  timeout: 3000,`,
      `=======`,
      `  timeout: 9000,`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("complex");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("whitespace_only (prio 50) ne tombe pas en complex", () => {
    const input = [
      `<<<<<<< ours`,
      `    const y = 2;`,
      `=======`,
      `  const y = 2;`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).not.toBe("complex");
    expect(result.stats.autoResolved).toBe(1);
  });

  it("complex a un score sous le seuil high (non auto-résolu)", () => {
    const input = [
      `<<<<<<< ours`,
      `  foo: "completely",`,
      `  bar: "different",`,
      `||||||| base`,
      `  foo: "original",`,
      `=======`,
      `  baz: "also",`,
      `  qux: "different",`,
      `>>>>>>> theirs`,
    ].join("\n");
    const result = resolve(input, "src/test.ts");
    expect(result.hunks[0].type).toBe("complex");
    // makeScore(100, 100, 0) → 100 − 100×0.40 = 60 — sous le seuil "high" (68)
    expect(result.hunks[0].confidence.score).toBeLessThan(68);
    expect(result.stats.autoResolved).toBe(0);
  });
});
