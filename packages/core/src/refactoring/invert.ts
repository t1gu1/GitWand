/**
 * GitWand v2.6 — Inversion de refactorings (expérimental)
 *
 * Inverse les refactorings détectés par `detect.ts` pour ramener une branche
 * à la nomenclature de la version de base avant la résolution textuelle.
 *
 * ## Rôle dans le pipeline RefMerge
 *
 * ```
 * base ──────────────────────────────────────────────────────┐
 *        ↘ (refactorings ours)                               │
 * ours ──→ invertRefactorings(ours, refs_ours) ──→ ours'     ├─→ merge textuel → merged'
 *        ↘ (refactorings theirs)                             │
 * theirs → invertRefactorings(theirs, refs_theirs) → theirs' ┘
 * ```
 *
 * Après inversion, `ours'` et `theirs'` utilisent la même nomenclature que
 * `base`, ce qui rend le merge textuel robuste aux conflits de renommage.
 *
 * ## Algorithme
 *
 * Pour chaque `Refactoring` dans la liste :
 * - `rename-local`     : remplacer `newName` → `oldName` dans la portée (`scope`)
 * - `rename-top-level` : remplacer `newName` → `oldName` dans tout le fichier
 * - `move-method`      : aucune inversion textuelle possible à ce stade
 *                        (la méthode est déjà dans la classe cible — on laisse)
 *
 * ## Garanties
 * - Retourne les lignes inchangées si la liste de refactorings est vide.
 * - Retourne les lignes inchangées en cas d'erreur (safe by default).
 * - Zéro import Node.js — compatible browser, Node.js, Tauri WebView.
 */

import type { Refactoring } from "../types.js";

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/** Échappe les caractères spéciaux pour une utilisation dans un RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remplace toutes les occurrences d'un identifiant dans un texte,
 * en respectant les limites de mots (`\b`) pour éviter les substitutions partielles.
 *
 * @param text    - Texte source
 * @param oldName - Identifiant à remplacer
 * @param newName - Identifiant de remplacement
 * @returns Texte avec les substitutions appliquées
 */
function replaceIdentifier(text: string, oldName: string, newName: string): string {
  const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
  return text.replace(pattern, newName);
}

/**
 * Détermine si une ligne fait partie de la portée d'une fonction donnée.
 *
 * Heuristique : la portée commence à la dernière occurrence de la déclaration
 * de `scope` avant la ligne, et s'étend jusqu'à ce que la profondeur des
 * accolades revienne au niveau d'entrée.
 *
 * Cette implémentation opère sur le texte complet (join des lignes) et retourne
 * une paire `[start, end]` d'indices de caractères délimitant la portée.
 *
 * Retourne `null` si la portée ne peut pas être localisée.
 */
function findScopeRange(text: string, scope: string): [number, number] | null {
  // Chercher la déclaration de la portée
  const scopePattern = new RegExp(
    `(?:async\\s+)?function\\s+${escapeRegex(scope)}\\s*\\(` +
    `|(?:const|let|var)\\s+${escapeRegex(scope)}\\s*=`,
    "g",
  );

  const match = scopePattern.exec(text);
  if (!match) return null;

  const start = match.index;
  let depth = 0;
  let inScope = false;
  let scopeStart = start;
  let scopeEnd = text.length;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (!inScope) {
        inScope = true;
        scopeStart = i;
        depth = 1;
      } else {
        depth++;
      }
    } else if (ch === "}" && inScope) {
      depth--;
      if (depth === 0) {
        scopeEnd = i + 1;
        break;
      }
    }
  }

  if (!inScope) return null;
  // Return range from the function keyword (not just the body `{`) so that
  // parameter names in the signature are also included in the replacement.
  return [start, scopeEnd];
}

// ─── Inversion d'un refactoring ───────────────────────────────────────────────

/**
 * Inverse un seul refactoring dans le texte complet du fichier.
 *
 * @param text        - Contenu courant du fichier (branche à inverser)
 * @param refactoring - Refactoring à inverser
 * @returns Texte avec le refactoring inversé
 */
function invertOne(text: string, refactoring: Refactoring): string {
  const { kind, oldName, newName, scope } = refactoring;

  switch (kind) {
    case "rename-top-level": {
      // Substitution globale : newName → oldName dans tout le fichier
      if (!newName) return text;
      return replaceIdentifier(text, newName, oldName);
    }

    case "rename-local": {
      // Substitution limitée à la portée `scope` si disponible
      if (!newName) return text;
      if (!scope) {
        // Pas de portée connue → substitution globale (plus conservative)
        return replaceIdentifier(text, newName, oldName);
      }

      // Localiser la portée dans le texte
      const range = findScopeRange(text, scope);
      if (!range) {
        // Portée introuvable → substitution globale (dégradation sûre)
        return replaceIdentifier(text, newName, oldName);
      }

      const [scopeStart, scopeEnd] = range;
      const before = text.slice(0, scopeStart);
      const inside = text.slice(scopeStart, scopeEnd);
      const after = text.slice(scopeEnd);

      return before + replaceIdentifier(inside, newName, oldName) + after;
    }

    case "move-method": {
      // Pas d'inversion textuelle : la méthode est déjà dans la nouvelle classe.
      // L'orchestrateur gère ce cas différemment (merge structurel de la méthode).
      return text;
    }
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Inverse une liste de refactorings dans les lignes d'une branche.
 *
 * Applique les inversions dans l'ordre inverse de la liste (le dernier
 * refactoring détecté est inversé en premier) pour gérer correctement
 * les chaînes de renommage.
 *
 * @param branchLines  - Lignes de la branche (ours ou theirs) à inverser
 * @param refactorings - Liste des refactorings détectés sur cette branche
 * @returns Lignes avec les refactorings inversés, prêtes pour le merge textuel
 *
 * @example
 * ```ts
 * const refs = detectRefactorings(baseLines, oursLines);
 * const oursInverted = invertRefactorings(oursLines, refs);
 * // oursInverted utilise maintenant la nomenclature de base
 * ```
 */
export function invertRefactorings(
  branchLines: string[],
  refactorings: Refactoring[],
): string[] {
  try {
    if (refactorings.length === 0) return branchLines;

    let text = branchLines.join("\n");

    // Appliquer les inversions en ordre inverse
    for (let i = refactorings.length - 1; i >= 0; i--) {
      text = invertOne(text, refactorings[i]!);
    }

    return text.split("\n");
  } catch {
    // Dégradation silencieuse — retourner les lignes inchangées
    return branchLines;
  }
}
