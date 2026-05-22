#!/usr/bin/env node
/**
 * Bundle size budget check (P6.1 / P4.1).
 *
 * Runs after `pnpm build` to validate that the Vite output respects the
 * size budgets we set. Fails (exit 1) if any chunk blows past its limit.
 *
 * Why: §1.2 (lazy panels) and §4.3 (lazy highlight.js languages) are
 * easy to undo by accident in a hurry — someone re-imports a panel
 * eagerly to fix a bug, or registers a new highlight.js language at
 * the top of the file. This check catches the regression before merge.
 *
 * Usage:
 *   pnpm build
 *   node perf/bundle-check.mjs
 */

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist", "assets");

// Budgets are in raw KB (un-gzipped). Vite emits raw + brotli/gzip in
// modern setups; we measure raw because it's what the parser+JIT have
// to chew through at boot. Targets sized to leave some headroom.
const BUDGETS = {
  // Main bundle budget history:
  //   v2.8.2  §1.2 lazy panels  → ~600 KB  (budget set to 700)
  //   v2.9.0  Launchpad         → ~900 KB  (+300 KB composables + workspace commands)
  //   v2.10.0 Forge integrations → ~1140 KB  (+240 KB GitLab/Bitbucket providers)
  //   v2.10.0 fix (this PR)     → ~1140 KB  providers now lazy chunks (1.89 KB + 2.05 KB)
  //
  // Root cause of the gap: `backend.ts` (4000+ lines, all IPC wrappers) is
  // statically imported by App.vue AND by every lazy component, so Vite
  // cannot move it out of the main chunk. Splitting backend.ts into
  // per-domain modules (backend-git, backend-pr, backend-ai…) is tracked
  // as a v2.11 perf task.
  //
  // Raise to 1250 until backend.ts is split. Do NOT raise further.
  main_max_kb: 1250,

  // Largest chunk other than main — usually a panel or vendor chunk.
  // If > 500 KB, time to investigate (typically means a vendor lib leaked
  // into a feature chunk).
  any_chunk_max_kb: 500,

  // Total assets — a sanity bound. If > 5 MB raw something is very wrong
  // (e.g. monaco/wasm bundled by accident).
  total_max_kb: 5_000,
};

if (!safeStatDir(DIST)) {
  console.error(`No dist/assets/ at ${DIST}. Run \`pnpm build\` first.`);
  process.exit(2);
}

const files = readdirSync(DIST)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const full = join(DIST, f);
    const sz = statSync(full).size;
    return { name: f, size: sz, kb: Math.round(sz / 1024) };
  })
  .sort((a, b) => b.size - a.size);

console.log("\nVite chunks (largest first):\n");
console.log("  Size      File");
for (const f of files) {
  console.log(`  ${String(f.kb).padStart(6)} KB  ${f.name}`);
}

const total = files.reduce((acc, f) => acc + f.kb, 0);
const main = files.find((f) => /^index-[a-z0-9_-]+\.js$/i.test(f.name)) || files[0];
const otherMax = files.filter((f) => f !== main).reduce((max, f) => Math.max(max, f.kb), 0);

console.log(`\nTotal:    ${total} KB`);
console.log(`Main:     ${main?.name || "?"} = ${main?.kb || 0} KB (budget ${BUDGETS.main_max_kb} KB)`);
console.log(`Largest other chunk: ${otherMax} KB (budget ${BUDGETS.any_chunk_max_kb} KB)`);

let failed = false;
if (main && main.kb > BUDGETS.main_max_kb) {
  console.error(`\nFAIL: main bundle ${main.kb} KB exceeds budget ${BUDGETS.main_max_kb} KB.`);
  console.error(`Likely cause: a panel/modal that should be lazy-loaded was imported eagerly.`);
  console.error(`Check apps/desktop/src/App.vue — look for new \`import X from "./components/...vue"\` lines.`);
  failed = true;
}
if (otherMax > BUDGETS.any_chunk_max_kb) {
  console.error(`\nFAIL: a non-main chunk reached ${otherMax} KB, exceeds ${BUDGETS.any_chunk_max_kb} KB.`);
  console.error(`Likely cause: a vendor lib (lucide, monaco, shiki…) leaked into a feature chunk.`);
  failed = true;
}
if (total > BUDGETS.total_max_kb) {
  console.error(`\nFAIL: total assets ${total} KB exceeds ${BUDGETS.total_max_kb} KB.`);
  failed = true;
}

if (failed) process.exit(1);

console.log("\nAll budgets OK ✓");

function safeStatDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
