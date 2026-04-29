/**
 * @gitwand/core v2.4 — Strict validation adapter (Node.js only)
 *
 * Exécute les outils de validation externes (tsc, eslint) sur le contenu
 * fusionné en écrivant un fichier temporaire. Ce module utilise des APIs
 * Node.js natives (node:fs/promises, node:os, node:child_process) et ne
 * doit JAMAIS être importé statiquement depuis du code partagé browser/Tauri.
 *
 * Pattern d'utilisation (depuis validate-strict.ts) :
 *   const { runStrictValidationNode } = await import(
 *     /* @vite-ignore *\/ "./adapters/strict-node.js"
 *   );
 */

import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface StrictValidationResult {
  /** Erreurs détectées (vide = tout est OK) */
  errors: string[];
  /** Outils qui ont pu être exécutés */
  toolsRun: string[];
  /** Outils qui ont échoué à s'exécuter (non installés, timeout…) */
  toolsFailed: string[];
}

/**
 * Valide le contenu avec tsc et/ou eslint.
 * Écrit le contenu dans un fichier temporaire, exécute les outils, puis supprime le fichier.
 *
 * @param content  - Contenu fusionné à valider
 * @param filePath - Chemin original (pour l'extension et l'identification)
 * @param tools    - Outils à exécuter
 * @returns Résultat de validation strict
 */
export async function runStrictValidationNode(
  content: string,
  filePath: string,
  tools: Array<"tsc" | "eslint">,
): Promise<StrictValidationResult> {
  const errors: string[] = [];
  const toolsRun: string[] = [];
  const toolsFailed: string[] = [];

  // Extraire l'extension pour le fichier temporaire
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : ".ts";

  // Créer un répertoire temporaire et y écrire le contenu
  let tmpDir: string | null = null;
  let tmpFile: string | null = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "gitwand-validate-"));
    tmpFile = join(tmpDir, `merged${ext}`);
    await writeFile(tmpFile, content, "utf8");
  } catch {
    return { errors: [], toolsRun: [], toolsFailed: ["setup"] };
  }

  try {
    // ─── tsc ──────────────────────────────────────────────────────
    if (tools.includes("tsc")) {
      try {
        await execFileAsync("tsc", [
          "--noEmit",
          "--noResolve",        // pas besoin de résoudre les imports pour la syntaxe
          "--noLib",            // pas de lib.d.ts requis pour un check syntaxique rapide
          "--allowJs",          // traiter aussi les .js/.jsx
          "--checkJs",
          "--strict", "false",  // on ne vérifie que la syntaxe, pas les types stricts
          "--target", "esnext",
          "--moduleResolution", "bundler",
          tmpFile,
        ], { timeout: 10_000 });
        toolsRun.push("tsc");
        // Si tsc sort sans erreur, aucune erreur syntaxique
      } catch (err: unknown) {
        // tsc exit code != 0 → des erreurs
        toolsRun.push("tsc");
        const output = (err as { stdout?: string; stderr?: string }).stdout ?? "";
        const stderr = (err as { stderr?: string }).stderr ?? "";
        const combined = [output, stderr].filter(Boolean).join("\n");
        // Nettoyer le chemin temporaire pour ne pas exposer les internals
        const cleaned = combined.replace(new RegExp(tmpFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), filePath);
        if (cleaned.trim()) {
          errors.push(...cleaned.split("\n").filter((l) => l.trim()));
        }
      }
    }

    // ─── eslint ───────────────────────────────────────────────────
    if (tools.includes("eslint")) {
      try {
        await execFileAsync("eslint", [
          "--no-eslintrc",            // ignorer la config du projet
          "--rule", '{"no-undef": 0}', // désactiver les règles de type (syntaxe only)
          "--parser-options", "ecmaVersion:latest",
          "--format", "compact",
          tmpFile,
        ], { timeout: 10_000 });
        toolsRun.push("eslint");
      } catch (err: unknown) {
        toolsRun.push("eslint");
        const output = (err as { stdout?: string }).stdout ?? "";
        const cleaned = output.replace(new RegExp(tmpFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), filePath);
        if (cleaned.trim()) {
          errors.push(...cleaned.split("\n").filter((l) => l.trim()));
        }
      }
    }
  } finally {
    // Nettoyage du fichier temporaire
    if (tmpFile) {
      try { await unlink(tmpFile); } catch { /* ignore */ }
    }
    if (tmpDir) {
      try {
        const { rmdir } = await import("node:fs/promises");
        await rmdir(tmpDir);
      } catch { /* ignore */ }
    }
  }

  return { errors, toolsRun, toolsFailed };
}
