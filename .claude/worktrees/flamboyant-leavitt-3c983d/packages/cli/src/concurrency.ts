/**
 * Pool de concurrence borné — primitive de parallélisation (P1.3).
 *
 * Le CLI n'a volontairement aucune dépendance runtime hors `@gitwand/core`.
 * Plutôt que d'ajouter `p-limit`/`p-queue`, on expose ici un petit pool
 * indexé qui préserve l'ordre des résultats (chaque worker écrit son
 * `results[i]` à la position d'origine de l'item) — garantie importante
 * pour rester déterministe vis-à-vis de l'affichage utilisateur et du
 * rapport JSON CI.
 */

/** Borne par défaut sur le nombre de fichiers traités en parallèle. */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Petit pool de workers avec concurrence bornée.
 *
 * @param items        — items à traiter (liste indexée)
 * @param concurrency  — plafond de workers en vol (min = 1, clampé à `items.length`)
 * @param worker       — fonction appelée par item, async autorisée
 * @returns tableau de résultats dans l'ordre des `items` d'entrée
 */
export async function runPool<In, Out>(
  items: In[],
  concurrency: number,
  worker: (item: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const results: Out[] = new Array(items.length);
  const width = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runOne = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: width }, runOne));
  return results;
}

/**
 * Extrait une concurrence entière positive depuis un flag stringifié
 * (`--concurrency=12`). Retourne `DEFAULT_CONCURRENCY` pour toute valeur
 * non parseable ou ≤ 0, afin de ne jamais casser l'invocation.
 */
export function parseConcurrency(flag: boolean | string | undefined): number {
  if (typeof flag !== "string") return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(flag, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONCURRENCY;
  return n;
}
