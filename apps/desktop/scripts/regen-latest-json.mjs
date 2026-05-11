#!/usr/bin/env node
// Regenerate latest.json for a GitHub Release by reading every asset's
// matching .sig and building a fresh updater manifest. Used to recover
// from a tauri-action matrix race condition where parallel matrix jobs
// overwrite each other's latest.json on the release, leaving only the
// last writer's platform entries.
//
// Usage:
//   node apps/desktop/scripts/regen-latest-json.mjs v2.8.2 [--write]
//
// Without --write the script prints the JSON to stdout (dry-run).
// With --write it uploads latest.json back to the release via `gh`.
//
// Requires: `gh` CLI authenticated, `curl`, write access to the release.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAG = process.argv[2];
const WRITE = process.argv.includes("--write");
const REPO = process.env.REPO || "devlint/GitWand";

if (!TAG) {
  console.error("Usage: regen-latest-json.mjs <tag> [--write]");
  process.exit(2);
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();

// 1. Fetch the release's asset list
const assets = JSON.parse(
  sh("gh", ["release", "view", TAG, "--repo", REPO, "--json", "assets"]),
).assets;
const assetByName = Object.fromEntries(assets.map((a) => [a.name, a]));

// 2. Map of platform key → (artifact filename pattern, sig filename pattern)
//    Aligned with what tauri-action emits for Tauri 2.
const VERSION = TAG.replace(/^v/, "");
const PLATFORMS = [
  // macOS
  {
    key: "darwin-aarch64",
    artifact: `GitWand_${VERSION}_aarch64.app.tar.gz`,
    fallback: `GitWand_${VERSION}_aarch64.dmg`,
  },
  {
    key: "darwin-x86_64",
    artifact: `GitWand_${VERSION}_x64.app.tar.gz`,
    fallback: `GitWand_${VERSION}_x64.dmg`,
  },
  // Linux
  {
    key: "linux-x86_64",
    artifact: `gitwand-desktop_${VERSION}_amd64.AppImage`,
  },
  // Windows — prefer NSIS (updaterJsonPreferNsis: true in release.yml)
  {
    key: "windows-x86_64",
    artifact: `GitWand_${VERSION}_x64-setup.exe`,
    fallback: `GitWand_${VERSION}_x64_en-US.msi`,
  },
  {
    key: "windows-x86_64-nsis",
    artifact: `GitWand_${VERSION}_x64-setup.exe`,
  },
  {
    key: "windows-x86_64-msi",
    artifact: `GitWand_${VERSION}_x64_en-US.msi`,
  },
];

const tmp = mkdtempSync(join(tmpdir(), "regen-latest-"));
const platforms = {};

for (const p of PLATFORMS) {
  const name = assetByName[p.artifact] ? p.artifact : (p.fallback && assetByName[p.fallback] ? p.fallback : null);
  if (!name) {
    console.error(`⚠ ${p.key}: no matching asset found, skipping`);
    continue;
  }
  const sigName = `${name}.sig`;
  if (!assetByName[sigName]) {
    console.error(`⚠ ${p.key}: ${name} has no .sig, skipping (artifact not updater-enabled?)`);
    continue;
  }

  // Download the .sig — its content (base64) is the signature field
  const sigPath = join(tmp, sigName);
  sh("gh", ["release", "download", TAG, "--repo", REPO, "--pattern", sigName, "--output", sigPath, "--clobber"]);
  const signature = readFileSync(sigPath, "utf8").trim();
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${name}`;
  platforms[p.key] = { signature, url };
  console.error(`✓ ${p.key} → ${name}`);
}

const manifest = {
  version: VERSION,
  notes: `## GitWand ${TAG}\n\nSee the [changelog](https://github.com/${REPO}/commits/${TAG}) for details.`,
  pub_date: new Date().toISOString(),
  platforms,
};

const json = JSON.stringify(manifest, null, 2);

if (WRITE) {
  const outPath = join(tmp, "latest.json");
  writeFileSync(outPath, json);
  sh("gh", ["release", "upload", TAG, outPath, "--repo", REPO, "--clobber"]);
  console.error(`✓ uploaded latest.json to ${TAG} (${Object.keys(platforms).length} platforms)`);
} else {
  process.stdout.write(json + "\n");
  console.error(`\n(dry-run — pass --write to upload back to the release)`);
}
