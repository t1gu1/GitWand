# Plan de remédiation — Audit core / cli / app

Basé sur le rapport `code-audit-core-cli-app.md`, vérifié contre le code au **17 avril 2026**. 14 findings sur 15 confirmés valides, 1 partiel (CORS du dev-server : validation de chemin déjà présente, mais `Access-Control-Allow-Origin: *` toujours ouvert).

Les priorités sont équilibrées sur les trois axes : **sécurité**, **structure**, **optimisation**.

---

## Vue d'ensemble

| Priorité | Axe              | Titre court                                  | Effort   | Fichiers clés |
|----------|------------------|----------------------------------------------|----------|---------------|
| **P0**   | Sécurité         | Sanitizer tous les `v-html`                  | M (1j)   | 10 vues front |
| **P0**   | Sécurité         | Durcir le dev-server (CORS + bind + doc)     | S (2h)   | `dev-server.mjs` |
| **P0**   | Sécurité         | Documenter les frontières de confiance Rust  | S (2h)   | `lib.rs`, `README` |
| **P1**   | Structure        | Éclater `resolver.ts` (578 l.) en sous-modules | M (1j)   | `packages/core/src/` |
| **P1**   | Optim            | Paralléliser la lecture des conflits (front) | XS (30m) | `useGitWand.ts` |
| **P1**   | Optim            | Paralléliser la boucle CLI (concurrence bornée) | S (2h) | `cli/index.ts` |
| **P1**   | Structure        | Unifier le rendu markdown (composable + sanitizer) | M (1j) | 2 vues dupliquées |
| **P2**   | Optim            | LCS : matrice rolling (O(min(n,m)) mémoire) + métrique temps/hunk | M (1j) | `core/diff.ts` |
| **P2**   | Structure        | Éclater `cli/index.ts` (497 l.) en sous-modules | M (1j)   | `packages/cli/src/` |
| **P2**   | Structure/Dette  | Réduire la duplication Rust/Node             | L (3-5j) | `lib.rs` + `dev-server.mjs` |
| **P2**   | Core             | Durcir la détection `generated_file` (opt-in / config) | S (2h) | `resolver.ts` |
| **P2**   | Core             | Étendre la validation post-merge (YAML, TOML) | M (1j)   | `resolver.ts` |

Effort total estimé : **~12-16 jours-personnes**, avec la duplication Rust/Node qui pèse le plus lourd.

---

## P0 — Sécurité (à traiter en priorité)

### P0.1 — Sanitization HTML sur les 10 vues avec `v-html`

**Problème.** 10 fichiers utilisent `v-html` sans sanitization. Aucun `DOMPurify` ou équivalent n'est installé. Dans un webview desktop, une XSS peut avoir un impact bien plus fort qu'en navigateur (accès IPC Tauri, commandes système).

Sources les plus exposées (contenu non maîtrisé) :

- `DashboardView.vue:994` — README.md du dépôt
- `PrCommentThread.vue:167` — commentaires GitHub (API tierce)
- `PrDetailView.vue:169` + `PullRequestPanel.vue:714` — body PR (API GitHub)
- `PrCreateView.vue:624` — preview markdown utilisateur
- `FileHistoryViewer.vue:322/422/429` — contenu dépôt
- `DiffViewer.vue:565/618/630`, `CommitDiffViewer.vue:435/456/466`, `MergeEditor.vue:396/408/417`, `PrInlineDiff.vue:333` — HTML de coloration syntaxique construit localement (risque plus faible mais à normaliser)

**Plan.**

1. Installer `dompurify` + `@types/dompurify`.
2. Créer un composable `apps/desktop/src/composables/useSafeHtml.ts` avec une config restrictive (whitelist de balises + attributs utiles au rendu markdown et diff, interdiction de `onerror`, `onclick`, `javascript:`, `data:` pour `img`).
3. Remplacer chaque `v-html="x"` par `v-html="safeHtml(x)"` dans les 10 vues.
4. Ajouter un test unitaire par type de contenu (README, commentaire PR, diff highlight) avec payloads XSS connus (balise `<img onerror>`, `<svg onload>`, `<a href="javascript:...">`).

**Critère d'acceptation.** Aucun `v-html` direct sur contenu externe ne subsiste ; les tests XSS passent.

---

### P0.2 — Durcir le dev-server Node

**Problème.** `apps/desktop/dev-server.mjs` expose une mini-API locale (lecture/écriture fichiers, commandes git) avec `Access-Control-Allow-Origin: *`. Le serveur bind implicitement sur `localhost` (défaut Node), mais rien n'interdit à un autre process local d'appeler l'API.

**Plan.**

1. **Bind explicite sur `127.0.0.1`** : `server.listen(PORT, '127.0.0.1')`.
2. **Restreindre CORS** : autoriser uniquement `tauri://localhost`, `http://localhost:5173`, `http://127.0.0.1:5173` (liste blanche d'origines) au lieu de `*`.
3. **Bannière au démarrage** : warning console clair « dev-server is for local development only, do not expose publicly, do not run in untrusted network environments ».
4. **Jeton partagé optionnel** (P2) : header `x-gitwand-dev-token` généré au boot, injecté par le front au démarrage.

**Critère d'acceptation.** Appel depuis `http://evil.example` bloqué par CORS ; bannière visible au démarrage ; pas de régression en mode dev navigateur.

---

### P0.3 — Documenter et borner les frontières de confiance Rust

**Problème.** `lib.rs` expose 58 commandes Tauri. Bonne pratique déjà en place (arguments passés mécaniquement via `.arg()`, pas d'interpolation shell), mais la surface est large et peu documentée.

**Plan.**

1. Dans `lib.rs`, ajouter un commentaire d'en-tête listant les **catégories de commandes** (lecture FS, écriture FS, exec git, exec gh, exec claude, ouverture editor) et les **invariants de sécurité** attendus pour chaque catégorie.
2. Valider systématiquement que `cwd` est un chemin **absolu et existant** avant tout spawn.
3. Pour les commandes qui acceptent un `path` relatif, refuser explicitement les segments `..` (défense en profondeur — Node `path.resolve` nettoie déjà, mais codé côté Rust pour être explicite).
4. Unit tests sur 2-3 commandes sensibles avec entrées malformées (`path: "../../etc/passwd"`, `cwd: ""`, `branch: "$(...)"`).

**Critère d'acceptation.** Chaque commande Tauri a un commentaire qui décrit sa catégorie de confiance ; les tests avec path traversal échouent proprement.

---

## P1 — Structure & optim à fort impact

### P1.1 — Éclater `resolver.ts` (578 lignes)

Découper en :

- `resolver/validation.ts` — marqueurs résiduels, validation JSON/JSONC
- `resolver/generated-detection.ts` — détection fichiers générés + patterns
- `resolver/format-dispatch.ts` — dispatch vers les resolveurs spécialisés
- `resolver/policy.ts` — règles de politique de merge
- `resolver/assemble.ts` — assemblage final du résultat
- `resolver/index.ts` — orchestration + export public

Les tests existants (`__tests__/`) doivent rester verts sans modification — seuls les chemins d'import changent.

### P1.2 — Paralléliser la lecture des conflits (front) — **quick win**

`useGitWand.ts:218-227` lit les fichiers en série avec `await` dans la boucle. Remplacer par `Promise.all(conflictedPaths.map(p => readFile(cwd, p)))`. Gain : latence d'ouverture divisée par ~N pour N fichiers en conflit (limite : IPC Tauri sérialisé en pratique, mais le dev-server en bénéficie pleinement).

### P1.3 — Paralléliser la boucle CLI avec concurrence bornée

`cli/index.ts:316-372` traite les fichiers un par un. Utiliser un pool de concurrence (ex. `p-limit` ou boucle custom avec `Promise.all` par batch de 8). Attention à préserver l'ordre des écritures dans le rapport JSON.

### P1.4 — Unifier le rendu markdown

Deux implémentations divergentes : `DashboardView.vue` (22+ passes regex) et `PrCreateView.vue` (parser stateful). Options :

- **Option A (recommandée).** Utiliser `markdown-it` (maintenu, fiable, plugins) + DOMPurify. Remplace les deux implémentations et réduit la dette de sécurité.
- **Option B.** Extraire le parser stateful de `PrCreateView.vue` dans un composable `useMarkdown()`, l'utiliser des deux côtés. Plus léger en bundle mais coût de maintenance.

---

## P2 — Optim et dette long terme

### P2.1 — LCS : réduire la consommation mémoire

`core/diff.ts:22-59` alloue une matrice DP complète `O(n*m)`. Pour de gros fichiers, passer à une matrice rolling (2 lignes, `O(min(n,m))` mémoire) tant que l'on ne reconstruit pas le chemin, ou utiliser Hunt-Szymanski pour les cas très répétitifs (lockfiles). Ajouter une métrique `time_per_hunk` dans le rapport CLI pour détecter les régressions.

### P2.2 — Éclater `cli/index.ts` (497 lignes)

- `commands/resolve.ts`
- `commands/status.ts`
- `reporting.ts` (JSON CI + texte humain)
- `partial-content.ts` (builder)
- `cli.ts` (parser + dispatch)

### P2.3 — Réduire la duplication Rust/Node

Le chantier le plus lourd (3-5j). Trois options :

- **A.** Transformer `dev-server.mjs` en simple proxy vers un binaire Rust de dev (réutilisation à 100%, mais complexifie le dev browser).
- **B.** Extraire un module JS partagé (`packages/git-ops`) qui appelle `git` via Node, et le consommer depuis `dev-server.mjs`. Le backend Rust reste indépendant mais on réduit la duplication côté JS.
- **C.** Statu quo documenté : maintenir une suite de tests de parité Rust↔Node (pour 10-15 commandes critiques) pour détecter les divergences.

**Recommandation.** Option C à court terme (faible coût, évite la divergence silencieuse), option B si le dev-server grossit encore.

### P2.4 — Détection `generated_file` configurable

Les patterns sont hardcodés (`resolver.ts:50-62`). Rendre cela configurable via `.gitwandrc` (liste allow/deny par projet), pour permettre d'exclure un chemin qui se trouve porter un nom standard sans être réellement généré.

### P2.5 — Validation post-merge étendue

Actuellement seul JSON/JSONC est validé. Ajouter YAML et TOML (dépendances déjà populaires : `js-yaml`, `@iarna/toml`). Apporte peu sur du texte libre, mais évite des merges cassés sur des fichiers de config fréquents.

---

## Ordre d'attaque proposé

1. **P0.1 + P0.2** en parallèle (sécurité immédiate, 1-2j combinés)
2. **P1.2** (quick win 30 min, à caser dans le même lot que P0 pour tester la boucle de modif en 3 couches)
3. **P0.3** (documentation + tests, 2h)
4. **P1.1** (refacto resolver)
5. **P1.4** (unification markdown — se combine naturellement avec P0.1)
6. **P1.3** (parallélisme CLI)
7. **P2.1** (LCS) — seulement si une régression perf est observée
8. **P2.2** (refacto CLI) — quand le fichier dépasse 600 lignes
9. **P2.3** (dédup Rust/Node) — planifier à part, en trimestre dédié
10. **P2.4 / P2.5** — opportunistes, à caser dans une itération calme

---

## Rappels projet (GitWand)

- Toute modification côté backend git doit être répercutée dans **les trois couches** : `src-tauri/src/lib.rs` (Rust), `apps/desktop/dev-server.mjs` (Node), `apps/desktop/src/utils/backend.ts` (wrapper TS).
- Toute modification d'UI string doit être synchronisée dans **`src/locales/fr.ts` et `src/locales/en.ts`** (fr = langue primaire).
- Les tests core vivent dans `packages/core/src/__tests__/` et doivent rester verts.
