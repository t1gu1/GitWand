# GitWand — Product Roadmap

> Client Git natif avec résolution intelligente des conflits — Desktop, CLI, VS Code, MCP.

---

## Vision

Devenir le client Git de référence qui combine la puissance visuelle de **Kaleidoscope** (comparaison de fichiers, images, dossiers), la simplicité workflow de **GitHub Desktop** (commit, push, pull, branches), et l'intelligence algorithmique unique de GitWand (résolution automatique de conflits) — le tout dans une app native cross-platform (Tauri 2 + Rust).

**Positionnement** : GitWand n'est pas "encore un Git GUI". C'est un client Git qui *comprend* le code, résout les conflits triviaux tout seul, et rend visuel ce que le terminal cache.

---

## Analyse concurrentielle

| Client | Stack | Prix | Forces | Faiblesses |
|--------|-------|------|--------|------------|
| **Kaleidoscope** | macOS natif | ~150€/an | Image diff, folder diff, 3-way merge visuel | macOS-only, pas de workflow Git, pas d'auto-resolve |
| **GitHub Desktop** | Electron | Gratuit | Simple, bon workflow PR, cherry-pick/rebase | Diff basique, résolution rudimentaire, lourd |
| **GitButler** | Tauri/Rust | Gratuit | Virtual branches, stacked PRs, IA intégrée | Nouveau paradigme déroutant, pas d'image/folder diff |
| **GitKraken** | Electron | $5/mois | Graph visuel, merge editor 3-way, Jira/Trello intégrés, Launchpad (PRs+issues cross-repo), Workspaces multi-repo cloud-synced, Cloud Patches, AI partout (commit/PR/merge), Agent Sessions View (Claude Code) | Payant, Electron, lourd, nécessite compte cloud pour les features avancées |
| **Fork** | Natif | $50 | Rapide, interface propre, gros repos | Pas d'auto-resolve, pas d'IA |
| **Tower** | Natif | $69/an | Undo puissant, conflict advisor | Payant, pas d'auto-resolve |
| **Sublime Merge** | Natif | $99 | Ultra-rapide, search puissant | Pas de PR workflow |

**GitWand vs GitButler** : GitButler réinvente le workflow (virtual branches), GitWand améliore le workflow existant avec de l'intelligence (auto-resolve, MCP, suggestions). Même stack Tauri/Rust, audiences complémentaires.

---

## Shipped

### v1.0.0 — Client Git complet + Code Review

Tout le socle d'un client Git quotidien, livré et testé.

**Core — Moteur de résolution**
- 8 patterns de résolution (same_change, one_side_change, delete_no_change, whitespace_only, non_overlapping, value_only_change, generated_file, complex) — LCS 3-way, diff2 + diff3
- Score de confiance composite (`ConfidenceScore` 0–100, dimensions, boosters/penalties)
- Résolveurs par format : JSON/JSONC sémantique, Markdown section-aware, YAML, Vue SFC, CSS/SCSS, TS/JS imports, lockfiles (npm/yarn/pnpm)
- Politiques configurables (`.gitwandrc`) : prefer-ours, prefer-theirs, prefer-safety, prefer-merge, strict — par projet et par glob
- DecisionTrace : trace pas-à-pas, mode explain-only
- Validation post-merge (marqueurs résiduels, syntaxe JSON)
- 332 tests, 20 fixtures corpus, benchmarks (249k ops/s sur 1 conflit)

**Desktop — Interface**
- Repository overview, staging/unstaging (fichier + ligne/hunk), commit (summary + description, Ctrl+Enter, signature)
- Push/pull avec badges ahead/behind, auto-fetch 30s
- Branches : liste locale/remote, création/suppression, switch, merge avec merge editor VS Code-style
- Diff avancé : side-by-side toggle, syntax highlighting (30+ langages), word-level LCS, minimap canvas, hunk navigation, collapse zones inchangées
- History/Log : vue chronologique, diff par commit, scroll-spy, collapse description
- DAG graph : visualisation branches SVG, layout lanes, ref badges
- File history + blame (`--porcelain`) + time-travel diff
- Merge preview : simulation zéro side-effect (merge-base + git show + merge-file -p --diff3)
- Conflict prevention : alerte proactive fichiers en commun entre branches
- Amend commit, cherry-pick (multi-sélection, continue/abort), stash manager
- PR workflow GitHub (créer/lister/checkout/merge via `gh` CLI)
- Repo switcher (récents, pin/unpin), multi-onglets (Cmd+T/W/1..9), monorepo awareness
- Terminal intégré (git-only, autocomplete branches/tags)
- i18n FR/EN type-safe, thème dark/light/system, Settings complet (13 paramètres câblés)
- Raccourci global Cmd+Shift+G / Ctrl+Shift+G

**Code Review intégré (Phase 9)**
- Liste PRs dans sidebar, détail dans zone principale (Info/Diff/CI/Intelligence)
- Commentaires inline : lecture, threads, création par sélection de ligne/plage, suggestions applicables
- Soumission de review : Approve / Request changes / Comment, brouillon accumulé
- Intelligence : conflict prediction (merge-tree), hotspot analysis, review scope, suggestions IA, historique review
- Suggestions IA multi-provider (Claude / OpenAI / Ollama) dans merge editor et review

**Infrastructure**
- CI/CD multi-OS (macOS universal, Linux, Windows)
- Auto-update Tauri updater
- VitePress documentation website

### v1.1.0 — LLM Integration

Ouverture de GitWand aux agents IA via MCP et enrichissement de la sortie CLI.

**MCP Server (`@gitwand/mcp`)**
- 5 tools : `gitwand_status`, `gitwand_resolve_conflicts`, `gitwand_preview_merge`, `gitwand_explain_hunk`, `gitwand_apply_resolution`
- 3 resources : `gitwand://repo/conflicts`, `gitwand://repo/policy`, `gitwand://hunk/{file}/{line}`
- Transport stdio, compatible Claude Code / Claude Desktop / Cursor / Windsurf
- Boucle human ↔ LLM : GitWand auto-resolve les triviaux → LLM résout les complexes via `pendingHunks`

**Claude Code slash commands**
- `/resolve` : workflow complet de résolution
- `/preview` : merge preview et risk assessment

**CLI enrichi**
- `--ci` / `--json` retourne un rapport structuré complet : confidence scores, decision traces, `pendingHunks` avec ours/theirs/base pour chaque hunk non résolu
- Validation post-résolution incluse dans le JSON

**Desktop — Améliorations UX**
- Résolution partielle : le bouton "Résoudre auto" applique les hunks résolvables même quand tous ne le sont pas (`buildPartialContent`)
- Modale de succès merge avec boutons Close (→ dashboard) et Push, thème light/dark via design tokens
- Dashboard : rendu README amélioré (parsing header HTML GitHub, tables GFM, checkboxes, ancres de navigation, gestion images relatives)
- Endpoint `/api/read-gitwandrc` ajouté au dev-server

**Website**
- Page MCP Server dans la documentation VitePress
- Homepage FR/EN avec toggle langue
- Footer mis à jour (2026 Devlint)

**Branding**
- Nouveau logo 3D hexagonal cube (remplace l'ancien magic wand)
- Icônes app Tauri regénérées (ico, icns, png multi-tailles)

### v1.2.0 — Interactive Rebase, Absorb, AI commits & Undo

Productivité du workflow quotidien : opérations Git avancées accessibles, IA dans la zone de commit, filet de sécurité universel.

**Rebase interactif (1.2.1)**
- Drag-and-drop dans le log pour réordonner les commits
- Actions par commit : squash, edit message, drop, fixup
- Squash multi-sélection avec message combiné
- Rebase sur branche depuis l'UI
- Gestion des conflits en cours de rebase (continue/abort/skip)

**Absorb (1.2.2, inspiré GitButler)**
- Clic droit sur fichier modifié → "Absorber dans un commit"
- Détection auto du commit candidat via `git blame`
- Absorb partiel (sélection de hunks) via `useAbsorb.ts`

**AI commit messages (1.2.3)**
- Menu déroulant IA dans la zone de commit → analyse du diff staged → summary + description
- Provider configurable : Claude Code CLI, Claude API, OpenAI-compatible, Ollama
- Régénérer, raccourcir, détailler, changer de langue

**Undo universel (1.2.4)**
- Stack d'opérations GitWand (commit, merge, rebase, cherry-pick, stash, discard…)
- Undo en un clic via `git reset` / `git reflog` selon le cas
- Panel d'historique des opérations avec retour à n'importe quel état

**Autres améliorations**
- Endpoint dev-server `gh-merge-pr` + wrapper TypeScript
- Website : section LLM/MCP et FAQ sur la homepage

### v1.3.0 — AI Everywhere

L'IA s'infuse dans chaque étape du workflow Git (réutilise `useAIProvider.rawPrompt()` et `@gitwand/mcp`). Chaque suggestion reste optionnelle, explicite, et traçable (prompt + provider visibles).

**1.3.1 — AI code review & PR**
- Description de PR auto-générée (`PrCreateView` → titre + body structurés à partir de `currentBranch..base`)
- Critique IA par hunk dans le panneau Review (feedback, risques, régressions, suggestions)
- Suggestion de nom de branche depuis description ou diff staged

**1.3.2 — AI conflict & merge insight**
- Explication de conflit en langage naturel dans le merge editor (traduction du `DecisionTrace`)
- Résumé IA du risque avant rebase/merge (complète la simulation `merge-tree`)
- Exposition desktop de `gitwand_explain_hunk` (MCP)

**1.3.3 — AI commit workflow**
- Message de stash auto depuis le diff unstaged (y compris flow switch-branch)
- Squash sémantique en rebase interactif (groupement par intention + message combiné)
- Classement IA pour Absorb (ranking sémantique quand les lignes couvrent plusieurs commits)

**1.3.4 — AI history & search**
- Recherche de commits en langage naturel dans le `CommitLog`
- Blame contextuel — "pourquoi cette ligne a changé ?" par bloc de blame
- Générateur de release notes / changelog depuis `git log <tag>..<tag>`

**1.3.5 — Tips tournants**
- Encart tip tournant sur la page d'accueil avant sélection de repo (~20 tips FR/EN, rotation 30 s)

### v1.4.0 — Pattern registry & auto-update

Refonte du moteur de classification et outillage desktop de distribution. Livré en même temps que la phase v1.3 dans la release `1.4.0`.

**Core — Pattern registry**
- Pipeline de classification réécrit autour d'un registre priorisé (`priority`, `requires: diff3 | diff2 | both`, `detect`, `confidence`, `explanation`)
- Nouveau résolveur **`reorder_only`** — permutations pures (mêmes lignes, ordre différent), auto-résolu
- Nouveau résolveur **`insertion_at_boundary`** — insertions pures des deux côtés, base intacte, auto-résolu
- Scoring de confiance affiné (boosters, pénalités, garde-fous renforcés sur `complex`)

**Desktop — Distribution**
- Vérification d'auto-update au lancement (GitHub Releases) avec toast + lien changelog
- Affichage de la version courante (footer / About)

**Branding**
- Favicon hex-cube partagé entre l'app desktop et le website

### v1.5.0 — Hardening, performance & English-first

Vague de durcissement : sécurité (XSS, CORS, path traversal), mémoire du moteur de diff, parallélisme côté app + CLI, validation post-merge étendue, et bascule du défaut de locale vers l'anglais. Aucun changement d'API publique — c'est une release de consolidation.

**Sécurité**
- Assainissement XSS sur 10 vues via un composable partagé `useSafeHtml` / `useMarkdown` (DOMPurify + markdown-it)
- Dev-server : CORS restreint et validation de chemin filesystem contre le path traversal

**Moteur — performance**
- LCS mémoire O(n·m) → O(min(n, m)) via approche hybride (Int32Array DP sous 4M cellules, Hirschberg au-dessus) — ~35× sur 3000×3000, tie-break inchangé
- Parallélisation de la lecture des conflits dans l'app (borné)
- Parallélisation de la boucle CLI `gitwand resolve` (borné)

**Extension utilisateur**
- Option `generatedFiles` dans `.gitwandrc` — globs additifs routés vers le résolveur `generated_file`
- Validation post-merge étendue aux formats YAML et TOML (erreurs préfixées `YAML: …` / `TOML: …`)

**Parité Rust ↔ Node**
- Harnais de tests de parité pour 3 commandes Tauri — détecte les dérives entre backend Rust et dev-server Node

**i18n**
- Locale par défaut basculée vers l'anglais (app desktop + website) ; le français reste auto-détecté et maintenu en parallèle

**Internals**
- Split de `resolver.ts` en 6 sous-modules (validation, policy, generated-detection, …)
- Split de `cli/index.ts` en sous-modules par commande
- Retrait de `@types/dompurify` (deprecated — DOMPurify 3.x fournit ses propres types)

### v1.5.1 — Release hotfix & macOS TCC

Patch de release correctif : ship le bundle universel macOS qui échouait au build, calme la boîte de dialogue de permissions macOS qui se déclenchait 50 fois, et termine la migration i18n des messages d'erreur dans les composables.

**CI release**
- `autobins = false` dans `apps/desktop/src-tauri/Cargo.toml` — empêche Cargo d'auto-découvrir `src/bin/parity_probe.rs` comme cible bin non gatée, ce qui brisait le `lipo -create` universel lorsque le binaire existait pour une seule architecture
- Rename `shortcut` → `_shortcut` dans la closure global-shortcut pour éteindre le warning clippy

**macOS TCC (Transparency, Consent, Control)**
- Guard `MACOS_TCC_PROTECTED` sur `list_dir` (Rust) et l'endpoint équivalent dans `dev-server.mjs` — skip le probe `.git` sur `Documents`, `Desktop`, `Downloads`, `Pictures`, `Movies`, `Music`, `Library` lors du listing du home ; ces dossiers ne sont jamais des repos git et leurs enfants déclenchaient TCC en boucle sur les builds ad-hoc non signés

**i18n**
- Migration des messages d'erreur des composables IA (`useCommitMessage`, `useBranchName`, `useReleaseNotes`, `useStashMessage`, `usePrDescription`, `useSquashSuggestion`, `usePrHunkCritique`, `useBlameContext`, `useMergeRisk`, `useCommitSearch`, `useHunkExplanation`, `useAIProvider`) vers le namespace `errors.*` déjà peuplé dans les 5 locales
- Export du helper `t` standalone depuis `useI18n` pour traduire depuis des modules non-composant

### v1.6.1 — Folder diff + MCP Registry & npm ✅

- Folder tree view in commit diff (flat ↔ tree toggle, per-folder aggregates, resizable sidebar, keyboard navigation)
- `@gitwand/mcp`, `@gitwand/cli`, `@gitwand/core` published on npm
- `io.github.devlint/gitwand` indexed on the official MCP Registry

### v1.6.2 — Image diff ✅

- Comparaison visuelle : side-by-side, overlay, blink, slider split
- Formats : PNG, JPEG, SVG, WebP, GIF
- Métadonnées (taille, dimensions, profil couleur), badge animated pour GIF
- Backend `read_file_at_revision` (Rust + dev-server + TS)

### v1.6.3 — Submodules & Worktrees ✅

- Worktree manager : créer, lister, supprimer — chaque worktree dans un onglet
- Checkout rapide via worktree : bouton ⧉ sur chaque branche, ouvre le manager pré-rempli
- Submodule panel : liste avec statuts, init & update, open-in-tab, add — banner warning si non-init
- Auto-update fixes : `createUpdaterArtifacts`, permissions capabilities, signatures réelles dans le manifest

### v1.7.0 — Split commit par hunks ✅

Premier jalon de l'alignement Git 2.54. Découpe d'un commit en deux via sélection ligne-à-ligne, intégré à l'interactive rebase.

**Split commit**
- Nouveau primitif backend `git_split_commit` (3 couches : Rust, dev-server, wrapper TS + composable `useSplitCommit`)
- Modale dédiée avec lignes repliées par défaut (résumé : chevron, nom court, chemin, +/−, hunks, sélection). Clic pour déplier. Sélection préservée au collapse/expand via prop `initialSelection` sur `DiffViewer`. Toolbar "Tout déplier / Tout replier" si > 3 fichiers
- Entrée "Split this commit…" dans le menu contextuel du log + action `split` dans l'interactive rebase (halt synthétique via `edit`, modale préchargée, reprise du rebase à la confirmation)

**Guards & correctness**
- Blocage des merge commits à toutes les entrées (Rust, dev-server, TS, App.vue, menu contextuel désactivé avec tooltip). Raison : `git reset --mixed HEAD^` sur un merge largue silencieusement le second parent et aplatit l'historique
- En-têtes de patch corrects pour fichiers ajoutés / supprimés / renommés (`GitDiff.status` + `oldPath` propagés depuis `git_show`, `patchBuilder` émet `new file mode` + `--- /dev/null`, `deleted file mode` + `+++ /dev/null`, ou `rename from/to`) — corrige `git apply --cached` qui échouait sur les créations/suppressions
- Types de retour rebase : nouveau flag `inProgress` authoritative pour "rebase en cours", `conflict` réservé strictement aux conflits de merge. L'éditeur ne se ferme plus par erreur sur un halt `edit` / `split` synthétique

**i18n**
- 6 clés pour le flux split (`errorMergeCommit`, `filesCount`, `expandAll`, `collapseAll`, `hunksCount`, `linesSelectedSuffix`) traduites dans les 5 locales (en, fr, es, pt-BR, zh-CN)

### v1.8.0 — Design system & modal foundations ✅

Refonte transverse du header et socle d'overlay partagé — prépare le terrain pour la suite de l'alignement Git 2.54 sans repayer la dette d'UI à chaque nouveau flux.

**AppHeader composable**
- `AppHeader.vue` (1654 lignes) découpé en briques sous `components/header/` : `SyncSplitButton`, `BranchSelector`, `BranchMenu`, `SearchTrigger`, `SearchPalette`, `RepoTabStrip` (remplace `RepoTabBar`), `HeaderLogo`, `BranchRenameModal`, `BranchDeleteModal`
- Composable `useSyncAction` + tests (transitions publish / push / pull / fetch / mergeRemote)
- Cmd/Ctrl+K command palette (branches, commits, quick actions)
- i18n des clés `syncAction`, `branchMenu`, `header.searchTooltip` dans les 5 locales (en, fr, es, pt-BR, zh-CN)

**BaseModal + AiSparkle**
- `BaseModal.vue` (367 lignes) : backdrop, focus trap, Esc-to-close, footers typés (primary/danger/ghost), specificity `.bm-btn` pinned à (0,1,0) pour que les modifiers restent composables
- `AiSparkle.vue` (77 lignes) : icône réutilisable pour les actions IA, remplace les SVG inline dispersés
- 10 modales migrées : `EditCommitOverlay`, `MergeSuccessModal`, `PrReviewModal`, `RebaseEditor`, `SettingsPanel`, `SplitCommitModal`, `StashManager`, `BranchRenameModal`, `BranchDeleteModal`, `SearchPalette`

**Backend : renommage de branches**
- Nouveau primitif `git_rename_branch` (Rust + dev-server + wrapper TS), exposé via `useGitRepo.renameBranch`
- Modale dédiée `BranchRenameModal.vue` remplaçant l'inline `rename()` dans `BranchMenu`
- `BranchDeleteModal.vue` avec type-the-name guard pour branches non-merged

**Merge editor — numéros de ligne + minimap**
- Numérotation par ligne sur les panneaux code et conflit
- Minimap canvas à droite : highlight auto-resolvable vs manual pour navigation rapide

**PR — description markdown + switch formatted/raw**
- `PrDetailView` rend la description en markdown complet (tables, code blocks, liens, blockquotes, images) via `renderMarkdown`
- Segmented pill switch "Formatted / Raw" aligné sur le widget readme du Dashboard
- Clés i18n `dashboard.formatted` / `dashboard.raw` dans les 5 locales

**PrIntelligencePanel — refonte**
- Icônes de section (emoji → tuile accent-soft 28px + SVG inline)
- Scope grid en `.pi-stat` cards (icône + label + valeur, radial hover gradient, lift)
- File rows / hotspot rows / AI flag rows unifiés avec `border-left: 3px solid` severity strip
- Banner conflit success/danger, bouton "Analyser" en CTA primaire
- Loading dot-spinner 10px, `@media (prefers-reduced-motion)` désactive transforms + spin

**PrCreateView — polish**
- Icon hero, segmented template pills, bouton AI accent, draft card mise en valeur
- Cohérence visuelle avec `PrDetailView`

**Sidebar & folder picker**
- `RepoSidebar.vue` : padding aéré, icon badges, hover lifts sur branches / activité / quick actions
- `FolderPicker.vue` : historique en chips pill (plutôt que liste verticale)

### v1.9.0 — Suite alignement Git 2.54 ✅

Reste de la veine Git 2.53 / 2.54 — wrapping de commande + UI, pas de changement de philosophie.

**Log — menu contextuel commit ✅**
- Checkout commit (détached HEAD, warning + modal)
- Reset to commit (sélecteur soft/mixed/hard, warning rouge sur --hard)
- Revert commit (non-destructif, merge commits via -m 1)
- Create branch here (git checkout -b \<name\> \<sha\>)
- Tag this commit (lightweight ou annoté)
- Cherry-pick onto current branch
- Amend / Split — HEAD only, guards sur merge commits
- Copy short SHA / Copy full SHA / Copy commit message
- View on GitHub / GitLab / Bitbucket
- 4 nouveaux backends 3-couches (Rust + dev-server + TS), `git_create_branch` étendu avec `start_point`
- 37 clés i18n en parité sur les 5 locales (en/fr/es/pt-BR/zh-CN)

**Trailers ✅**
- Toggles `Signed-off-by` / `Reviewed-by` dans le panneau de commit de la sidebar
- Signed-off-by auto-rempli depuis `git config user.name/email` (chargé eagerly au montage)
- Reviewed-by : checkbox + input texte libre
- Trailers injectés comme bloc séparé (ligne vide + trailers) dans `useGitRepo.commit(trailers)`
- `useCommitMessage.ts` : assouplissement de l'interdiction IA → les trailers restent sous contrôle de l'utilisateur

**Blame diff algorithm ✅**
- Sélecteur `histogram | patience | minimal | myers` dans Settings → onglet Git
- `git_blame` implémenté en Rust (était manquant — seulement dans dev-server), avec flag `--diff-algorithm=<algo>`
- `getGitBlame(cwd, path, algorithm)` mis à jour (backend.ts + dev-server)
- `FileHistoryViewer` lit le setting au moment du chargement du blame
- 3 nouvelles clés i18n × 5 locales

**File history line-range + pickaxe ✅**
- Barre de recherche pickaxe dans l'onglet Historique de `FileHistoryViewer` : mode `-S` (chaîne littérale) et `-G` (regex), résultats filtrés en temps réel
- Bouton 🕐 sur chaque bloc de lignes du blame → `git log -L <start>,<end>:<file>` — bascule automatiquement vers l'onglet Historique avec un bandeau "Historique des lignes X–Y"
- `git_file_log` implémenté en Rust (était manquant), + `git_file_log_pickaxe`, `git_file_log_range` — 3 backends 3-couches
- `displayedLog` computed consolidant les 3 sources (range > pickaxe > log complet)

**Status & forks (triangulaire) ✅**
- `GitStatus` étendu : `push_remote` + `ahead_push` calculés depuis `@{push}` quand il diffère de `@{upstream}`
- Badge "↑N fork" dans `SyncSplitButton` — visible uniquement quand push remote ≠ upstream
- Détection automatique : `git rev-parse --abbrev-ref @{push}` + `git rev-list --count <push_remote>..HEAD`
- Propagation : useGitRepo → App.vue → AppHeader → SyncSplitButton (props `pushRemote` / `aheadPushCount`)

**Tags ✅**
- Panneau "Tags" (bouton ◇ dans la sidebar) : liste locale triée semver, badges annoté/léger, date relative, hash court
- Actions par tag au hover : push vers remote, suppression locale (avec option de supprimer aussi sur remote — confirmation modale)
- "Push all tags" en un clic via `--tags`
- Ref badges branch/tag/remote dans la vue Log list (en plus du DAG) — amber pour les tags, violet pour les branches
- AI tag suggestion : bouton ✦ dans le modal de création → analyse commits depuis le dernier tag, suggère le prochain bump semver + message annoté en une ligne (`useTagSuggestion.ts`)
- Backends 3-couches : `git_list_tags`, `git_delete_tag`, `git_push_tags`, `git_delete_remote_tag`

**Release automation — MCP Registry ✅**
- Job `publish-mcp-registry` ajouté à `publish.yml` : déclenché sur tag `v*.*.*`, après `publish` + `smoke-test`
- Installe `mcp-publisher` via binaire pré-compilé (pas de brew requis sur ubuntu-latest)
- Poll npm jusqu'à 12 min pour garantir la propagation avant de publier sur le registry
- Auth via `secrets.MCP_PUBLISHER_TOKEN` (PAT `read:user`, doc mise à jour dans PUBLISH-TO-REGISTRY.md)

**Commit prefixes — Conventional Commits ✅**
- Chips `feat · fix · docs · chore · refactor · test · style · perf · ci` au-dessus du summary input
- Clic → injecte le préfixe (`feat: …`) et remplace l'existant ; re-clic → retire le préfixe
- `activePrefix` computed détecte le préfixe en temps réel (compatible avec les messages générés par l'IA)

**Post-merge branch cleanup ✅**
- `MergeSuccessModal` propose "Supprimer «branche»" après un merge réussi
- Checkbox "Supprimer aussi sur le remote" → `git push <remote> --delete <branch>`
- `lastMergedBranch` capturé dans `mergeBranch()` et passé en prop au modal

---

## Next — v2.0.0 — Distribution & polish

Fondations cross-platform et quick wins UI avant d'attaquer les grosses features.

**Clone & Fork depuis l'UI**

Deux points d'entrée pour récupérer un repo sans passer par le terminal :

- **Écran d'accueil** : boutons "Clone from URL" et "Fork on GitHub" à côté du bouton "Open folder" existant — visibles au premier lancement, naturels pour les nouveaux utilisateurs
- **Tab strip `+`** : le bouton d'ouverture d'onglet devient un dropdown avec trois options : `📂 Open folder / ⬇ Clone from URL / ⑂ Fork on GitHub`
- Clone : saisie d'URL git (HTTPS ou SSH), sélection du dossier de destination, `git clone` avec barre de progression
- Fork : ouvre le repo GitHub dans le browser via `gh repo fork <url> --clone`, puis ouvre automatiquement le dossier dans GitWand avec le remote upstream configuré

**AI providers — Codex CLI, Gemini CLI & MCP compatibility matrix**

- **Codex CLI** (`codex -q "<prompt>"`) ajouté comme provider subprocess dans `useAIProvider.ts`, au même titre que Claude Code CLI — option dans Settings > AI
- **Gemini CLI** (`gemini`) idem, dès stabilisation du mode non-interactif Google
- Le provider "OpenAI-compatible" existant couvre déjà l'API OpenAI directe (`gpt-4o`, `o3`…) — pas de changement nécessaire de ce côté
- **MCP compatibility matrix** : tester et documenter officiellement Cursor, Windsurf, Codex CLI (dès support MCP) ; adapter l'Agent Sessions panel (v2.2) pour détecter tous ces clients, pas uniquement Claude Code

**Distribution & signing**
- ✅ Signature macOS (Developer ID + notarization Apple) — v1.9.0
- Signature Windows (Authenticode)
- Auto-update channel (stable / beta)
- Homebrew cask, winget, Flatpak

**Barre de menu macOS native ✅**

Menus File / Edit / Repository / View / Window / Help construits côté JS via `@tauri-apps/api/menu` — labels tirés de `useI18n()`, rebuild atomique sur changement de locale ou ouverture/fermeture de repo. Composable `useAppMenu.ts`, gating macOS via `navigator.platform`. 22 clés `menu.*` × 5 locales. No-op sur Linux/Windows (l'`AppHeader` porte la chrome ailleurs).

- **GitWand (app menu) ✅** : About, Settings… `⌘,`, Services, Hide / Hide Others / Show All, Quit (predefined macOS items + Settings custom)
- **File ✅** : Open Repository… `⌘O`, Open Recent (sous-menu peuplé depuis `useFolderHistory`, max 10 + Clear), Close Window `⌘W` (close active tab — sémantique GitWand, pas l'OS window)
- **Edit ✅** : Cut `⌘X`, Copy `⌘C`, Paste `⌘V`, Select All `⌘A` — predefined items, routent vers le first-responder natif. Cmd+Z laissé webview-default pour préserver le text-undo dans les inputs.
- **Repository ✅** _(disabled si pas de repo ouvert)_ : Fetch `⌘⇧F`, Pull, Push `⌘P`, New Branch… `⌘⇧B` (provide/inject bridge `BRANCH_CREATE_REQUEST_KEY` → ouvre le popover + le formulaire inline de `BranchSelector`, autofocus natif sur l'input), Open on GitHub / GitLab / Bitbucket (auto-détection via `gitRemoteInfo`)
- **View ✅** : Toggle Light/Dark Mode `⌘⇧T`, Enter Full Screen `⌃⌘F` (predefined)
- **Window ✅** : Minimize `⌘M`, Zoom, + window list auto via `setAsWindowsMenuForNSApp()`
- **Help ✅** : GitWand Documentation (gitwand.devlint.fr), What's New (GitHub Releases), Report an Issue (GitHub Issues), Check for Updates… (branché sur `runUpdateCheck()`). Search box auto via `setAsHelpMenuForNSApp()`.

_Différés (autre chantier ou infra manquante)_ :
- Clone… / Fork… → autre chantier de v2.0.0
- Undo/Redo sur l'undo stack → conflit sémantique avec le text-undo natif de Cmd+Z dans les inputs ; à reprendre avec un raccourci dédié
- Find in Log `⌘F` → pas de handler Cmd+F dans l'app
- Merge… → contextuel à la branche, mieux servi par le `BranchMenu`
- Open in Terminal `⌘⇧T` → terminal intégré non exposé comme action callable
- Toggle Sidebar → sidebar layout-driven par `hasRepo`, pas de state de visibilité indépendant

**Dashboard — Contributors amélioré**
- **Stats globales** : remplacer `git log --max-count=250` par `git shortlog -sne HEAD` pour avoir les totaux sur tout l'historique, pas seulement la fenêtre récente
- **Tous les contributeurs** : supprimer le `slice(0, 4)` actuel — afficher tous les auteurs triés par nombre de commits
- **Layout horizontal scrollable** : passer la zone contributors en `flex-row` avec `overflow-x: auto` et `scroll-snap-type: x mandatory` — chaque carte fait ~33% de la largeur visible pour indiquer qu'il y a du contenu à droite
- **Compact** : réduire la hauteur de chaque carte (avatar + nom + count + barre en une ligne dense)

---

## v2.x — Roadmap

> Pivot vers le multi-repo et l'écosystème agents. Chaque jalon est livrable indépendamment.

---

### v2.1.0 — Workspaces + Hooks manager

Fondations multi-repo (prérequis pour le Launchpad) et pouvoir utilisateur avancé.

**Workspaces multi-repo (local)**

Version locale du concept GitKraken Workspaces — sans cloud, sans compte, juste un fichier `.gitwand-workspace.json` commitable.

- Grouper plusieurs repos dans un workspace nommé (par projet, par client, par squad)
- **Actions groupées** : fetch all, pull all, status all en un clic
- Ouvrir tous les repos du workspace d'un coup dans des onglets GitWand
- Launchpad filtré par workspace (prépare v2.3)

**Hooks manager**

- Panneau "Hooks" : liste (`git hook list`), enable / disable (`hook.<name>.enabled`)
- Création de hooks en config (format `[hook "name"] event/command` Git 2.54), avec multiple hooks par event
- Partage cross-repo via `~/.gitconfig` (vs copie dans chaque `$GIT_DIR/hooks`)
- Cohérent avec la philosophie "rendre visuel ce que le terminal cache"

---

### v2.2.0 — Agent Sessions View

Réponse directe au lancement GitKraken d'avril 2026 — GitWand peut aller plus loin grâce à `@gitwand/mcp` déjà indexé sur le MCP Registry officiel.

- **Panel "Agents"** dans la sidebar : liste les sessions MCP actives (Claude Code, Cursor, Windsurf…) travaillant sur les worktrees du repo courant
- Chaque carte : worktree associé, branche, statut (ahead/behind, uncommitted changes), outil agent détecté
- **Intégration worktree** : ouvrir le worktree d'un agent en un clic dans un onglet GitWand — voir son diff en live
- **Lancer une session** : raccourci pour démarrer Claude Code (`claude`) sur un worktree vierge depuis GitWand directement
- Complète le MCP server existant : les agents voient GitWand, GitWand voit les agents

---

### v2.3.0 — Launchpad

_Dépend de v2.1.0 (Workspaces)._ Inspiré du Launchpad GitKraken, mais local-first (pas de cloud requis) : tableau de bord unique agrégeant PRs, issues et WIPs sur tous les repos du workspace.

- **PRs cross-repo** : liste unifiée de toutes les PRs ouvertes sur les repos dans le workspace (via `gh` CLI), avec statuts CI, reviewers, labels — sans ouvrir chaque repo un par un
- **Issues cross-repo** : GitHub Issues agrégées (filtres : assignées à moi, mentionné, créées par moi)
- **WIP panel** : liste des repos avec des changements non commités ou branches en retard — une vue "qu'est-ce qui m'attend" en un coup d'œil
- **Pin / snooze** : épingler une PR importante en haut, snoozer une issue pour la semaine prochaine
- **Vue Équipe** (optionnelle) : ce que les autres font sur les mêmes repos (via l'API GitHub), pour détecter les chevauchements avant qu'ils deviennent des conflits

---

### v2.4.0 — Intégrations forge

Ouvre GitWand aux utilisateurs non-GitHub.

- GitLab MRs : API REST/GraphQL native (lister, reviewer, merger)
- Bitbucket PRs : Support Bitbucket Cloud
- Multi-compte GitHub/GitLab (personnel + pro)
- Draft PR convert depuis l'app

---

### v2.5.0 — Performance à grande échelle

- Partial clone / sparse checkout pour monorepos massifs — hydratation à la demande via `git backfill <rev> <pathspec>` (scope par range de commits + pathspec wildcards, praticable depuis 2.54)
- Pagination lazy du log sur repos 100k+ commits
- Background indexing pour la recherche dans les commits

---

### v2.6.0 — Voice Input (expérimental)

Inspiré de Gitux, mais intégré au pipeline IA GitWand existant plutôt qu'en silo.

- **Dictée locale** : bouton microphone dans le panneau de commit, capture audio → transcription via un modèle Whisper embarqué (whisper-rs côté Rust) — zéro cloud, zéro réseau
- **Enrichissement IA optionnel** : après transcription, proposer de passer le texte dicté dans `useAIProvider` pour correction grammaticale / conventional commit formatting — GitWand fait mieux que Gitux sur ce point
- **Modèles au choix** : `tiny` (rapide, léger) ou `base` (meilleure précision) téléchargés à la demande via Settings, stockés localement
- **Multilingue** : Whisper détecte automatiquement la langue — utile pour les équipes mixtes FR/EN
- **Fallback gracieux** : si l'accès micro est refusé par macOS TCC, message d'erreur clair avec lien vers Préférences système

---

## Principes de design

1. **Intelligence d'abord** — Chaque écran doit apporter plus que le terminal. Si l'UI ne fait que wrapper `git status`, elle ne sert à rien.
2. **Performance native** — Tauri 2 + Rust. Démarrage < 1s, fluide sur 100k+ commits.
3. **Progressif** — Fonctionne immédiatement pour les cas simples. Les features avancées se découvrent naturellement.
4. **Cross-platform** — macOS, Linux, Windows. Même qualité partout.
5. **Gratuit et open-source** — Core et desktop MIT. Possible freemium team/pro plus tard.

---

## Dépendances techniques

| Feature | Dépendance |
|---------|------------|
| Résolveurs par format | Parseurs légers : `JSON.parse`, YAML, imports TS/JS, PostCSS |
| Image diff | Canvas API frontend + lib Rust pixel diff |
| MCP Server | `@modelcontextprotocol/sdk`, transport stdio |
| PR workflow | `gh` CLI (GitHub), API REST/GraphQL (GitLab/Bitbucket) |
| Suggestions IA | `useAIProvider.ts` — Claude API, OpenAI-compatible, Ollama |
| Terminal intégré | Commande Rust `git_exec` sécurisée |
| Auto-update | `tauri-plugin-updater` + GitHub Releases |
| i18n | Système maison : locales TypeScript typées + `useI18n()` |

---

## Sources

- [Kaleidoscope — Git Diff and Merge Tool](https://kaleidoscope.app/)
- [GitHub Desktop — About](https://docs.github.com/en/desktop/overview/about-github-desktop)
- [GitButler — Virtual Branches & Stacked PRs](https://docs.gitbutler.com/)
- [Git Tower — Release notes](https://www.git-tower.com/release-notes)
- [Best Git GUI Clients 2026](https://lithiumgit.com/most-popular-git-gui-clients)
- [GitKraken Desktop Features](https://www.gitkraken.com/git-client)
- [GitKraken Launchpad](https://www.gitkraken.com/features/launchpad)
- [GitKraken Workspaces](https://www.gitkraken.com/features/workspaces)
- [GitKraken Conflict Prevention](https://help.gitkraken.com/gitkraken-desktop/conflict-prevention/)
- [GitKraken Agent Sessions View — avril 2026](https://help.gitkraken.com/gitkraken-desktop/experimental-features/)
