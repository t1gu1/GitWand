/**
 * GitWand Diff Utilities
 *
 * Algorithme LCS (Longest Common Subsequence) et 3-way merge
 * pour détecter et fusionner les changements non-overlapping.
 */

/** Une opération de diff sur une ligne */
export interface DiffOp {
  type: "keep" | "add" | "remove";
  line: string;
  /** Index dans le tableau source (base pour keep/remove, branch pour add) */
  index: number;
}

/**
 * Seuil au-delà duquel on bascule sur Hirschberg (mémoire O(min(n,m))) au lieu
 * du DP plein (mémoire O(n*m)). À 4M cellules → ~16MB avec un Int32Array, déjà
 * lourd en mémoire mais tolérable en pic. Au-dessus, Hirschberg est obligatoire
 * pour éviter un OOM sur les gros fichiers (lockfiles, bundles minifiés…).
 */
const HIRSCHBERG_THRESHOLD = 4_000_000;

/**
 * Calcule la Longest Common Subsequence entre deux tableaux de lignes.
 * Retourne les indices des lignes communes dans chaque tableau.
 *
 * Stratégie hybride (P2.1) :
 * - petit/moyen (n*m ≤ 4M cellules) → DP plein O(n*m) avec `Int32Array`
 *   (4 octets/cellule vs 8-16 octets pour des `number[][]`) ;
 * - gros → Hirschberg récursif, mémoire O(min(n,m)) + O(log n) de pile.
 *
 * Le comportement observable (tie-break, pairs retournées) est identique entre
 * les deux branches — voir `src/__tests__/diff.test.ts`.
 */
export function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  if (n * m <= HIRSCHBERG_THRESHOLD) {
    return lcsDenseDP(a, b);
  }
  return lcsHirschberg(a, b);
}

/**
 * DP plein avec `Int32Array` (mémoire compacte, 4 octets/cellule).
 * Équivalent structurel à l'implémentation historique — même tie-break,
 * mêmes paires retournées.
 */
function lcsDenseDP(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  // Table DP aplatie : dp[i*W + j] ≡ dp[i][j].
  const dp = new Int32Array((n + 1) * W);

  for (let i = 1; i <= n; i++) {
    const row = i * W;
    const prev = (i - 1) * W;
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[row + j] = dp[prev + (j - 1)] + 1;
      } else {
        const up = dp[prev + j];
        const left = dp[row + (j - 1)];
        dp[row + j] = up > left ? up : left;
      }
    }
  }

  // Backtrack : mêmes règles de tie-break que l'implémentation historique.
  const result: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[(i - 1) * W + j] > dp[i * W + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  result.reverse();
  return result;
}

/**
 * Implémentation Hirschberg exposée pour les tests (et usage avancé éventuel).
 * L'API publique `lcs()` choisit automatiquement entre cette variante et le DP
 * plein selon la taille de l'input. Exporter sous le préfixe `_` signale son
 * caractère d'interne-testable.
 */
export const _lcsHirschberg = (a: string[], b: string[]): Array<[number, number]> =>
  lcsHirschberg(a, b);

/**
 * Hirschberg : divide-and-conquer qui trouve le point de split optimal dans `a`
 * en utilisant seulement 2 lignes de DP (mémoire O(min(n,m))), puis recurse sur
 * les deux moitiés. Les paires LCS retournées peuvent différer de celles du DP
 * plein **sur les ties**, mais la longueur et la validité sont garanties.
 *
 * Stratégie pour rester iso-comportement avec `lcsDenseDP` :
 * - Sous un petit seuil de récursion (`n ≤ 2` ou `m ≤ 2`), on tombe sur des
 *   cas triviaux résolus directement (même tie-break que le DP plein).
 * - Le split choisit le `j*` qui maximise `scoreL[j] + scoreR[m - j]`, et en
 *   cas d'ex-æquo on prend le **plus petit** `j*` (équivalent au tie-break
 *   "j-- d'abord" du backtrack historique).
 */
function lcsHirschberg(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;

  // Cas de base : une seule ligne à gauche → chercher la première occurrence.
  if (n === 0 || m === 0) return [];
  if (n === 1) {
    const target = a[0];
    for (let j = 0; j < m; j++) {
      if (b[j] === target) return [[0, j]];
    }
    return [];
  }

  const mid = n >> 1; // n / 2 floor
  // Scores DP pour a[0..mid] contre b (forward), longueur m+1.
  const scoreL = lcsScoreRow(a, 0, mid, b, 0, m, false);
  // Scores DP pour a[mid..n] contre b (reverse), longueur m+1.
  const scoreR = lcsScoreRow(a, mid, n, b, 0, m, true);

  // Trouver le j* qui maximise scoreL[j] + scoreR[m - j].
  // En cas d'ex-æquo, on prend le plus petit j pour rester proche du tie-break
  // historique (backtrack « j-- en premier » ≈ préférer les splits « early »).
  let bestJ = 0;
  let bestScore = scoreL[0] + scoreR[m];
  for (let j = 1; j <= m; j++) {
    const s = scoreL[j] + scoreR[m - j];
    if (s > bestScore) {
      bestScore = s;
      bestJ = j;
    }
  }

  // Récursion + ajustement des indices pour la moitié droite.
  const left = lcsHirschberg(a.slice(0, mid), b.slice(0, bestJ));
  const rightRaw = lcsHirschberg(a.slice(mid), b.slice(bestJ));
  const right: Array<[number, number]> = rightRaw.map(([i, j]) => [i + mid, j + bestJ]);
  return left.concat(right);
}

/**
 * Calcule la dernière ligne du tableau DP LCS en 2 lignes (mémoire O(m+1)).
 *
 * @param a - tableau source pour la dimension « rows »
 * @param aStart - début (inclus) dans a
 * @param aEnd - fin (exclus) dans a
 * @param b - tableau source pour la dimension « cols »
 * @param bStart - début (inclus) dans b
 * @param bEnd - fin (exclus) dans b
 * @param reverse - si true, parcourt a et b à l'envers (pour Hirschberg)
 */
function lcsScoreRow(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  reverse: boolean,
): Int32Array {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    const ai = reverse ? a[aEnd - i] : a[aStart + i - 1];
    for (let j = 1; j <= m; j++) {
      const bj = reverse ? b[bEnd - j] : b[bStart + j - 1];
      if (ai === bj) {
        curr[j] = prev[j - 1] + 1;
      } else {
        const up = prev[j];
        const left = curr[j - 1];
        curr[j] = up > left ? up : left;
      }
    }
    // Swap prev ↔ curr (éviter une réallocation)
    const tmp = prev;
    prev = curr;
    curr = tmp;
    // Reset curr à 0 pour la prochaine itération
    curr.fill(0);
  }
  // Après la boucle, la dernière ligne calculée est dans `prev`.
  return prev;
}

/**
 * Calcule le diff entre une base et une branche.
 * Retourne la séquence d'opérations (keep, add, remove).
 */
export function computeDiff(base: string[], branch: string[]): DiffOp[] {
  const common = lcs(base, branch);
  const ops: DiffOp[] = [];

  let baseIdx = 0;
  let branchIdx = 0;

  for (const [bIdx, rIdx] of common) {
    // Lignes supprimées de la base (avant le prochain match)
    while (baseIdx < bIdx) {
      ops.push({ type: "remove", line: base[baseIdx], index: baseIdx });
      baseIdx++;
    }
    // Lignes ajoutées dans la branche (avant le prochain match)
    while (branchIdx < rIdx) {
      ops.push({ type: "add", line: branch[branchIdx], index: branchIdx });
      branchIdx++;
    }
    // Ligne commune
    ops.push({ type: "keep", line: base[baseIdx], index: baseIdx });
    baseIdx++;
    branchIdx++;
  }

  // Lignes restantes après le dernier match
  while (baseIdx < base.length) {
    ops.push({ type: "remove", line: base[baseIdx], index: baseIdx });
    baseIdx++;
  }
  while (branchIdx < branch.length) {
    ops.push({ type: "add", line: branch[branchIdx], index: branchIdx });
    branchIdx++;
  }

  return ops;
}

/**
 * Représente un changement (edit) d'une branche par rapport à la base.
 * start/end sont les indices dans la base où le changement s'applique.
 */
export interface Edit {
  /** Index de début dans la base (inclus) — position avant laquelle insérer ou début de la zone supprimée */
  baseStart: number;
  /** Index de fin dans la base (exclus) — fin de la zone supprimée */
  baseEnd: number;
  /** Lignes ajoutées à cette position */
  addedLines: string[];
  /** Source : "ours" ou "theirs" */
  source: "ours" | "theirs";
}

/**
 * Extrait les edits (changements groupés) d'un diff.
 * Chaque groupe contigu de add/remove forme un edit.
 */
export function extractEdits(
  diff: DiffOp[],
  source: "ours" | "theirs",
): Edit[] {
  const edits: Edit[] = [];
  let i = 0;

  while (i < diff.length) {
    if (diff[i].type === "keep") {
      i++;
      continue;
    }

    // Début d'un groupe de changements
    const removedLines: number[] = [];
    const addedLines: string[] = [];

    while (i < diff.length && diff[i].type !== "keep") {
      if (diff[i].type === "remove") {
        removedLines.push(diff[i].index);
      } else {
        addedLines.push(diff[i].line);
      }
      i++;
    }

    const baseStart =
      removedLines.length > 0
        ? removedLines[0]
        : // Pour un pur ajout, on utilise l'index de la prochaine ligne keep
          findNextKeepBaseIndex(diff, i);
    const baseEnd =
      removedLines.length > 0
        ? removedLines[removedLines.length - 1] + 1
        : baseStart; // Pur ajout : pas de suppression

    edits.push({ baseStart, baseEnd, addedLines, source });
  }

  return edits;
}

/** Trouve l'index base de la prochaine opération "keep" à partir de la position i */
function findNextKeepBaseIndex(diff: DiffOp[], fromIdx: number): number {
  for (let j = fromIdx; j < diff.length; j++) {
    if (diff[j].type === "keep") {
      return diff[j].index;
    }
  }
  // Si pas de keep après, c'est un ajout en fin de fichier
  // On retourne l'index après la dernière ligne de la base
  for (let j = diff.length - 1; j >= 0; j--) {
    if (diff[j].type === "keep" || diff[j].type === "remove") {
      return diff[j].index + 1;
    }
  }
  return 0;
}

/**
 * Vérifie si deux edits se chevauchent (overlap).
 * Deux edits overlap si leurs zones dans la base se croisent.
 */
export function editsOverlap(a: Edit, b: Edit): boolean {
  // Les edits sont des intervalles [baseStart, baseEnd) dans la base
  // Ils overlap si un commence avant que l'autre finisse

  // Cas spécial : deux purs ajouts au même point
  if (a.baseStart === a.baseEnd && b.baseStart === b.baseEnd) {
    return a.baseStart === b.baseStart;
  }

  // Cas spécial : un pur ajout à un point touché par l'autre
  if (a.baseStart === a.baseEnd) {
    return a.baseStart >= b.baseStart && a.baseStart < b.baseEnd;
  }
  if (b.baseStart === b.baseEnd) {
    return b.baseStart >= a.baseStart && b.baseStart < a.baseEnd;
  }

  // Cas général : overlap d'intervalles
  return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd;
}

/**
 * Tente de fusionner les changements non-overlapping de deux branches.
 *
 * @returns Les lignes fusionnées, ou null si les changements se chevauchent
 */
export function mergeNonOverlapping(
  base: string[],
  ours: string[],
  theirs: string[],
): string[] | null {
  const oursDiff = computeDiff(base, ours);
  const theirsDiff = computeDiff(base, theirs);

  const oursEdits = extractEdits(oursDiff, "ours");
  const theirsEdits = extractEdits(theirsDiff, "theirs");

  // Vérifier qu'aucun edit ne chevauche un edit de l'autre branche
  for (const oEdit of oursEdits) {
    for (const tEdit of theirsEdits) {
      if (editsOverlap(oEdit, tEdit)) {
        return null; // Overlap détecté → pas de résolution automatique
      }
    }
  }

  // Fusionner les edits triés par position dans la base
  const allEdits = [...oursEdits, ...theirsEdits].sort(
    (a, b) => a.baseStart - b.baseStart || a.baseEnd - b.baseEnd,
  );

  // Reconstruire le fichier fusionné
  const result: string[] = [];
  let baseIdx = 0;

  for (const edit of allEdits) {
    // Copier les lignes de la base jusqu'au début de l'edit
    while (baseIdx < edit.baseStart) {
      result.push(base[baseIdx]);
      baseIdx++;
    }

    // Ajouter les lignes de l'edit
    result.push(...edit.addedLines);

    // Avancer au-delà de la zone supprimée
    if (edit.baseEnd > baseIdx) {
      baseIdx = edit.baseEnd;
    }
  }

  // Copier le reste de la base
  while (baseIdx < base.length) {
    result.push(base[baseIdx]);
    baseIdx++;
  }

  return result;
}
