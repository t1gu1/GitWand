@../../CLAUDE.md

# packages/cli — @gitwand/cli

CLI Node.js publié sur npm. Thin wrapper autour de `@gitwand/core` — toute logique de résolution reste dans `core`, le CLI ne fait que présenter les résultats.

## Architecture

```
src/
├── index.ts        # Entry point (binaire npm)
├── cli.ts          # Enregistrement des commandes (commander)
├── commands/       # Commandes individuelles
├── reporting.ts    # Formatage de sortie (JSON, table, couleurs)
├── git.ts          # Wrapper git pour le CLI
├── concurrency.ts  # Traitement parallèle de fichiers
├── partial-content.ts
└── ui.ts           # Terminal UI
```

**Commandes disponibles :**
- `resolve` — Résolution de conflits (fichier ou repo entier)
- `status` — État des conflits avec confidence scores
- `report` — Rapport de résolution

**Output formats :**
- Table colorée — pour usage terminal interactif
- JSON (`--json`) — pour CI/CD et intégration machine

## Règles de développement

- Les nouvelles commandes vont dans `commands/` — un fichier par commande
- Enregistrer chaque commande dans `cli.ts`
- Toute commande doit supporter `--json` pour output machine-readable
- Ne jamais écrire de logique de résolution dans le CLI — tout passe par `@gitwand/core`
- Utiliser `concurrency.ts` pour tout traitement de plusieurs fichiers — pas de boucle `for` séquentielle

## Build & test

```bash
pnpm build    # TypeScript → dist/
pnpm test     # Tests unitaires
```

## Exit codes

| Code | Signification          |
|------|------------------------|
| `0`  | Succès                 |
| `1`  | Conflits restants      |
| `2`  | Erreur                 |

## Publication

- Publié sur npm via `.github/workflows/publish.yml`
- Version synchronisée avec `packages/core` et `packages/mcp`
- Toujours utiliser `./scripts/bump-version.sh X.Y.Z` depuis la racine — jamais éditer les versions à la main

## Intégration CI/CD

```yaml
- name: Check conflicts
  run: npx @gitwand/cli status --json
  # Exit 0 = OK, exit 1 = conflits restants, exit 2 = erreur
```
