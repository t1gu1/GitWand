/**
 * GitWand v2.6 — Rejeu de refactorings (expérimental)
 *
 * Rejoue les refactorings sur le résultat du merge textuel pour produire
 * la sortie finale RefMerge.
 *
 * ## Rôle dans le pipeline RefMerge
 *
 * ```
 * merged' (résultat du merge textuel sur les branches inversées)
 *    │
 *    ↓ replayRefactorings(merged', refs_ours ∪ refs_theirs)
 *    │
 * merged (sortie finale — nomenclature de la branche qui a renommé)
 * ```
 *
 * ## Stratégie de rejeu
 *
 * Quand ours et theirs ont tous deux renommé le même symbole (ex: `x` → `y`
 * des deux côtés), le rejeu est simple : appliquer une fois.
 *
 * Quand ours et theirs ont renommé différemment (ex: ours `x` → `y`,
 * theirs `x` → `z`), c'est un conflit de renommage réel. Le pipeline
 * RefMerge préfère le renommage de **ours** dans ce cas (comportement
 * analogue à `prefer-ours` pour les renommages). Le conflit résiduel est
 * tracé dans le `DecisionTrace` par l'orchestrateur.
 *
 * ## Algorithme
 *
 * Pour chaque `Refactoring` dans la liste (dédupliquée) :
 * - `rename-local`     : remplacer `oldName` → `newName` dans la portée
 * - `rename-top-level` : remplacer `oldName` → `newName` dans tout le texte
 * - `move-method`      : no-op (déjà géré par le merge structurel)
 *
 * ## Garanties
 * - Retourne les lignes inchangées si la liste est vide.
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
 */
function replaceIdentifier(text: string, oldName: string, newName: string): string {
  const pattern = new RegExp(`\\b${escapeRegex(oldName)}\\b`, "g");
  return text.replace(pattern, newName);
}

/**
 * Localise la portée d'une fonction dans le texte et retourne ses indices.
 * Miroir de la même fonction dans `invert.ts`.
 */
function findScopeRange(text: string, scope: string): [number, number] | null {
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
  return [scopeStart, scopeEnd];
}

// ─── Déduplication et résolution de conflits de renommage ─────────────────────

/**
 * Déduplique et fusionne deux listes de refactorings (ours + theirs).
 *
 * Règles :
 * 1. Si ours et theirs ont le même `(kind, oldName, newName)` → garder une copie.
 * 2. Si ours et theirs ont renommé le même `oldName` différemment →
 *    préférer ours (comportement `prefer-ours` pour les renommages).
 * 3. Les refactorings sans conflit des deux côtés sont tous inclus.
 * 4. Les `move-method` sont inclus sans déduplication (clé = `oldName + sourceClass`).
 *
 * @returns Liste déduplicée, avec les refactorings ours prioritaires en cas de conflit.
 */
export function mergeRefactorings(
  oursRefs: Refactoring[],
  theirsRefs: Refactoring[],
): Refactoring[] {
  // Index des refactorings de ours par `kind:oldName`
  const oursIndex = new Map<string, Refactoring>();
  for (const r of oursRefs) {
    oursIndex.set(`${r.kind}:${r.oldName}`, r);
  }

  const result: Refactoring[] = [...oursRefs];
  const seen = new Set(oursIndex.keys());

  for (const r of theirsRefs) {
    const key = `${r.kind}:${r.oldName}`;
    if (!seen.has(key)) {
      // Pas de conflit avec ours → inclure
      result.push(r);
      seen.add(key);
    }
    // Si déjà présent dans ours → ours est prioritaire, skip theirs
  }

  return result;
}

// ─── Rejeu d'un refactoring ───────────────────────────────────────────────────

/**
 * Rejoue un seul refactoring sur le texte fusionné.
 *
 * @param text        - Contenu courant du fichier fusionné
 * @param refactoring - Refactoring à rejouer
 * @returns Texte avec le refactoring appliqué
 */
function replayOne(text: string, refactoring: Refactoring): string {
  const { kind, oldName, newName, scope } = refactoring;

  switch (kind) {
    case "rename-top-level": {
      if (!newName) return text;
      return replaceIdentifier(text, oldName, newName);
    }

    case "rename-local": {
      if (!newName) return text;
      if (!scope) {
        // Pas de portée → substitution globale (dégradation sûre)
        return replaceIdentifier(text, oldName, newName);
      }

      const range = findScopeRange(text, scope);
      if (!range) {
        // Portée introuvable → substitution globale
        return replaceIdentifier(text, oldName, newName);
      }

      const [scopeStart, scopeEnd] = range;
      const before = text.slice(0, scopeStart);
      const inside = text.slice(scopeStart, scopeEnd);
      const after = text.slice(scopeEnd);

      return before + replaceIdentifier(inside, oldName, newName) + after;
    }

    case "move-method": {
      // Le déplacement de méthode est géré structurellement par l'orchestrateur.
      // Aucune substitution textuelle à appliquer ici.
      return text;
    }
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Rejoue une liste de refactorings sur les lignes du résultat de merge.
 *
 * Applique les refactorings dans leur ordre naturel (premier détecté =
 * premier rejoué), ce qui est l'inverse de l'ordre d'inversion.
 * Cette symétrie garantit que `replay(invert(branch, refs), refs) ≈ branch`
 * à isomorphisme de merge près.
 *
 * @param mergedLines  - Lignes du résultat du merge textuel (base inversée)
 * @param refactorings - Liste des refactorings à rejouer (déjà déduplicée)
 * @returns Lignes avec les refactorings réappliqués, prêtes comme sortie finale
 *
 * @example
 * ```ts
 * const refs = mergeRefactorings(oursRefs, theirsRefs);
 * const finalLines = replayRefactorings(mergedLines, refs);
 * // finalLines utilise la nomenclature finale (post-refactoring)
 * ```
 */
export function replayRefactorings(
  mergedLines: string[],
  refactorings: Refactoring[],
): string[] {
  try {
    if (refactorings.length === 0) return mergedLines;

    let text = mergedLines.join("\n");

    for (const refactoring of refactorings) {
      text = replayOne(text, refactoring);
    }

    return text.split("\n");
  } catch {
    // Dégradation silencieuse — retourner les lignes inchangées
    return mergedLines;
  }
}
