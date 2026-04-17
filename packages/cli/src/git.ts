/**
 * Intégration Git — découverte des fichiers en conflit.
 *
 * `execSync` est volontairement utilisé (vs un appel asynchrone) car cet
 * appel est effectué une seule fois au démarrage d'une commande, avant
 * tout travail en parallèle. Un échec (hors repo git, binaire absent…)
 * est tolérant : on retourne une liste vide plutôt que de faire crasher
 * le CLI, ce qui laisse le comportement « aucun conflit détecté » prendre
 * le relais.
 */

import { execSync } from "node:child_process";

/**
 * Retourne la liste des fichiers en conflit dans le dépôt Git courant.
 *
 * S'appuie sur `git diff --name-only --diff-filter=U` (U = unmerged).
 * Retourne un tableau vide si Git est indisponible, si on n'est pas dans
 * un dépôt, ou si la commande échoue pour toute autre raison.
 */
export function getConflictedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only --diff-filter=U", {
      encoding: "utf-8",
    });
    return output
      .trim()
      .split("\n")
      .filter((f: string) => f.length > 0);
  } catch {
    return [];
  }
}
