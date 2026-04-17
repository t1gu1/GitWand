#!/usr/bin/env node

/**
 * GitWand CLI
 *
 * Usage:
 *   gitwand resolve [files...]       Auto-resolve trivial conflicts
 *   gitwand status                   Show conflict status for the repo
 *   gitwand --help                   Show help
 *
 * CI mode:
 *   gitwand resolve --ci             JSON output + exit code 1 if conflicts remain
 *
 * @example
 *   npx gitwand resolve
 *   npx gitwand resolve src/app.ts src/config.ts
 *   npx gitwand resolve --ci --dry-run
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { resolve, type MergeResult } from "@gitwand/core";

// ─── Concurrency pool ───────────────────────────────────────────

/** Borne par défaut sur le nombre de fichiers traités en parallèle. */
const DEFAULT_CONCURRENCY = 8;

/**
 * Petit pool de workers avec concurrence bornée. Préserve l'ordre des
 * résultats (résultats écrits à `results[i]`), indépendamment de l'ordre
 * de complétion. Conçu pour rester dépourvu de dépendance externe — le
 * CLI n'a volontairement aucun runtime dep hors `@gitwand/core`.
 *
 * @param items        — items à traiter (liste indexée)
 * @param concurrency  — plafond de workers en vol (min = 1)
 * @param worker       — fonction appelée par item, async autorisée
 */
async function runPool<In, Out>(
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
function parseConcurrency(flag: boolean | string | undefined): number {
  if (typeof flag !== "string") return DEFAULT_CONCURRENCY;
  const n = Number.parseInt(flag, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONCURRENCY;
  return n;
}

// ─── ANSI Colors ────────────────────────────────────────────────
const isCI = process.env.CI === "true" || process.env.CI === "1";
const noColor = isCI || process.env.NO_COLOR !== undefined;

const c = noColor
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

const WAND = noColor ? "*" : "\u2728";

function printBanner() {
  console.log(
    `\n${c.magenta}${c.bold}  ${WAND} GitWand${c.reset} ${c.dim}— Git's magic wand${c.reset}\n`,
  );
}

function printHelp() {
  printBanner();
  console.log(`${c.bold}Usage:${c.reset}`);
  console.log(`  gitwand resolve [files...]      Auto-resolve trivial conflicts`);
  console.log(`  gitwand status                  Show conflict status`);
  console.log(`  gitwand --help                  Show this help`);
  console.log();
  console.log(`${c.bold}Options:${c.reset}`);
  console.log(`  --dry-run         Analyze without writing files`);
  console.log(`  --verbose         Show details for each resolution`);
  console.log(`  --no-whitespace   Don't resolve whitespace-only conflicts`);
  console.log(`  --concurrency=N   Parallel file workers (default ${DEFAULT_CONCURRENCY}, min 1)`);
  console.log(`  --ci              CI mode: JSON output + exit code 1 if unresolved`);
  console.log(`  --json            Output results as JSON (implies --ci behavior)`);
  console.log();
}

/**
 * Get the list of conflicted files in the current Git repo.
 */
function getConflictedFiles(): string[] {
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

/** JSON report for CI mode */
interface CIReport {
  version: string;
  timestamp: string;
  summary: {
    files: number;
    totalConflicts: number;
    autoResolved: number;
    remaining: number;
    allResolved: boolean;
  };
  files: Array<{
    path: string;
    totalConflicts: number;
    autoResolved: number;
    remaining: number;
    validation: {
      isValid: boolean;
      hasResidualMarkers: boolean;
      syntaxError: string | null;
    };
    resolutions: Array<{
      line: number;
      type: string;
      resolved: boolean;
      explanation: string;
      confidence: {
        overall: number;
        typeClassification: number;
        dataRisk: number;
        scopeImpact: number;
      };
      trace: {
        selected: string;
        hasBase: boolean;
        summary: string;
        steps: Array<{
          type: string;
          passed: boolean;
          reason: string;
        }>;
      };
    }>;
    pendingHunks: Array<{
      line: number;
      type: string;
      explanation: string;
      ours: string;
      theirs: string;
      base: string;
      confidence: {
        overall: number;
        typeClassification: number;
        dataRisk: number;
        scopeImpact: number;
      };
      trace: {
        selected: string;
        hasBase: boolean;
        summary: string;
        steps: Array<{
          type: string;
          passed: boolean;
          reason: string;
        }>;
      };
    }>;
  }>;
}

/**
 * Build a CI-friendly JSON report from results.
 */
function buildCIReport(
  results: Array<{ file: string; result: MergeResult }>,
): CIReport {
  let totalConflicts = 0;
  let totalResolved = 0;

  const files = results.map(({ file, result }) => {
    totalConflicts += result.stats.totalConflicts;
    totalResolved += result.stats.autoResolved;

    return {
      path: file,
      totalConflicts: result.stats.totalConflicts,
      autoResolved: result.stats.autoResolved,
      remaining: result.stats.remaining,
      validation: {
        isValid: result.validation.isValid,
        hasResidualMarkers: result.validation.hasResidualMarkers,
        syntaxError: result.validation.syntaxError,
      },
      resolutions: result.resolutions.map((r) => ({
        line: r.hunk.startLine,
        type: r.hunk.type,
        resolved: r.autoResolved,
        explanation: r.hunk.explanation,
        confidence: {
          overall: r.hunk.confidence.score,
          typeClassification: r.hunk.confidence.dimensions.typeClassification,
          dataRisk: r.hunk.confidence.dimensions.dataRisk,
          scopeImpact: r.hunk.confidence.dimensions.scopeImpact,
        },
        trace: {
          selected: r.hunk.trace.selected,
          hasBase: r.hunk.trace.hasBase,
          summary: r.hunk.trace.summary,
          steps: r.hunk.trace.steps.map((s) => ({
            type: s.type,
            passed: s.passed,
            reason: s.reason,
          })),
        },
      })),
      pendingHunks: result.resolutions
        .filter((r) => !r.autoResolved)
        .map((r) => ({
          line: r.hunk.startLine,
          type: r.hunk.type,
          explanation: r.hunk.explanation,
          ours: r.hunk.oursLines.join("\n"),
          theirs: r.hunk.theirsLines.join("\n"),
          base: r.hunk.baseLines.join("\n"),
          confidence: {
            overall: r.hunk.confidence.score,
            typeClassification: r.hunk.confidence.dimensions.typeClassification,
            dataRisk: r.hunk.confidence.dimensions.dataRisk,
            scopeImpact: r.hunk.confidence.dimensions.scopeImpact,
          },
          trace: {
            selected: r.hunk.trace.selected,
            hasBase: r.hunk.trace.hasBase,
            summary: r.hunk.trace.summary,
            steps: r.hunk.trace.steps.map((s) => ({
              type: s.type,
              passed: s.passed,
              reason: s.reason,
            })),
          },
        })),
    };
  });

  return {
    version: "0.0.1",
    timestamp: new Date().toISOString(),
    summary: {
      files: results.length,
      totalConflicts,
      autoResolved: totalResolved,
      remaining: totalConflicts - totalResolved,
      allResolved: totalConflicts - totalResolved === 0,
    },
    files,
  };
}

/**
 * Build partially-resolved file content: replace auto-resolved conflict
 * blocks with their resolved lines, keep unresolved blocks intact.
 */
function buildPartialContent(
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

/**
 * Main command: resolve
 */
async function cmdResolve(files: string[], flags: Record<string, boolean | string>) {
  const isCIMode = flags.ci || flags.json;
  const verbose = !isCIMode && (flags.verbose === true || typeof flags.verbose === "string");
  const resolveWhitespace = !(flags["no-whitespace"] === true);
  const concurrency = parseConcurrency(flags.concurrency);

  if (!isCIMode) {
    printBanner();
  }

  // If no files specified, discover from git
  if (files.length === 0) {
    files = getConflictedFiles();
    if (files.length === 0) {
      if (isCIMode) {
        console.log(JSON.stringify({ version: "0.0.1", summary: { files: 0, totalConflicts: 0, autoResolved: 0, remaining: 0, allResolved: true }, files: [] }, null, 2));
        process.exit(0);
      }
      console.log(`${c.green}No conflicted files detected.${c.reset}`);
      return;
    }
    if (!isCIMode) {
      console.log(
        `${c.cyan}${files.length} conflicted file(s) detected${c.reset}\n`,
      );
    }
  }

  // Chaque fichier est traité concurremment par le pool, mais chaque worker
  // produit (a) son MergeResult et (b) les lignes non-CI à afficher. Les
  // résultats sont indexés par position dans `files`, donc l'ordre du rapport
  // JSON et de l'affichage utilisateur reste déterministe — indépendant de
  // l'ordre de complétion des workers.
  type FileOutcome = {
    file: string;
    result: MergeResult | null; // null = fichier introuvable
    printLines: string[];
  };

  // Note : on met `verbose: false` pour `resolve()` afin d'éviter les
  // `console.log` internes qui interleaveraient entre workers ; on ré-imprime
  // nous-mêmes un résumé plus riche (incluant `trace.summary`) en verbose.
  const outcomes = await runPool<string, FileOutcome>(files, concurrency, async (file) => {
    const filePath = resolvePath(file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return {
        file,
        result: null,
        printLines: isCIMode ? [] : [`${c.red}  \u2717 ${file} — file not found${c.reset}`],
      };
    }

    const result = resolve(content, file, {
      verbose: false,
      resolveWhitespace,
    });

    // Écriture sur disque (sauf dry-run). L'écriture est concurrente entre
    // fichiers distincts, mais chaque fichier n'a qu'un seul writer — il n'y
    // a donc pas de write-race possible tant que les chemins sont distincts.
    if (!flags["dry-run"] && result.stats.autoResolved > 0) {
      const newContent =
        result.mergedContent ?? buildPartialContent(content, result.resolutions);
      await writeFile(filePath, newContent, "utf-8");
    }

    const printLines: string[] = [];
    if (!isCIMode) {
      if (result.stats.totalConflicts === 0) {
        printLines.push(`${c.dim}  \u25CB ${file} — no conflicts${c.reset}`);
      } else {
        const icon = result.stats.remaining === 0 ? "\u2713" : "\u25D0";
        const color = result.stats.remaining === 0 ? c.green : c.yellow;

        printLines.push(
          `${color}  ${icon} ${file} — ${result.stats.autoResolved}/${result.stats.totalConflicts} resolved${c.reset}`,
        );

        if (verbose) {
          for (const res of result.resolutions) {
            const status = res.autoResolved
              ? `${c.green}auto${c.reset}`
              : `${c.red}manual${c.reset}`;
            printLines.push(
              `${c.dim}    L${res.hunk.startLine} [${res.hunk.type}] ${status} — ${res.hunk.explanation}${c.reset}`,
            );
            printLines.push(`${c.dim}      trace: ${res.hunk.trace.summary}${c.reset}`);
          }
        }
      }
    }

    return { file, result, printLines };
  });

  // Flush ordonné (ordre de `files`, pas ordre de complétion).
  if (!isCIMode) {
    for (const outcome of outcomes) {
      for (const line of outcome.printLines) {
        console.log(line);
      }
    }
  }

  const results: Array<{ file: string; result: MergeResult }> = [];
  let totalResolved = 0;
  let totalRemaining = 0;
  let totalConflicts = 0;
  for (const outcome of outcomes) {
    if (outcome.result === null) continue;
    results.push({ file: outcome.file, result: outcome.result });
    totalConflicts += outcome.result.stats.totalConflicts;
    totalResolved += outcome.result.stats.autoResolved;
    totalRemaining += outcome.result.stats.remaining;
  }

  // CI mode: JSON output
  if (isCIMode) {
    const report = buildCIReport(results);
    console.log(JSON.stringify(report, null, 2));

    if (report.summary.remaining > 0) {
      process.exit(1);
    }
    process.exit(0);
  }

  // Human-readable summary
  console.log(`\n${c.bold}\u2500\u2500\u2500 Summary \u2500\u2500\u2500${c.reset}`);
  console.log(
    `${c.bold}${WAND} ${totalResolved}${c.reset} conflict(s) auto-resolved out of ${c.bold}${totalConflicts}${c.reset}`,
  );

  if (totalRemaining > 0) {
    console.log(
      `${c.yellow}${totalRemaining} conflict(s) remaining — manual resolution needed${c.reset}`,
    );
  } else if (totalConflicts > 0) {
    console.log(
      `${c.green}${c.bold}All conflicts resolved! ${WAND}${c.reset}`,
    );
  }

  if (flags["dry-run"]) {
    console.log(`\n${c.dim}(dry-run — no files modified)${c.reset}`);
  }

  console.log();
}

/**
 * Command: status
 */
async function cmdStatus(flags: Record<string, boolean | string>) {
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

// ─── Main ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];

// Les flags supportent désormais `--key` (boolean) ET `--key=value` (string),
// le second étant requis pour `--concurrency=N`.
const flags: Record<string, boolean | string> = {};
const positional: string[] = [];

for (const arg of args.slice(1)) {
  if (arg.startsWith("--")) {
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      flags[body] = true;
    }
  } else {
    positional.push(arg);
  }
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "resolve") {
    await cmdResolve(positional, flags);
  } else if (command === "status") {
    await cmdStatus(flags);
  } else {
    console.error(`${c.red}Unknown command: ${command}${c.reset}`);
    printHelp();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${c.red}Fatal: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
  process.exit(2);
});
