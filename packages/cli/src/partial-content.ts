/**
 * Reconstruction d'un fichier partiellement résolu.
 *
 * Lorsque tous les hunks d'un fichier sont résolus, `@gitwand/core`
 * retourne `mergedContent` directement. Mais si certains hunks restent
 * non résolus, `mergedContent` est `null` — on doit alors reconstruire
 * le fichier à la main : remplacer les blocs résolus par leurs lignes
 * finales, et laisser intacts les blocs non résolus (avec leurs
 * marqueurs `<<<<<<<`, `=======`, `>>>>>>>`).
 *
 * Cette fonction est volontairement simple (un scan linéaire du fichier)
 * et s'appuie sur l'ordre des `resolutions` : il doit correspondre à
 * l'ordre d'apparition des conflits dans le fichier — invariant garanti
 * par `@gitwand/core`.
 */

import type { MergeResult } from "@gitwand/core";

/**
 * Construit le contenu d'un fichier dans lequel seules les résolutions
 * réussies ont été appliquées. Les blocs non résolus sont laissés tels
 * quels (marqueurs de conflit inclus), pour que l'utilisateur puisse
 * terminer le merge manuellement.
 */
export function buildPartialContent(
  content: string,
  resolutions: MergeResult["resolutions"],
): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let conflictIdx = 0;
  let inConflict = false;
  let conflictBuffer: string[] = [];

  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      inConflict = true;
      conflictBuffer = [line];
    } else if (line.startsWith(">>>>>>>") && inConflict) {
      conflictBuffer.push(line);
      const resolution = resolutions[conflictIdx];
      if (resolution?.autoResolved && resolution.resolvedLines) {
        // Replace this conflict with the auto-resolved content
        result.push(...resolution.resolvedLines);
      } else {
        // Keep unresolved conflict markers intact
        result.push(...conflictBuffer);
      }
      conflictIdx++;
      inConflict = false;
      conflictBuffer = [];
    } else if (inConflict) {
      conflictBuffer.push(line);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}
