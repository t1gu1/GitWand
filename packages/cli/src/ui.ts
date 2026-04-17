/**
 * Sortie console — couleurs ANSI, bannière, détection CI/no-color.
 *
 * Isolé du reste du CLI pour que `printHelp` (dans `cli.ts`) et les
 * commandes (`commands/*.ts`) partagent une même palette et un même
 * comportement d'absence de couleur (CI + NO_COLOR).
 */

/** Vrai si on tourne sous un runner CI (variable `CI` à 1/true). */
export const isCI = process.env.CI === "true" || process.env.CI === "1";
/** Vrai si on doit désactiver les couleurs (CI ou `NO_COLOR` défini). */
export const noColor = isCI || process.env.NO_COLOR !== undefined;

/**
 * Palette ANSI. Lorsque `noColor` est actif, chaque clé vaut `""`, ce qui
 * permet d'utiliser les templates `${c.green}…${c.reset}` sans branchement
 * à chaque appel.
 */
export const c = noColor
  ? { reset: "", bold: "", dim: "", green: "", yellow: "", red: "", cyan: "", magenta: "" }
  : {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      red: "\x1b[31m",
      cyan: "\x1b[36m",
      magenta: "\x1b[35m",
    };

/** Étincelle utilisée comme logo — remplacée par `*` en mode no-color. */
export const WAND = noColor ? "*" : "\u2728";

export function printBanner(): void {
  console.log(
    `\n${c.magenta}${c.bold}  ${WAND} GitWand${c.reset} ${c.dim}— Git's magic wand${c.reset}\n`,
  );
}
