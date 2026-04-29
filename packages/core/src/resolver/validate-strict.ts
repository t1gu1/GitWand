/**
 * @gitwand/core v2.4 — Strict validation dispatcher
 *
 * Point d'entrée pour la validation opt-in via outils externes (tsc, eslint).
 * Le chargement de l'implémentation Node.js est gardé derrière un import
 * dynamique avec `/* @vite-ignore *\/` pour éviter son inclusion dans les
 * bundles browser/Tauri où child_process n'est pas disponible.
 *
 * Retourne toujours `[]` (aucune erreur) en environnement browser ou Tauri.
 */

import { detectEnvironment } from "../structural/parsers/loader.js";

export interface StrictValidationResult {
  errors: string[];
  toolsRun: string[];
  toolsFailed: string[];
}

const EMPTY_RESULT: StrictValidationResult = { errors: [], toolsRun: [], toolsFailed: [] };

/**
 * Exécute la validation stricte sur le contenu fusionné.
 *
 * Disponible uniquement en environnement Node.js — retourne un résultat vide
 * en browser ou Tauri sans lever d'exception.
 *
 * @param content  - Contenu fusionné à valider
 * @param filePath - Chemin du fichier (pour l'extension et les messages d'erreur)
 * @param tools    - Outils à exécuter (`["tsc"]` par défaut)
 */
export async function runStrictValidation(
  content: string,
  filePath: string,
  tools: Array<"tsc" | "eslint"> = ["tsc"],
): Promise<StrictValidationResult> {
  const env = detectEnvironment();
  if (env !== "node") return EMPTY_RESULT;

  // Seulement les langages que tsc et eslint comprennent
  const strictLangs = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
  if (!strictLangs.test(filePath)) return EMPTY_RESULT;

  try {
    // vite-ignore: Node.js adapter — jamais bundlé pour browser/Tauri
    const { runStrictValidationNode } = await import(/* @vite-ignore */ "./adapters/strict-node.js");
    return await runStrictValidationNode(content, filePath, tools);
  } catch {
    // L'adapter n'a pas pu être chargé — dégradation gracieuse
    return EMPTY_RESULT;
  }
}
