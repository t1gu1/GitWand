# Plan v1.6 — GitWand

**Cible de release** : fin mai 2026 (≈4 semaines)
**Version précédente** : 1.5.1 (shipped)
**Auteur** : Laurent Guitton
**Statut** : plan validé, specs détaillées en cours

---

## Vision de la release

v1.6 est la release "**distribution + visibilité**" de GitWand :

1. **Distribuer** GitWand via le MCP Registry et npm pour toucher l'écosystème des agents IA (Claude, Cursor, Windsurf).
2. **Différencier** GitWand de GitHub Desktop / Fork / Sourcetree avec un *image diff* de classe mondiale — le *hero feature* de la release.
3. **Compléter** l'histoire "GitWand voit tout" avec le *folder diff* (changements agrégés par répertoire + synthèse IA).

Ce qu'on **ne fait pas en v1.6** : submodules et worktrees. Le chantier est trop lourd (effort L, refonte du modèle d'onglets) et servirait une audience plus étroite. Reporté à v1.7 avec pré-travail architectural dès v1.6 (voir §5).

---

## Planning à 4 semaines

| Semaine | Item | Effort | Jalons |
|---|---|---|---|
| S1 (27 avr. – 3 mai) | **1.6.1 MCP Registry + npm publish** | S | `@gitwand/mcp@1.0.0` sur npm, PR soumise au MCP Registry, CI publish verte |
| S2–S3 (4 – 17 mai) | **1.6.2 Image diff** | L | Tous formats P0 supportés, 4 modes d'affichage fonctionnels, démo enregistrée |
| S4 (18 – 24 mai) | **1.6.3 Folder diff** | M | Arbre de diff navigable, synthèse IA par dossier, UX cohérente avec le file diff |
| — (25 – 31 mai) | Buffer QA, release notes, trailer vidéo, publication | — | Tag `v1.6.0`, update `HomeLanding.vue`, post LinkedIn + tweet |

**Règle de coupe** : si à la fin de S3 l'image diff n'est pas P0-complet, on sacrifie le folder diff (report v1.6.1) plutôt que de sortir une image diff bancale.

---

## Item 1.6.1 — MCP Registry + npm publish

### Problem statement
GitWand expose `@gitwand/mcp` et `@gitwand/cli` dans le monorepo mais **aucun des deux packages n'est publié**. Les utilisateurs qui veulent piloter GitWand depuis Claude, Cursor ou un script shell doivent cloner le repo et builder localement. C'est un mur d'adoption pour un produit dont la promesse est "git agent-friendly".

### Goals
1. `@gitwand/mcp@1.0.0` publié sur npm public.
2. `@gitwand/cli@1.0.0` publié sur npm public.
3. `@gitwand/mcp` référencé dans le [MCP Registry](https://github.com/modelcontextprotocol/registry) officiel d'Anthropic.
4. Workflow GitHub Actions qui publie automatiquement sur `git tag v*` via `NPM_TOKEN`.
5. Un quick-start de 3 lignes dans le README root : `npx @gitwand/cli init` ou ajout MCP depuis Claude Desktop.

### Non-goals
- **Pas de publication de `@gitwand/core`** → c'est une lib interne, pas une API publique. Si elle est publiée plus tard, ce sera avec un contrat de stabilité explicite.
- **Pas de publication de `@gitwand/vscode`** → l'extension VSCode suit un autre canal (marketplace VSCode), traitée en v1.7.
- **Pas de SDK multi-langage** (Python, Go) → Node-only en v1.6, la demande émergera.
- **Pas de télémétrie d'usage** → respect de la charte privacy de GitWand (zero-telemetry par défaut). Opt-in éventuel en v1.7.

### User stories
- En tant que **développeur utilisant Claude Desktop**, je veux ajouter GitWand comme serveur MCP en une ligne de config pour que Claude puisse résoudre mes conflits git automatiquement.
- En tant que **utilisateur de Cursor/Windsurf**, je veux trouver GitWand dans le MCP Registry officiel pour l'installer en un clic.
- En tant que **développeur CLI**, je veux `npx @gitwand/cli resolve` sans clone du repo pour scripter des résolutions de conflits dans ma CI.
- En tant que **mainteneur GitWand**, je veux que publier une nouvelle version déclenche automatiquement le build + publish sur npm pour éviter les oublis manuels.

### Requirements

**P0 (must-have)**
- [ ] `@gitwand/mcp/package.json` : bump `1.3.0 → 1.0.0`, `publishConfig.access: public`, `files: ["dist", "README.md"]`, `repository`, `homepage`, `bugs`, `keywords`.
- [ ] `@gitwand/cli/package.json` : idem (bump version, métadonnées npm complètes).
- [ ] README dédié dans `packages/mcp/README.md` et `packages/cli/README.md` avec install + exemples d'usage + liste des outils exposés.
- [ ] Workflow `.github/workflows/publish.yml` : build sur tag `v*`, publie sur npm via `NPM_TOKEN` (secret GitHub), skip si la version est déjà sur npm.
- [ ] PR soumise au dépôt `modelcontextprotocol/registry` avec entrée GitWand (nom, description, catégorie "git", install command, maintainer).
- [ ] Section "Install" ajoutée au README root + section landing `HomeLanding.vue` (5 locales).

**P1 (nice-to-have)**
- [ ] Badge npm version dans le README (shields.io).
- [ ] Smoke test post-publish : CI déclenche `npx @gitwand/cli --version` sur Ubuntu/macOS/Windows pour vérifier que le package installé fonctionne.
- [ ] Signature du package npm (provenance) via `--provenance` flag.

**P2 (out of scope v1.6)**
- Télémétrie opt-in d'usage CLI (v1.7).
- Homebrew formula (v1.7).
- Binaires pré-compilés pour distribution hors npm (v1.8).

### Acceptance criteria
- Given un utilisateur sur Claude Desktop, when il ajoute `{"mcpServers": {"gitwand": {"command": "npx", "args": ["-y", "@gitwand/mcp"]}}}` à sa config, then GitWand apparaît dans la liste des serveurs et les outils sont listables.
- Given un tag `v1.6.0` poussé sur `origin/main`, when la CI s'exécute, then `@gitwand/mcp@1.6.0` et `@gitwand/cli@1.6.0` sont publiés sur npm et accessibles via `npm view`.
- Given une recherche "gitwand" sur le MCP Registry, when l'utilisateur parcourt les résultats, then GitWand apparaît avec sa description et un lien vers le repo.

### Effort : **S — 3 à 5 jours**

### Risques et dépendances
- **Dépendance externe** : acceptation de la PR par les mainteneurs du MCP Registry (délai 1–10 jours). **Mitigation** : ouvrir la PR en S1 jour 1 pour laisser le temps de review en parallèle des autres chantiers.
- **Collision de nom npm** : vérifier que `@gitwand` scope est libre. **Mitigation** : réserver le scope dès cette semaine.
- **Gestion du versioning cross-packages** : les trois packages (`core`, `mcp`, `cli`) ont des versions divergentes actuellement (1.4, 1.3, ?). **Décision** : `mcp` et `cli` passent à `1.0.0` (première version publiée = API publique stable). `core` reste interne, version libre.

---

## Item 1.6.2 — Image diff

### Problem statement
Les clients git actuels (GitHub Desktop, Fork, Sourcetree, Tower) affichent des fichiers image comme du binaire illisible ou une simple prévisualisation avant/après. Pour les designers, graphistes, devs front et équipes produit, c'est un **angle mort** majeur. Il faut souvent ouvrir Figma ou un comparateur tiers pour réellement voir ce qui a changé. GitWand peut trancher ce nœud en intégrant un image diff natif de qualité.

### Goals
1. Supporter 5 formats en P0 : **PNG, JPEG, SVG, WebP, GIF**.
2. Offrir **4 modes d'affichage** : side-by-side, overlay, blink, slider.
3. Générer une **heatmap** des zones modifiées (diff pixel).
4. Proposer un **alt-text IA** pour chaque image modifiée (accessibilité + changelog auto).
5. Démo enregistrable en 10 secondes pour le marketing.

### Non-goals
- **Pas de vidéo** (MP4, MOV, WebM) → hors scope, effort dédié v1.7+.
- **Pas de diff PDF** → traité par le file diff existant (texte) ou feature dédiée v1.8.
- **Pas de diff 3D / modèles Blender / CAD** → niche, v2+.
- **Pas de diff audio** → niche, v2+.
- **Pas d'édition dans GitWand** → GitWand affiche, il n'édite pas.

### User stories
- En tant que **designer**, je veux comparer deux versions d'un PNG en side-by-side pour valider visuellement un changement avant de merger.
- En tant que **dev front**, je veux voir une heatmap des pixels modifiés pour repérer un changement subtil (ex : anti-aliasing cassé sur un icône).
- En tant que **PM**, je veux un slider between-versions sur un screenshot pour comprendre un changement d'UI sans ouvrir Figma.
- En tant que **mainteneur**, je veux qu'une alt-text soit générée automatiquement pour les images ajoutées afin d'améliorer l'accessibilité et le changelog.
- En tant que **utilisateur de GIF animé**, je veux voir les deux animations côte-à-côte en boucle synchronisée.

### Requirements

**P0 (must-have)**
- [ ] Détection automatique des images dans le diff (extensions + MIME sniffing côté Rust).
- [ ] Lecture des deux versions (ancien + nouveau) depuis le staging ou deux refs git.
- [ ] **Mode side-by-side** : les deux images alignées horizontalement, zoom synchronisé, pan synchronisé.
- [ ] **Mode overlay** : les deux images superposées avec slider d'opacité.
- [ ] **Mode blink** : alternance rapide (2 Hz configurable) entre les deux versions (le "blink comparator" astronomique).
- [ ] **Mode slider** : curseur vertical qui révèle l'ancienne/nouvelle moitié.
- [ ] Support PNG, JPEG, WebP : décodage via `image` crate Rust, affichage canvas HTML.
- [ ] Support SVG : affichage XML parsé + diff textuel en fallback.
- [ ] Support GIF : lecture des frames, lecture en boucle, option pause.
- [ ] Taille max affichée : 20 MB. Au-delà → placeholder + message "image trop grande".
- [ ] Bascule mode d'affichage via UI claire (segmented control, raccourcis clavier `1`/`2`/`3`/`4`).
- [ ] Update des 3 couches backend (Rust `src-tauri/src/lib.rs`, `dev-server.mjs`, `backend.ts`).
- [ ] i18n sur les 5 locales (en, fr, es, pt-BR, zh-CN).

**P1 (nice-to-have)**
- [ ] **Heatmap** : overlay rouge sur les pixels qui diffèrent (seuil configurable).
- [ ] **Alt-text IA** : bouton "Generate description" qui appelle une API LLM (Claude via API) pour décrire l'image. Clé API fournie par l'utilisateur.
- [ ] Export de la comparaison en PNG pour partage dans une review.
- [ ] Info pratique : dimensions, taille fichier, DPI, espace colorimétrique.

**P2 (future)**
- Diff vectoriel SVG intelligent (comparaison de paths, pas juste de texte XML).
- Intégration dans le preview de PR GitHub/GitLab via contribution externe.
- Support APNG, AVIF.

### Acceptance criteria
- Given un commit qui modifie `logo.png`, when j'ouvre le diff dans GitWand, then je vois les deux versions en side-by-side par défaut avec zoom et pan synchronisés.
- Given le mode slider actif, when je bouge le curseur, then la révélation ancien/nouveau se met à jour en temps réel (60 fps).
- Given une image de 25 MB, when j'ouvre le diff, then je vois un placeholder clair avec un bouton "Load anyway" (option explicite).
- Given un GIF animé modifié, when j'active le mode side-by-side, then les deux GIFs jouent en boucle synchronisée dès la même frame.
- Given le heatmap activé (P1), when j'ouvre une image modifiée, then les pixels qui diffèrent sont surlignés en rouge avec intensité proportionnelle au delta.

### Effort : **L — 10 à 15 jours**

### Risques et dépendances
- **Complexité pan/zoom synchronisé** : ne pas réinventer, utiliser `panzoom` ou équivalent. Budget 1 jour pour POC, fallback si ça coince.
- **Performance sur grosses images** : décodage Rust + streaming vers canvas, pas de lecture JS synchrone. Profiler dès la première intégration.
- **API LLM pour alt-text** (P1) : nécessite gestion d'une API key utilisateur → réutiliser le pattern existant de `core/ai/` (si présent) ou créer un composant Settings dédié. Ne pas bloquer P0 là-dessus.
- **Licences des crates Rust** : vérifier que `image`, `webp`, `gif` sont en licences compatibles MIT/Apache.

---

## Item 1.6.3 — Folder diff

### Problem statement
GitHub Desktop et consorts montrent le diff fichier par fichier. Quand un PR touche 40 fichiers répartis dans 8 dossiers, la **lecture d'ensemble est impossible** sans `git diff --stat` en terminal. Pas de vue "ce dossier a pris +520/-103, ce dossier a uniquement des tests modifiés". Les reviewers perdent le fil. Pour des refactors ou des renames massifs, c'est encore pire.

### Goals
1. Arbre de diff navigable par répertoire avec stats agrégées (ajouts, suppressions, fichiers touchés).
2. Comparaison dir-à-dir entre deux refs arbitraires (branches, commits, tags).
3. Synthèse IA par dossier : "Ce dossier contient principalement des changements de refactoring des utilitaires date, plus 2 ajouts de tests."
4. Navigation clavier (flèches, Enter, Escape).

### Non-goals
- **Pas de folder tree 3D ou treemap visuel** → overkill, UX linéaire suffit en v1.6. Peut venir en v1.7.
- **Pas d'édition depuis l'arbre** (staging par dossier) → le staging reste fichier-par-fichier, changer ça casse trop de workflows.
- **Pas de diff cross-repos** → limite à un seul repo.

### User stories
- En tant que **reviewer**, je veux voir la structure du diff par dossier avec les stats pour prioriser mes zones de relecture.
- En tant que **dev**, je veux comparer mon branch avec `main` au niveau dossier pour repérer les zones à forte divergence.
- En tant que **tech lead**, je veux une synthèse IA par dossier pour rédiger une description de PR plus rapidement.
- En tant que **utilisateur clavier-first**, je veux naviguer dans l'arbre avec les flèches et plier/déplier avec Enter.

### Requirements

**P0 (must-have)**
- [ ] Commande backend `folder_diff(ref_a, ref_b)` : retourne une structure arborescente avec, par nœud, `{ path, files_changed, additions, deletions, children }`.
- [ ] Update des 3 couches (Rust + dev-server + TS wrapper).
- [ ] Panneau latéral arbre dossier avec indentation visuelle et icônes état (ajouté, modifié, supprimé, renommé).
- [ ] Stats agrégées affichées à droite de chaque nœud (ex : `+120 / -34 · 5 fichiers`).
- [ ] Clic sur un dossier : filtre le diff principal aux fichiers de ce dossier + descendants.
- [ ] Clic sur un fichier : ouvre le file diff (flow existant).
- [ ] Navigation clavier : ↑/↓ pour se déplacer, →/← pour déplier/plier, Enter pour ouvrir, Esc pour fermer le panneau.
- [ ] i18n 5 locales.

**P1 (nice-to-have)**
- [ ] Synthèse IA par dossier via appel LLM (réutilise l'infra de l'alt-text image diff si P1 image diff est fait).
- [ ] Toggle "hide empty folders" pour les dossiers sans changement.
- [ ] Tri configurable : alphabétique / par nombre de changements / par taille de diff.
- [ ] Bouton "Copy folder path" en context menu.

**P2 (future)**
- Treemap visuel (v1.7+).
- Diff cross-repos.
- Synthèse consolidée "résumé de PR" pour tout le diff (v1.7).

### Acceptance criteria
- Given une PR qui modifie 40 fichiers dans 8 dossiers, when j'ouvre le folder diff, then je vois l'arbre avec stats agrégées et peux cliquer sur un dossier pour filtrer.
- Given je clique sur le dossier `src/utils/`, when je regarde le diff principal, then seuls les fichiers de `src/utils/**` sont visibles.
- Given j'active le toggle "hide empty folders" (P1), when je regarde l'arbre, then les dossiers sans modification sont masqués.
- Given la synthèse IA activée (P1), when j'ouvre un dossier contenant 5 fichiers modifiés, then une phrase descriptive apparaît en haut du panneau de diff.

### Effort : **M — 6 à 9 jours**

### Risques et dépendances
- **Perf sur très gros diffs** (monorepos avec 500 fichiers touchés) : paginer ou virtualiser l'arbre si nécessaire. À mesurer au premier test.
- **Réutilisation de l'infra image diff** : si l'alt-text IA de l'image diff est bien découplée dans un module `core/ai/`, la synthèse folder diff y pioche directement. Sinon, budget +1 jour pour refactor léger.
- **UX rename/move** : git reporte parfois un rename comme delete+add. Utiliser `--find-renames` côté Rust pour détecter et afficher correctement.

---

## §5 — Item 1.6.4 → reporté v1.7 : Submodules + Worktrees

### Rationale du report
- Effort L (10–14 jours) → ne rentre pas après les 3 items déjà retenus (total ~19–29 jours prévus, déjà à la limite haute du budget 4 semaines solo).
- Touche le modèle d'onglets qui est une abstraction centrale de l'app → risque de régression élevé, à ne pas bâcler.
- Audience plus étroite (monorepos avec submodules, devs multi-worktree) que les 3 autres items.

### Pré-requis à anticiper en v1.6 pour ne pas bloquer v1.7
- **Abstraction d'onglets** : pendant la revue de code en v1.6, si un PR touche au modèle d'onglets, s'assurer qu'il reste générique (pas hardcoder l'hypothèse "un onglet = un repo"). Préparer le terrain pour "un onglet = un worktree ou un repo racine".
- **Modèle de repo** : dans `packages/core`, si le type `Repo` est manipulé, vérifier qu'il peut porter un champ `worktrees: Worktree[]` optionnel sans casser.
- **Détection submodule** : si un parcours de fichier échoue sur un sous-dossier `.git` (submodule), logger plutôt que crash. Permettra un skip propre en v1.6 et une vraie gestion en v1.7.

### Scope à (re)négocier en kickoff v1.7
- Gestion des submodules : init, update, suivi de version détachée.
- Worktrees : création, suppression, switch d'onglet ↔ worktree.
- UX des conflits cross-worktree.

---

## Success metrics v1.6

### Leading indicators (J+7 à J+30)
- **Installs npm** `@gitwand/mcp` : **cible 500 / stretch 2000** en 30 jours.
- **Installs npm** `@gitwand/cli` : **cible 200 / stretch 1000** en 30 jours.
- **Stars GitHub** : +200 stars sur la release (cible), +800 (stretch) grâce à la visibilité MCP Registry + post réseaux sociaux.
- **Engagement landing** : CTR "Download" +30% post-release (via Plausible/analytics si présent).

### Lagging indicators (J+30 à J+90)
- **Issues ouvertes** sur GitHub liées aux 3 features : <15% d'issues bugs critiques (santé de la release).
- **Mentions externes** (blog posts, tweets, podcasts) : cible ≥5 mentions organiques dans les 90 jours.
- **Retention npm** : ratio `weekly downloads / total downloads` > 0.15 à J+90 (indique réutilisation, pas juste des installs curieux).

### Méthode de mesure
- Dashboards npm (downloads) + GitHub Insights (stars, issues).
- Monitoring manuel des mentions (Google Alerts "GitWand").
- Pas d'analytics in-app (respect zero-telemetry).

---

## Open questions

| # | Question | Qui répond | Bloquant ? |
|---|---|---|---|
| Q1 | Le scope npm `@gitwand` est-il déjà réservé ? | Laurent (account npm) | **Oui, S1 J1** |
| Q2 | On signe les packages npm avec `--provenance` (nécessite GitHub Actions OIDC) ? | Laurent | Non, peut être décidé en S1 |
| Q3 | Pour l'alt-text IA (P1 image diff), on utilise Claude via API ou on reste local avec un petit modèle type LLaVA ? | Laurent (choix produit) | Non, décidable en S2 |
| Q4 | Pour la synthèse folder diff (P1), même question que Q3 — on mutualise avec Q3 ? | Laurent | Non, décidable en S4 |
| Q5 | Quelle clé npm pour la CI — personnelle ou organisation npm ? | Laurent (setup GitHub secret) | **Oui, S1 J1** |
| Q6 | Le heatmap image diff est-il P0 ou P1 ? Actuel plan le met P1 mais certains users le demandent comme base. | Laurent | Non, décidable S2 |

---

## Risques globaux de la release

1. **Dérive de scope sur l'image diff** (risque élevé) : 4 modes × 5 formats × UX polie = tentation d'en rajouter. **Mitigation** : règle de coupe S3 (cf. planning), revue de scope en fin de S2.
2. **Dépendance MCP Registry externe** (risque moyen) : si la PR traîne, la release peut être tagée sans l'entrée registre. **Mitigation** : entrée registre n'est pas bloquante pour le tag npm — publier d'abord, ajouter au registre en continu.
3. **Fatigue solo dev** (risque moyen, inhérent au projet) : 4 semaines à cadence soutenue sur des chantiers L. **Mitigation** : pas de PR le week-end, buffer de 1 semaine pour QA/release notes.
4. **Régression dans le file diff existant** (risque faible mais critique) : le folder diff touche le panneau de diff principal. **Mitigation** : tests e2e sur les flows existants avant merge du folder diff.

---

## Checklist de release v1.6

- [ ] Les 3 items P0 complets et testés
- [ ] CHANGELOG mis à jour
- [ ] `HomeLanding.vue` : badge bump `1.5.1 → 1.6.0` (5 locales), section "Install via npm" ajoutée
- [ ] README root mis à jour (installation, quick-start MCP)
- [ ] Tag `v1.6.0` poussé → CI publish npm automatique
- [ ] PR MCP Registry mergée (ou au moins ouverte)
- [ ] Release notes GitHub avec captures/GIFs
- [ ] Post LinkedIn + tweet annonce
- [ ] Trailer vidéo 30s (facultatif mais recommandé)

---

## Annexes

### A1 — Dépendances entre items
```
MCP + npm publish (1.6.1) ─── indépendant
                              │
Image diff (1.6.2) ─────────── indépendant
                              │
Folder diff (1.6.3) ───── peut réutiliser infra IA de 1.6.2 (P1)
                              │
Submodules/Worktrees (1.6.4 → v1.7) : pré-requis architecturaux à surveiller en v1.6
```

### A2 — Estimation totale
- 1.6.1 : 3–5 j (S)
- 1.6.2 : 10–15 j (L)
- 1.6.3 : 6–9 j (M)
- **Total** : 19–29 j sur un budget ~20 j ouvrés. La borne haute dépasse, d'où la règle de coupe S3.

### A3 — Post-v1.6 (pour info)
v1.7 pressentie : Submodules + Worktrees, VSCode extension publish, télémétrie opt-in.
