/**
 * Commande `gitwand status` — aperçu des conflits sans écriture.
 *
 * Lit chaque fichier en conflit, le passe à `resolve()` en lecture seule
 * pour estimer le ratio `resolvable/total`, puis affiche un résumé par
 * fichier (ou un JSON en mode CI).
 *
 * Comme pour `resolve`, la boucle est parallélisée (P1.3) avec `runPool`
 * et l'affichage est ordonné à l'identique de la liste des fichiers en
 * conflit retournée par Git.
 */

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { resolve } from "@gitwand/core";

import { c, printBanner } from "../ui.js";
import { getConflictedFiles } from "../git.js";
import { parseConcurrency, runPool } from "../concurrency.js";

export async function cmdStatus(
  flags: Record<string, boolean | string>,
): Promise<void> {
  const isCIMode = flags.ci || flags.json;
  const concurrency = parseConcurrency(flags.concurrency);

  if (!isCIMode) {
    printBanner();
  }

  const files = getConflictedFiles();

  if (files.length === 0) {
    if (isCIMode) {
      console.log(JSON.stringify({ files: 0, conflicts: [] }, null, 2));
      return;
    }
    console.log(`${c.green}No conflicted files.${c.reset}\n`);
    return;
  }

  if (!isCIMode) {
    console.log(`${c.cyan}${files.length} conflicted file(s):${c.reset}\n`);
  }

  type StatusOutcome = {
    entry: { path: string; total: number; resolvable: number; percentage: number } | null;
    printLine: string | null;
  };

  const outcomes = await runPool<string, StatusOutcome>(files, concurrency, async (file) => {
    const filePath = resolvePath(file);
    try {
      const content = await readFile(filePath, "utf-8");
      const result = resolve(content, file);
      const resolvable = result.stats.autoResolved;
      const total = result.stats.totalConflicts;
      const pct = total > 0 ? Math.round((resolvable / total) * 100) : 0;
      const entry = { path: file, total, resolvable, percentage: pct };
      if (isCIMode) return { entry, printLine: null };
      const color = pct === 100 ? c.green : pct > 0 ? c.yellow : c.red;
      return {
        entry,
        printLine: `  ${color}${file}${c.reset} — ${resolvable}/${total} resolvable (${pct}%)`,
      };
    } catch {
      return {
        entry: null,
        printLine: isCIMode ? null : `  ${c.red}${file}${c.reset} — read error`,
      };
    }
  });

  const statusEntries = outcomes
    .map((o) => o.entry)
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (!isCIMode) {
    for (const outcome of outcomes) {
      if (outcome.printLine !== null) console.log(outcome.printLine);
    }
  }

  if (isCIMode) {
    console.log(JSON.stringify({ files: files.length, conflicts: statusEntries }, null, 2));
  } else {
    console.log();
  }
}
