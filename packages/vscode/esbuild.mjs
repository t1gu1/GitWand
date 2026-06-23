// Bundles the extension into a single self-contained CommonJS file.
//
// Why a bundler (not plain tsc): the extension imports `@gitwand/core`, a
// workspace package. `tsc` emits `require("@gitwand/core")` but the VSIX ships
// with `--no-dependencies` and `.vscodeignore` excludes `node_modules`, so a
// tsc-only build produces an extension that throws "Cannot find module
// '@gitwand/core'" on activation. esbuild inlines core into dist/extension.js
// so the published extension is self-contained. `vscode` stays external — it
// is provided by the editor host at runtime.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: false,
  minify: false,
  // `@gitwand/core` is authored as ESM and a Node-only parser adapter reads
  // `import.meta.url`. In a CJS bundle that expression is invalid, so map it to
  // a CJS-safe equivalent (the documented esbuild shim) — correct even if that
  // code path is ever pulled in instead of tree-shaken away.
  banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': 'import_meta_url' },
  logLevel: 'info',
})
