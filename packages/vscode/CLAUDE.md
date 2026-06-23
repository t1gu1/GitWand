@../../CLAUDE.md

# packages/vscode — Extension VS Code GitWand

Extension VS Code intégrant GitWand dans le panneau Source Control. Versioning indépendant des packages npm.

## Architecture

```
src/
├── extension.ts    # Entry point (activate/deactivate)
├── scm.ts          # SCM provider (Source Control Manager)
├── commands.ts     # Commandes VS Code
├── config.ts       # Lecture de la configuration utilisateur
└── ui.ts           # Status bar, notifications
```

- Enregistre un SCM provider — visible dans le panneau "Source Control" de VS Code
- Utilise `@gitwand/core` en TypeScript pur — aucune dépendance vers `apps/desktop`
- Pas d'appel shell — tout passe par l'API `@gitwand/core`

**Commandes VS Code :**
- `gitwand.resolveFile` — Résoudre les conflits du fichier courant
- `gitwand.resolveAll` — Résoudre tous les conflits du repo
- `gitwand.showStatus` — Afficher l'état des conflits

## Configuration utilisateur

| Setting | Type | Défaut | Description |
|---------|------|--------|-------------|
| `gitwand.confidenceThreshold` | `number` | `0.7` | Seuil de confiance minimum pour la résolution automatique |
| `gitwand.autoResolve` | `boolean` | `false` | Résolution automatique à la sauvegarde |

## Règles de développement

- Toute nouvelle commande doit être déclarée dans `package.json` sous `contributes.commands`
- Les settings doivent être déclarés dans `contributes.configuration`
- Utiliser `vscode.workspace.fs` pour les fichiers — jamais `fs` Node.js (compatibilité remote workspaces)
- Ne jamais appeler de commandes shell — uniquement `@gitwand/core` en TypeScript pur

## Versioning indépendant

- Version `1.2.0` dans `packages/vscode/package.json`, indépendante des packages npm
- Ne pas utiliser `bump-version.sh` pour cette extension
- Versionner manuellement ou avec `vsce version`

## Build & test

```bash
pnpm typecheck      # tsc --noEmit (vérification de types)
pnpm build          # Bundle esbuild → dist/extension.js (inline @gitwand/core)
pnpm package        # Build + .vsix (via vsce, --no-dependencies)
```

L'extension est **bundlée avec esbuild** (`esbuild.mjs`), pas un simple `tsc` :
`@gitwand/core` (workspace) est inliné dans `dist/extension.js`. Le VSIX étant
packagé avec `--no-dependencies` et `node_modules/` exclu via `.vscodeignore`,
un build `tsc` seul produirait un `require("@gitwand/core")` introuvable au
runtime. Construire `@gitwand/core` avant l'extension (le bundle résout son
`dist/`).

## Publication

- Publiée sur le VS Code Marketplace — séparément du reste du monorepo
- Workflow CI : `.github/workflows/publish-vscode.yml` — push d'un tag
  `vscode-v*` (ou `workflow_dispatch`) → `vsce publish`
- Credential : Personal Access Token VS Code Marketplace (secret `VSCE_PAT` dans GitHub Actions)
