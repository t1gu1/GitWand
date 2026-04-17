/**
 * GitWand Conflict Resolver — orchestration.
 *
 * Moteur de résolution automatique des conflits. Pour chaque hunk :
 * 1. applique la pénalité « zone chaude » (v1.4) si nécessaire,
 * 2. reclassifie les hunks complex en `generated_file` si le chemin matche,
 * 3. tente un résolveur format-aware (JSON/MD/YAML/Vue/CSS/imports…),
 * 4. à défaut, applique la politique de merge et le seuil de confiance,
 * 5. invoque le moteur textuel (`assembleResolution`),
 * 6. valide le contenu fusionné en sortie (marqueurs résiduels, JSON).
 *
 * Issu du split P1.1 de `resolver.ts`. Le fichier `packages/core/src/resolver.ts`
 * reste en place comme shim de re-export pour les consommateurs qui importent
 * `resolve` depuis `../resolver.js`.
 */

import type {
  ConflictHunk,
  ConflictType,
  GitWandOptions,
  HunkResolution,
  MergeResult,
  MergeStats,
  ValidationResult,
} from "../types.js";
import { parseConflictMarkers, toConflictHunk } from "../parser.js";

import { EMPTY_VALIDATION, validateMergedContent } from "./validation.js";
import { isGeneratedFile, reclassifyIfGenerated } from "./generated-detection.js";
import {
  CONFIDENCE_ORDER,
  DEFAULT_OPTIONS,
  applyFileFrequencyPenalty,
  computeEffectiveMinConfidence,
  computeEffectivePolicy,
} from "./policy.js";
import { dispatchFormatAware } from "./format-dispatch.js";
import { assembleResolution } from "./assemble.js";

/**
 * Résout automatiquement un hunk de conflit.
 *
 * @param hunk - Le hunk à résoudre
 * @param filePath - Chemin du fichier (pour le dispatch format-aware et la politique)
 * @param options - Options de configuration (complètes, déjà fusionnées avec les défauts)
 * @returns Les lignes résolues + la raison, ou `null` + raison de refus
 */
function resolveHunk(
  hunk: ConflictHunk,
  filePath: string,
  options: Required<GitWandOptions>,
): { lines: string[] | null; reason: string } {
  // explainOnly : ne pas appliquer de résolution, juste tracer
  if (options.explainOnly) {
    return {
      lines: null,
      reason: `Mode explain-only : résolution non appliquée (type: ${hunk.type}, confiance: ${hunk.confidence.label} [score: ${hunk.confidence.score}]).`,
    };
  }

  // Phase 7.3 — Dispatch format-aware (bypasse le seuil de confiance textuel
  // car les résolveurs spécialisés font une validation sémantique).
  const dispatch = dispatchFormatAware(hunk, filePath, options);
  if (dispatch.status === "resolved") {
    return { lines: dispatch.lines, reason: dispatch.reason };
  }
  if (dispatch.status === "rejected-policy") {
    return { lines: null, reason: dispatch.reason };
  }
  // dispatch.status === "not-applicable" → on continue vers le moteur textuel.
  // `dispatch.note` porte la raison d'échec du résolveur spécialisé (pour
  // annotation du refus final si le seuil de confiance bloque aussi).

  // Phase 7.4 — Politique de merge effective pour ce fichier
  const { policy: effectivePolicy, cfg: policyCfg } = computeEffectivePolicy(filePath, options);
  const effectiveMinConfidence = computeEffectiveMinConfidence(policyCfg, options);

  // Vérifier le niveau de confiance minimum
  if (CONFIDENCE_ORDER[hunk.confidence.label] < CONFIDENCE_ORDER[effectiveMinConfidence]) {
    return {
      lines: null,
      reason: `Confiance ${hunk.confidence.label} (score: ${hunk.confidence.score}) insuffisante (minimum requis : ${effectiveMinConfidence}, politique : ${effectivePolicy}).${dispatch.note ? ` [${dispatch.note}]` : ""}`,
    };
  }

  return assembleResolution(hunk, options, effectivePolicy, policyCfg);
}

/**
 * Analyse et résout automatiquement les conflits d'un fichier.
 *
 * @param conflictedContent - Le contenu du fichier avec marqueurs de conflit Git
 * @param filePath - Le chemin du fichier (pour le reporting)
 * @param userOptions - Options de configuration
 * @returns Le résultat de la résolution avec traces et validation
 */
export function resolve(
  conflictedContent: string,
  filePath: string,
  userOptions: GitWandOptions = {},
): MergeResult {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };

  const { segments } = parseConflictMarkers(conflictedContent);

  const hunks: ConflictHunk[] = [];
  const resolutions: HunkResolution[] = [];
  const outputLines: string[] = [];
  let allResolved = true;

  // Détecter si le fichier est auto-généré
  const genInfo = isGeneratedFile(filePath);

  // v1.4 — fileFrequency : compteur de hunks "complex" déjà vus dans ce fichier.
  // Appliqué comme pénalité sur la dimension fileFrequency du score de confiance.
  let priorComplexHunks = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      outputLines.push(...segment.lines);
      continue;
    }

    let hunk = toConflictHunk(segment.conflict);

    // v1.4 — Appliquer la pénalité fileFrequency si des hunks complexes ont déjà été vus
    hunk = applyFileFrequencyPenalty(hunk, priorComplexHunks);

    // Si fichier auto-généré et hunk classifié "complex", reclassifier en "generated_file"
    hunk = reclassifyIfGenerated(hunk, genInfo);

    hunks.push(hunk);

    const { lines: resolvedLines, reason: resolutionReason } = resolveHunk(hunk, filePath, options);
    const autoResolved = resolvedLines !== null;

    // v1.4 — Incrémenter le compteur de hunks complexes non résolus pour fileFrequency
    if (!autoResolved && hunk.type === "complex") {
      priorComplexHunks++;
    }

    resolutions.push({ hunk, resolvedLines, autoResolved, resolutionReason });

    if (autoResolved) {
      outputLines.push(...resolvedLines);
      if (options.verbose) {
        console.log(
          `  [GitWand] Auto-resolved (${hunk.type}): L${hunk.startLine} — ${hunk.explanation}`,
        );
        console.log(`    Trace: ${hunk.trace.summary}`);
      }
    } else {
      // Remettre les marqueurs de conflit pour les conflits non résolus
      outputLines.push(`<<<<<<< ours`);
      outputLines.push(...hunk.oursLines);
      if (hunk.baseLines.length > 0) {
        outputLines.push(`||||||| base`);
        outputLines.push(...hunk.baseLines);
      }
      outputLines.push(`=======`);
      outputLines.push(...hunk.theirsLines);
      outputLines.push(`>>>>>>> theirs`);
      allResolved = false;
    }
  }

  // Calculer les stats
  const byType = {} as Record<ConflictType, number>;
  for (const hunk of hunks) {
    byType[hunk.type] = (byType[hunk.type] || 0) + 1;
  }

  const autoResolvedCount = resolutions.filter((r) => r.autoResolved).length;

  const stats: MergeStats = {
    totalConflicts: hunks.length,
    autoResolved: autoResolvedCount,
    remaining: hunks.length - autoResolvedCount,
    byType,
  };

  const mergedContent = allResolved ? outputLines.join("\n") : null;

  // Phase 7.2 — Validation post-merge
  const validation: ValidationResult = mergedContent !== null
    ? validateMergedContent(mergedContent, filePath)
    : EMPTY_VALIDATION;

  return {
    filePath,
    mergedContent,
    hunks,
    resolutions,
    stats,
    validation,
  };
}
