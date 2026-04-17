/**
 * Post-merge validation (Phase 7.2).
 *
 * Vérifie que le contenu fusionné ne laisse pas de marqueurs de conflit
 * résiduels et, pour les fichiers JSON/JSONC, qu'il reste syntaxiquement
 * valide. Extrait de `resolver.ts` lors du split P1.1.
 */

import type { ValidationResult } from "../types.js";

/** Patterns de marqueurs de conflit résiduels. */
export const RESIDUAL_MARKER_PATTERNS = [
  /^<{7}\s/,  // <<<<<<< ours
  /^>{7}\s/,  // >>>>>>> theirs
  /^\|{7}\s/, // ||||||| base
  /^={7}$/,   // =======
];

/**
 * Valide le contenu fusionné pour détecter les problèmes résiduels.
 *
 * Vérifie :
 * 1. Marqueurs de conflit résiduels (indique une résolution incomplète)
 * 2. Erreurs de syntaxe JSON pour les fichiers .json / .jsonc
 *
 * @param content - Contenu fusionné à valider
 * @param filePath - Chemin du fichier (pour détecter le type)
 */
export function validateMergedContent(content: string, filePath: string): ValidationResult {
  // 1. Détection de marqueurs résiduels
  const lines = content.split("\n");
  const residualMarkerLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RESIDUAL_MARKER_PATTERNS.some((p) => p.test(line))) {
      residualMarkerLines.push(i + 1); // 1-indexed
    }
  }

  const hasResidualMarkers = residualMarkerLines.length > 0;

  // 2. Validation syntaxique JSON
  let syntaxError: string | null = null;
  if (/\.json(c)?$/i.test(filePath)) {
    try {
      JSON.parse(content);
    } catch (err) {
      syntaxError = err instanceof Error ? err.message : String(err);
    }
  }

  const isValid = !hasResidualMarkers && syntaxError === null;

  return { hasResidualMarkers, residualMarkerLines, syntaxError, isValid };
}

/** Validation vide (pour les cas où le contenu n'est pas encore fusionné). */
export const EMPTY_VALIDATION: ValidationResult = {
  hasResidualMarkers: false,
  residualMarkerLines: [],
  syntaxError: null,
  isValid: true,
};
