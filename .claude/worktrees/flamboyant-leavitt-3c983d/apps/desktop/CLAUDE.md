@../../CLAUDE.md

# apps/desktop — Tauri 2 + Vue 3

Application desktop GitWand. Combine un frontend Vue 3 (Vite 6) et un backend Rust (Tauri 2). Supporte un mode "web only" pour développer sans Rust.

## Commandes de développement

**Mode web (sans Rust) :**
```bash
pnpm dev:web    # Lance dev-server.mjs + Vite sur localhost:1420, mock backend
pnpm dev:server # Lance uniquement le backend de dev (dev-server.mjs)
```

**Mode desktop complet (Rust requis) :**
```bash
pnpm dev        # Copy grammars + Vite dev server (Tauri window en dehors)
```

**Build :**
```bash
pnpm build          # Copy grammars + vue-tsc + vite build → dist/
pnpm tauri build    # Build app complète, embed frontend dans le binaire Rust
```

**Tests :**
```bash
pnpm test           # Vitest (jsdom), src/**/*.test.ts
pnpm test:parity    # Test parité Rust↔JS via parity-probe (vitest.config.parity.ts)
```

## Règle CRITIQUE — Binaires Tauri

`tauri-bundler` bundle automatiquement **tous** les `[[bin]]` dans l'installeur. Les binaires secondaires **doivent** être déclarés sous `[[example]]` dans `src-tauri/Cargo.toml`.

```toml
# Correct
[[example]]
name = "parity-probe"
required-features = ["parity"]

# Ne jamais faire ca
[[bin]]
name = "parity-probe"
```

## Parity Probe

`src-tauri/examples/parity-probe.rs` reproduit en Rust la logique de résolution de conflits de `packages/core`. Permet de vérifier que les deux implémentations donnent des résultats identiques.

```bash
pnpm test:parity
# Exécute vitest.config.parity.ts — lance le binaire Rust + le JS, compare les sorties
```

## Configuration Tauri

- `tauri.conf.json` — Fenêtre, plugins, updater endpoints, bundle icons
- Updater : `https://gitwand.devlint.fr/update/latest.json` (primary) + GitHub releases (fallback)
- `capabilities/` — Permissions Tauri. Ne pas ajouter `shell:allow-execute` sans raison précise.

## Plugins Tauri actifs

| Plugin | Usage |
|---|---|
| `tauri-plugin-dialog` | File/folder pickers |
| `tauri-plugin-shell` | Exécution de commandes externes (gh, éditeurs) |
| `tauri-plugin-global-shortcut` | Raccourcis clavier globaux |
| `tauri-plugin-updater` | Auto-updates |
| `tauri-plugin-process` | Gestion des processus |

## Architecture IPC

Toutes les commandes Rust sont déclarées via `#[tauri::command]` dans `src-tauri/src/lib.rs` (~800 lignes). Leurs wrappers TypeScript typés sont dans `src/utils/backend.ts`.

Quand on ajoute une commande Rust, le wrapper TS correspondant doit être ajouté dans la **même PR**.

## Tests Vitest

- Config principale : `vite.config.ts` (environnement `jsdom`)
- Config parité : `vitest.config.parity.ts`
- Fichiers de test : `src/**/*.test.ts` et `src/**/__tests__/`
- Ne pas mocker les commandes Tauri dans les tests unitaires — utiliser `pnpm dev:web` avec le mock backend pour le dev interactif
