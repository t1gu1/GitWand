/**
 * Post-merge validation (Phase 7.2).
 *
 * Vérifie que le contenu fusionné ne laisse pas de marqueurs de conflit
 * résiduels et, pour les formats structurés (JSON/JSONC, YAML, TOML),
 * qu'il reste syntaxiquement valide. Extrait de `resolver.ts` lors du
 * split P1.1, puis étendu YAML/TOML en P2.5.
 */

import * as YAML from "yaml";
import { parse as parseToml } from "smol-toml";
import type { ValidationResult } from "../types.js";

/** Patterns de marqueurs de conflit résiduels. */
export const RESIDUAL_MARKER_PATTERNS = [
  /^<{7}\s/,  // <<<<<<< ours
  /^>{7}\s/,  // >>>>>>> theirs
  /^\|{7}\s/, // ||||||| base
  /^={7}$/,   // =======
];

/**
 * Format structuré reconnu pour la validation syntaxique post-merge.
 * `null` = format non reconnu → pas de validation syntaxique.
 */
type StructuredFormat = "json" | "yaml" | "toml" | null;

/** Détecte le format structuré à partir de l'extension du fichier. */
function detectFormat(filePath: string): StructuredFormat {
  if (/\.json(c)?$/i.test(filePath)) return "json";
  if (/\.ya?ml$/i.test(filePath)) return "yaml";
  if (/\.toml$/i.test(filePath)) return "toml";
  return null;
}

/**
 * Parse le contenu selon le format détecté. Retourne `null` si OK,
 * sinon un message d'erreur préfixé par le format (ex: "YAML: ...").
 *
 * Le préfixe permet de savoir quel parser a échoué sans avoir à
 * enrichir le type `ValidationResult` — `syntaxError: string | null`
 * reste le contrat public.
 */
function tryParse(content: string, format: StructuredFormat): string | null {
  if (format === null) return null;
  try {
    switch (format) {
      case "json":
        JSON.parse(content);
        return null;
      case "yaml":
        // `yaml.parse` échoue dur sur les erreurs de syntaxe (vs `parseDocument`
        // qui les accumule). On veut un fail-fast équivalent à JSON.parse.
        YAML.parse(content);
        return null;
      case "toml":
        parseToml(content);
        return null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${format.toUpperCase()}: ${msg}`;
  }
}

/**
 * Valide le contenu fusionné pour détecter les problèmes résiduels.
 *
 * Vérifie :
 * 1. Marqueurs de conflit résiduels (indique une résolution incomplète)
 * 2. Erreurs de syntaxe pour les formats structurés :
 *    - JSON/JSONC (`.json`, `.jsonc`)
 *    - YAML       (`.yaml`, `.yml`)
 *    - TOML       (`.toml`)
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

  // 2. Validation syntaxique pour formats structurés
  const format = detectFormat(filePath);
  const syntaxError = tryParse(content, format);

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
