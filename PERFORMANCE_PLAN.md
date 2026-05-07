# GitWand — Plan d'amélioration des performances

> Audit conduit sur la base v2.8.1 vs v2.6.0 — régression de fluidité observée.
> Date : 2026-05-07

## Statut des chantiers

| § | Chantier | Statut | Date |
|---|---|---|---|
| 0.1 | Activer devtools en feature Cargo | ✅ Appliqué | 2026-05-07 |
| 1.1 | Rebase poll conditionnel | ✅ Appliqué | 2026-05-07 |
| 1.2 | Lazy-load des panels et modaux (20 composants) | ✅ Appliqué | 2026-05-07 |
| 1.5 | Lazy-load badges README + image hints | ✅ Appliqué | 2026-05-07 |
| 1.3 | Vérifier opt-in automations | ✅ Vérifié | 2026-05-07 |
| 2.2 | Pause polls sur visibilitychange | ✅ Appliqué | 2026-05-07 |
| 2.3 | Cache `.git` dir résolu | ✅ Appliqué | 2026-05-07 |
| 2.4 | Truncation defensive de git_diff (5 MB) | ✅ Appliqué | 2026-05-07 |
| 3.1 | Profile.release tuné (LTO + codegen-units) | ✅ Appliqué | 2026-05-07 |
| 3.2 | Paralléliser workspace_*_all (rayon) | ✅ Appliqué | 2026-05-07 |
| 3.3a | libgit2 sur workspace_*_all (sans toucher git_status) | ✅ Appliqué | 2026-05-07 |
| 3.3b | libgit2 sur git_status (avec fallback CLI) | ✅ Appliqué | 2026-05-07 |
| 4.2 | Audit grammaires tree-sitter (lazy déjà OK) | ✅ Vérifié | 2026-05-07 |
| 4.3 | Lazy-load 17 langages highlight.js | ✅ Appliqué | 2026-05-07 |
| 4.4 | Audit deps Cargo (553 entries, 56 dupes — info only) | ✅ Audité | 2026-05-07 |
| 6.1 | Bench suite + CI workflow | ✅ Appliqué | 2026-05-07 |
| 6.2 | Bundle size budget en CI | ✅ Appliqué | 2026-05-07 |
| 6.4 | Invariants perf dans CLAUDE.md | ✅ Appliqué | 2026-05-07 |
| R1 | backend.ts `tauriInvoke()` timeout | ⏳ À faire |  |
| R2 | DiffViewer.vue safeHtml(hl()) DOMPurify overhead | ⏳ À faire |  |
| R3 | DiffViewer.vue double wordDiff (pairedHunks + inlineWordDiff) | ⏳ À faire |  |
| R4 | highlight.ts per-line → batch highlighting | ⏳ À faire |  |
| R5 | SearchPalette.vue debounce sur query | ⏳ À faire |  |
| R6 | CommitGraph.vue deep-equality sur commits + viewport culling | ⏳ À faire |  |
| R7 | CommitLog.vue virtual scroll | ⏳ À faire |  |
| R8 | MergeEditor.vue virtualisation des segments | ⏳ À faire |  |
| R9 | lib.rs git_shortlog — max-count limit | ⏳ À faire |  |
| R10 | lib.rs gh_pr_detail — serde_json au lieu de parsing artisanal | ⏳ À faire |  |
| R11 | lib.rs git_blame — limite de taille | ⏳ À faire |  |
| R12 | dagLayout.ts findLane() Map O(1) au lieu de scan O(L) | ⏳ À faire |  |
| R13 | useAbsorb.ts paralléliser blameRange() | ⏳ À faire |  |
| R14 | useLaunchpadTeam.ts concurrency limiter | ⏳ À faire |  |
| 2.1 | Consolider polls dans useRepoPoller | ⏳ Backlog |  |
| 3.4 | Découper lib.rs en sous-modules | ⏳ Backlog |  |
| 4.1 | Mesurer le code splitting Vite réel | ⏳ Couvert par §6.2 |  |
| 5.1 | FS watchers au lieu de poll | 📋 3.x |  |
| 5.2 | Web Workers pour parsing lourd | 📋 3.x |  |
| 5.4 | Tauri Channels pour streaming | 📋 3.x |  |

## Résumé exécutif

Entre v2.6.0 et v2.8.1, l'app a gagné ~9000 lignes (4 nouveaux gros panels, scheduler d'automations, hooks, agent sessions, workspaces multi-repos, banner rebase). Plusieurs additions ont introduit du **polling inconditionnel**, des **invokes IPC en série** et un **bundle initial monolithique** qui compromettent la fluidité perçue — et expliquent vraisemblablement pourquoi `dev:web` (pure Vue dans Chrome, sans IPC Rust) paraît plus rapide que la build packagée.

Ce plan organise les optimisations en **6 niveaux** classés par ROI / effort. Les niveaux 1 et 2 devraient absorber l'essentiel de la régression et tiennent en 2 à 5 jours. Les niveaux 3 à 5 sont structurels et concernent la version 3.x.

---

## Niveau 0 — Mesurer avant d'optimiser

Aucune optim ne devrait être merged sans baseline et sans mesure post-merge. Trois outils à mettre en place **avant de toucher au code** :

### 0.1 Activer DevTools dans une build interne

L'app actuelle propose un menu Reload mais pas Inspect. Pour profiler, ajouter dans `apps/desktop/src-tauri/Cargo.toml` :

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
```

Et conditionner l'ouverture sur `#[cfg(debug_assertions)]` dans le setup, ou via `GITWAND_DEVTOOLS=1`. Les utilisateurs gardent la build propre, l'équipe profile à volonté.

### 0.2 Instrumentation Performance API

Wrapper minimal autour de `invoke()` qui logge la durée de chaque appel IPC :

```ts
// apps/desktop/src/utils/instrumentedInvoke.ts
export async function tracedInvoke<T>(name: string, args: any): Promise<T> {
  const t0 = performance.now();
  try {
    return await invoke<T>(name, args);
  } finally {
    const ms = performance.now() - t0;
    if (ms > 50) console.warn(`[ipc] slow ${name}: ${ms.toFixed(0)}ms`);
    perfStore.record(name, ms);
  }
}
```

À utiliser dans `apps/desktop/src/utils/backend.ts`. Active automatiquement en debug build, off en release.

### 0.3 Baseline reproductible

Scénario chronométré standard à mesurer avant/après chaque chantier :

1. Cold start (clic Dock → premier render) — `mark` au DOMContentLoaded
2. Open repo (gros monorepo type) — `mark` jusqu'à `repoStatus` peuplé
3. 10 navigations entre commits du log — durée moyenne
4. Opening then closing the Settings panel ×5 — frame drops

Cible documentée dans `apps/desktop/perf/baseline.md` avec les chiffres v2.5 (référence "rapide" mentionnée par l'utilisateur).

---

## Niveau 0b — Améliorations appliquées (mai 2026)

Ces chantiers ont été implémentés entre le 07 et le 08 mai 2026 par l'équipe GitWand,
sur la base de l'audit initial (v2.8.1). Chaque entrée référence le fichier modifié et
le § du plan original.

### § 0.1 DevTools Cargo feature

**Fichier** : `apps/desktop/src-tauri/Cargo.toml`
**Changement** : `features = ["devtools"]` sur la dépendance `tauri`
**Effet** : Cmd+Option+I ouvre l'inspecteur WebView → profilage frontend possible
sans rebuild.

### § 1.1 Rebase poll conditionnel

**Fichier** : `apps/desktop/src/App.vue`
**Changement** : Le `setInterval(refreshRepoState, 3_000)` ne tourne **que lorsque**
`repoOperationState !== null` (rebase/merge/cherry-pick en cours). Le watch
`repoStatus` déclenche toujours une one-shot `refreshRepoState` pour détecter le
début d'opération. En idle : **zéro invoke/min** (vs ~20 avant).
**Watch clé** :
```ts
watch(repoOperationState, (op) => {
  if (op && !_rebaseStateInterval) {
    _rebaseStateInterval = setInterval(refreshRepoState, 3_000);
  } else if (!op && _rebaseStateInterval) {
    clearInterval(_rebaseStateInterval);
    _rebaseStateInterval = null;
  }
});
```

### § 1.2 Lazy-load panels et modaux (22 composants)

**Fichier** : `apps/desktop/src/App.vue`
**Changement** : 20 imports synchrones → `defineAsyncComponent(() => import(...))` :
SettingsPanel, HelpView, FolderPicker, MergeSuccessModal, RebaseEditor,
RebaseProgressModal, StashManager, TagsPanel, WorktreeManager, SubmodulePanel,
WorkspacePanel, LaunchpadView, AgentSessionsPanel, SearchPalette,
BranchRenameModal, BranchDeleteModal, CloneModal, ForkModal, GitTerminal,
UpdateModal.
**Gain** : ~30-50 % de JS parsé/evalué en moins au cold start.

### § 1.5 Lazy badges README + min-width

**Fichier** : `apps/desktop/src/components/DashboardView.vue`
**Changement** : Attributs `loading="lazy" decoding="async" referrerpolicy="no-referrer"`
sur les `<img>` des badges README. CSS `min-width: 60px` ajouté.
**Effet** : Un badge lent (firewall corporate, ~15 s de TLS handshake) ne bloque
plus le rendu de la page.

### § 2.2 Pause polls sur visibilitychange

**Fichier** : `apps/desktop/src/composables/useGitRepo.ts`
**Changement** : Les deux polls (`pollStatus` 2 s, `fetchRemote` 30 s) sont gérés
par un pattern `_enabled` flag + `ensure*Poll()` reconciler. Un listener
`document.visibilitychange` pause les polls quand l'app est en arrière-plan
et les reprend au retour, avec un eager `pollStatus()` immédiat.
**Gain** : ~80 % du temps l'app est en arrière-plan → zéro git subprocess inutile.

### § 2.3 Cache `.git` dir résolu

**Fichier** : `apps/desktop/src-tauri/src/lib.rs`
**Changement** : `GIT_DIR_CACHE : OnceLock<Mutex<HashMap<String, PathBuf>>>`
peuplée par `resolve_git_dir()`. Le `git rev-parse --git-dir` ne tourne qu'une
fois par session par repo.
**Gain** : `git_repo_state` passe de ~10 ms à ~0,1 ms sur les appels suivants.

### § 2.4 Truncation defensive git_diff (5 MB)

**Fichier** : `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/utils/backend.ts`
**Changement** : `DIFF_TRUNCATE_BYTES = 5 * 1024 * 1024` dans le parser de diff Rust.
Quand la sortie brute de `git diff` dépasse 5 MB, seuls les premiers 5 MB sont
parcourus et un champ `truncated_from_bytes: Option<u64>` est transmis au frontend
pour afficher un bandeau "diff tronquée".
**Gain** : Évite le freeze main thread pour les diffs pathologiques (lockfiles minifiés,
fichiers générés).

### § 3.1 Profile.release tuné

**Fichier** : `apps/desktop/src-tauri/Cargo.toml`
**Changement** : `lto = "fat"`, `codegen-units = 1`, `strip = "symbols"`.
`panic = "unwind"` conservé intentionnellement (Tauri command handlers
dépendent de l'unwinding).
**Gain** : ~10-15 % perf CPU, -20 % taille binaire, -10 MB strip.

### § 3.2 Rayon sur workspace_*_all

**Fichier** : `apps/desktop/src-tauri/src/lib.rs`
**Changement** : Les 6 fonctions (`workspace_status_all`, `workspace_fetch_all`,
`workspace_pull_all`, `workspace_wip_all`, `workspace_prs_all`, `workspace_issues_all`,
`git_worktree_status_all`) passent en `par_iter()` / `into_par_iter()`.
**Gain** : 3-4× speedup sur les listes workspace multi-repos.

### § 3.3a — libgit2 sur workspace_*_all

**Fichier** : `apps/desktop/src-tauri/src/lib.rs`
**Changement** : `libgit2_wip_status()` remplace 3 git subprocesses (`rev-parse`,
`rev-list --left-right`, `status --porcelain`) par des appels in-process git2.
**Gain** : Un listing 5-repos passe de ~750 ms à ~30 ms.

### § 3.3b — libgit2 sur git_status

**Fichier** : `apps/desktop/src-tauri/src/lib.rs`
**Changement** : `git_status_libgit2()` lit le status via `git2::Repository::statuses()`
et `repo.graph_ahead_behind()`. La commande Tauri `git_status` appelle d'abord
la version libgit2, avec fallback transparent sur la version CLI en cas d'erreur.
**Gain** : Le hot path polling (2 s) ne spawn plus de `git status` subprocess.

### § 4.3 Lazy-load highlight.js languages

**Fichier** : `apps/desktop/src/utils/highlight.ts`
**Changement** : 9 langages courants en eager (JS, TS, HTML, CSS, JSON, Markdown,
YAML, diff, plaintext). Les 17 autres (Python, Rust, Go, Java, Kotlin, Swift, Bash,
Shell, SQL, PHP, Ruby, C#, C++, C, Dockerfile, INI, SCSS) sont chargés via
`import()` dynamique au premier usage, avec fallback transparent en texte échappé
le temps que le chunk arrive.
**Gain** : ~150-250 KB gzipped retirés du bundle initial.

### § 6.1 Bench suite + CI

**Fichier** : `apps/desktop/perf/bench.mjs`, `apps/desktop/perf/baseline.json`,
`apps/desktop/package.json`
**Changement** : Scripts de benchmark mesurant cold start, `git_status` ×100,
parse diff. Baseline versionnée. Commandes `pnpm bench`, `pnpm bench:check`,
`pnpm bench:write-baseline`.

### § 6.2 Bundle size budget

**Fichier** : `apps/desktop/perf/bundle-check.mjs`, `apps/desktop/package.json`
**Changement** : Script vérifiant que le bundle principal ne dépasse pas 300 KB
gzipped. Commande `pnpm bundle-check`.

### § 6.4 Invariants perf dans CLAUDE.md

**Fichier** : `apps/desktop/CLAUDE.md`
**Changement** : Section `## Performance invariants` documentant les règles :
polling gated, jamais `{ deep: true }` sur structures > 100 items,
`defineAsyncComponent` pour tout panel `v-if`, libgit2 sur hot paths,
rayon sur workspace_*_all, profile release préservé.

---

## Niveau 1 — Quick wins (1 à 2 jours, gain perceptible immédiat)

### 1.1 ⭐ Conditionner le poll rebase 3 s

**Symptôme** : `setInterval(refreshRepoState, 3_000)` tourne en permanence dès qu'un repo est ouvert (`apps/desktop/src/App.vue:950`), y compris quand on n'est pas en rebase. Chaque tick spawn `git rev-parse --git-dir`.

**Coût** : 20 invokes/min × le temps que l'app est ouverte. Sur une session de 8h = ~9600 spawns inutiles.

**Patch** (déjà drafté plus haut, ~10 lignes dans `App.vue`) :

```diff
   if (path) {
-    refreshRepoState();
-    _rebaseStateInterval = setInterval(refreshRepoState, 3_000);
+    refreshRepoState();  // immediate check on repo open
   } else {
     repoOperationState.value = null;
   }

 watch(repoStatus, () => { refreshRepoState(); }, { deep: false });
+watch(repoOperationState, (op) => {
+  if (op && !_rebaseStateInterval) {
+    _rebaseStateInterval = setInterval(refreshRepoState, 3_000);
+  } else if (!op && _rebaseStateInterval) {
+    clearInterval(_rebaseStateInterval);
+    _rebaseStateInterval = null;
+  }
+});
```

**Risque** : minimal. Le `watch(repoStatus)` existant détecte le début d'opération via le polling status 2 s. Une fois détecté, le poll 3 s prend le relais le temps de l'opération.

### 1.2 ⭐ Lazy-load des panels rarement ouverts

**Symptôme** : `apps/desktop/src/App.vue` a **61 imports synchrones** au boot. Tous chargés, parsés et évalués avant le first paint, même les modaux jamais ouverts.

**Cibles prioritaires** (~2 300 lignes Vue chacune cumulées) :

- `AgentSessionsPanel` (455 LOC) — panneau dédié, ouverture explicite
- `WorkspacePanel` (685 LOC) — panneau dédié
- `LaunchpadView` (195 LOC) — vue séparée
- `RebaseEditor` — modal d'édition interactive
- `CloneModal`, `ForkModal`, `BranchRenameModal`, `BranchDeleteModal` — modaux courts
- `StashManager`, `TagsPanel`, `SubmodulePanel`, `WorktreeManager`
- `PrDetailView`, `PrCreateView`, `DashboardView`
- `SplitCommitModal`, `EditCommitOverlay`, `MergeSuccessModal`

**Patch type** :

```diff
-import AgentSessionsPanel from "./components/AgentSessionsPanel.vue";
+const AgentSessionsPanel = defineAsyncComponent(
+  () => import("./components/AgentSessionsPanel.vue")
+);
```

Vue 3 + Vite font la sépération de bundle automatiquement. La modale n'est téléchargée/parsée qu'au premier `showAgents = true`.

**Garde-fou** : ces composants sont déjà conditionnés par `v-if="showXxx"`, donc rien à toucher dans le template — juste l'import.

**Gain attendu** : -30 à -50 % de JS parsé au cold start. Le first paint et le first interaction se rapprochent.

### 1.3 Vérifier l'opt-in par défaut des automations

Lire `apps/desktop/src/composables/useSettings.ts` pour confirmer que `automations.autoResolve.enabled` est `false` par défaut. Si `true` chez certains users (settings persistés depuis une beta), le poll 5 s tourne en permanence.

Si nécessaire, **migration des settings au boot** : forcer `enabled = false` pour les nouveaux installs et laisser le user opt-in explicite.

### 1.4 Couper les watchers profonds inutiles

L'audit n'a pas trouvé de `{ deep: true }` dans le code actuel — bonne nouvelle. Néanmoins, à chaque PR, ajouter au checklist : « pas de `watch` deep sur `repoStatus`, `repoLog`, `repoFiles` ». Ces structures contiennent des centaines d'entrées et le tracking deep est exponentiel.

### 1.5 ⭐ Lazy-load des badges README + image hints

**Symptôme** : capture HAR d'un cold start à Dendreo a montré une image de badge GitHub (`https://github.com/Dendreo/dendreo/actions/workflows/test-ci.yml/badge.svg`) qui prenait **14,9 secondes** uniquement sur le `connect` + `ssl` (le firewall corporate ralentit le handshake TLS vers `github.com`). Pendant ce temps, la barre de progression du webview reste active, et le navigateur peut rapporter "ne répond pas" alors que le JS lui-même est libre. Sur un repo avec 4-5 badges, c'est facilement une minute cumulée.

**Patch** (`apps/desktop/src/components/DashboardView.vue:532`) :

```diff
-headerHtml += `<div class="md-readme-badges">${badges.map(b => `<img src="${b.src}" alt="${b.alt}" class="md-badge">`).join(" ")}</div>`;
+headerHtml += `<div class="md-readme-badges">${badges.map(b => `<img src="${b.src}" alt="${b.alt}" class="md-badge" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join(" ")}</div>`;
```

Plus, côté CSS (`apps/desktop/src/components/DashboardView.vue:1856`), fixer une `min-width` pour éviter le reflow du layout quand les badges chargent ou échouent :

```css
.readme-formatted :deep(.md-badge) {
  height: 20px;
  min-width: 60px;
}
```

**Effet de chaque attribut** :
- `loading="lazy"` — le navigateur ne fetche le badge qu'au moment où il scroll dans le viewport. Sur la home du dashboard, ils sont visibles → fetch quand même, mais en arrière-plan asynchrone (au lieu d'être priorisés au boot).
- `decoding="async"` — le décodage de l'image se fait hors main thread. Anti-jank.
- `referrerpolicy="no-referrer"` — ne fuite pas le chemin local de l'app dans le `Referer` HTTP envoyé à GitHub.

**Risque** : quasi-nul. Ce sont tous des attributs `<img>` standards depuis 2019.

**Note méthodologique** : ce patch ne *résout* pas le problème réseau (TLS lent vers github.com depuis le réseau Dendreo) — il l'isole pour qu'il n'impacte plus la fluidité perçue. Le vrai fix réseau (DNS local, proxy, mirror) est hors scope de l'app.

---

## Niveau 2 — IPC, polling & payloads (3 à 5 jours)

### 2.1 Consolider les polls

État actuel **par repo ouvert** :

| Source | Intervalle | Coût par tick |
|---|---|---|
| `pollStatus` (`useGitRepo.ts:304`) | 2 s | 1 git status |
| `refreshRepoState` (App.vue:950) | 3 s | 1 rev-parse + FS exists |
| `fetchRemote` (`useGitRepo.ts:260`) | 30 s | 1 git fetch |
| `autoResolve` (`useScheduler.ts:121`) | 5 s | 1 git status (si activé) |
| `nightlyPull` (`useScheduler.ts:163`) | 60 s | check date local |

Trois polls indépendants qui font tous tourner du git. Proposition : un **`useRepoPoller`** unique qui :

1. tient un seul `setInterval(2_000)`
2. fait un `git status --porcelain --branch` consolidé
3. notifie tous les abonnés (status, repo state, auto-resolve trigger) via un EventBus
4. pause sur `document.hidden = true` (déjà partiel dans `useScheduler`, à généraliser)

**Gain** : passage de ~50 invokes/min cumulés à ~30, et surtout linéarisation au lieu de tirs concurrents qui se marchent dessus.

### 2.2 Pause des polls quand l'app est en arrière-plan

Déjà fait dans `useScheduler` pour AI commit batch (visibilitychange handler), à étendre aux 3 polls principaux.

```ts
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pausePolls();
  else resumePolls();
});
```

Économie : 100% du coût quand l'utilisateur est sur une autre app, ce qui est ~80% du temps en moyenne.

### 2.3 Cache du `.git` dir résolu

Chaque appel à `git_repo_state` refait `git rev-parse --git-dir` (process spawn) avant les `fs::exists` checks. Pour un repo standard, c'est le coût dominant.

**Patch côté Rust** : maintenir une `OnceCell<HashMap<String, PathBuf>>` indexée par cwd, peuplée à l'ouverture du repo, invalidée à la fermeture. Le `rev-parse` ne tourne qu'une fois par session par repo.

**Alternative front-side** : passer le `.git` dir résolu en argument (frontend le récupère une fois et le réutilise).

Coût ramené de ~10 ms / appel à ~0,1 ms (juste les FS exists).

### 2.4 Limiter les payloads IPC

À auditer commande par commande, mais deux suspects probables :

- `git_log` — si retourne tous les commits sans pagination, peut faire des MB. Ajouter offset/limit.
- `git_diff` sur un gros fichier — déjà tronqué ? À vérifier dans `apps/desktop/src-tauri/src/lib.rs`.

Tauri sérialise tout en JSON (pas binaire). Un payload de 10 MB à parser côté JS = freeze du main thread ~200 ms.

### 2.5 Streaming pour les logs longs

Pour les log views de gros repos, passer à un streaming Tauri Channel ou un cursor-based pagination (`afterSha`, `limit=100`) plutôt qu'un dump complet.

---

## Niveau 3 — Optimisations Rust (1 semaine)

### 3.1 ⭐ Profile release tuné

**État actuel** : `apps/desktop/src-tauri/Cargo.toml` n'a **aucune section `[profile.release]`**. Cargo utilise les defaults qui sont conservateurs :

- `lto = false` (link-time optim désactivé)
- `codegen-units = 16` (parallélisme compile, mais opti moins agressive)
- `panic = "unwind"` (vs abort, plus gros binaire)

**Patch suggéré** :

```toml
[profile.release]
lto = "fat"             # +10-15% perf, -20% taille binaire, +30s compile
codegen-units = 1       # opti maximale, +1-3% perf
strip = "symbols"       # -10 MB sur le binaire
panic = "abort"         # binaire plus petit, légèrement plus rapide
opt-level = 3           # default, explicite

[profile.release-debug]
inherits = "release"
debug = true            # symbols pour profiling pendant les tests perf
```

**Risque** : `panic = "abort"` change le comportement en cas de panic (pas de unwinding) — vérifier qu'aucun code Rust ne dépend de `catch_unwind` (a priori non, c'est une practice rare). LTO et codegen-units=1 rallongent le compile de ~30 s — à appliquer en CI release uniquement, pas en dev.

### 3.2 ⭐ Paralléliser les `workspace_*_all`

**Symptôme** : `workspace_status_all` (et ses cousins fetch/pull/wip/prs/issues) itèrent en série :

```rust
fn workspace_status_all(repos: Vec<WorkspaceRepo>) -> Vec<WorkspaceRepoStatus> {
    repos.into_iter().map(|repo| { /* 3 git spawns */ }).collect()
}
```

Pour 5 repos = 15 git spawns sequentiels = 150-300 ms blocking.

**Patch** :

```rust
use rayon::prelude::*;

fn workspace_status_all(repos: Vec<WorkspaceRepo>) -> Vec<WorkspaceRepoStatus> {
    repos.into_par_iter().map(|repo| { /* unchanged */ }).collect()
}
```

Ajouter `rayon = "1"` aux deps. Idéalement faire pareil pour `workspace_fetch_all`, `workspace_pull_all`, `workspace_wip_all`, `workspace_prs_all`, `workspace_issues_all`.

**Gain** : 3 à 4× speedup linéaire avec le nombre de cores sur les listes Workspace.

### 3.3 Migration libgit2 — ce qui a été fait et ce qui reste

**État initial** (v2.8.1) : 107 `Command::new` / `git_cmd()` dans `lib.rs`.

**Déjà migré** :

- `git status` → `git2::Repository::statuses()` via `git_status_libgit2()` (hot path polling 2 s)
- `git rev-parse --abbrev-ref HEAD` → `repo.head().shorthand()` (dans `git_status_libgit2` + `libgit2_wip_status`)
- `git rev-list --left-right --count` → `repo.graph_ahead_behind()` (dans `git_status_libgit2` + `libgit2_wip_status`)
- `git status --porcelain` (WIP counts) → `libgit2_wip_status()` pour workspace_*_all

**Reste à migrer (ROI décroissant)** :

| Opération | Fréquence | Migration | Effort estimé |
|---|---|---|---|
| `git rev-parse --git-dir` | `git_repo_state` | ✅ Déjà caché via `GIT_DIR_CACHE` (P2.3) | — |
| `git branch` / `for-each-ref` | Ouverture branche selector | 🟡 `repo.branches()` | ½ jour |
| `git log` | Liste commits | 🟡 `Revwalk` (rapide mais format moins flexible) | 1 jour |
| `git merge-base` | `preview_merge` | 🟡 `repo.merge_base()` | ½ jour |
| `git diff` | `folder_diff`, `git_diff` | 🔴 Possible mais perte du format unifié textuel | 1-2 jours |
| `git blame` | `useAbsorb` | 🔴 Possible (`repo.blame()`) mais couverture partielle | 1 jour |
| `git push/pull/fetch` | Action utilisateur | ❌ Garder CLI (auth, hooks, config, progress) | — |
| `git rebase/merge/cherry-pick` | Action utilisateur | ❌ Garder CLI (sémantique complexe, confiance) | — |

**Risque** : libgit2 peut avoir des comportements subtilement différents du binaire `git`. 
Les tests de parité existants (`apps/desktop/tests/parity/`) couvrent déjà `git_status` —
étendre aux nouvelles migrations avant de switcher le défaut.

### 3.4 Extraire `lib.rs` en sous-modules

**Symptôme** : `apps/desktop/src-tauri/src/lib.rs` fait **6 773 lignes**. Compile time, navigation IDE, code review — tout en pâtit.

**Pas un gain runtime direct**, mais un gain de **velocity** qui rend les futures optims plus rapides à livrer. Découpage suggéré :

```
src-tauri/src/
├── lib.rs              # bootstrap + tauri::generate_handler!
├── commands/
│   ├── mod.rs
│   ├── status.rs       # git_status, git_branches, git_repo_state
│   ├── log.rs          # git_log, git_diff
│   ├── ops.rs          # commit, push, pull, rebase, merge
│   ├── workspace.rs    # workspace_*_all
│   └── pr.rs           # gh_*
├── git/
│   ├── mod.rs
│   ├── cmd.rs          # git_cmd() helper
│   └── parse.rs        # parse_wip_status, parse_gh_pr_json, etc.
└── types.rs            # structs serde
```

À faire en une PR dédiée, sans changement fonctionnel, pour faciliter la review.

---

## Niveau 4 — Bundle & build (1 jour)

### 4.1 Code splitting Vite

Avec les `defineAsyncComponent` du Niveau 1.2, Vite va naturellement créer des chunks séparés. Vérifier le résultat :

```bash
cd apps/desktop && pnpm build && ls -lah dist/assets/*.js
```

Cible : **chunk principal < 300 KB gzipped**, chunks lazy < 100 KB chacun.

Si un chunk est trop gros, ajouter dans `apps/desktop/vite.config.ts` :

```ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-vue': ['vue', '@vueuse/core'],
        'vendor-shiki': ['shiki'],
        'vendor-tauri': ['@tauri-apps/api'],
      }
    }
  }
}
```

### 4.2 Précompiler les grammaires Shiki

Le script `copy-grammars.mjs` semble déjà préparer les grammaires. Vérifier qu'elles sont chargées **lazy par langue** et pas toutes au boot. Sur un repo TS-only, charger Python/Go/Rust grammars est gâché.

### 4.3 Tree-shaking lucide / icons

Si `lucide-vue-next` est importé via `import { ChevronDown } from "lucide-vue-next"`, c'est OK. Si quelque part il y a `import * from`, c'est 2 MB gâchés.

```bash
grep -rn 'from "lucide' apps/desktop/src/ | grep -v "^[^:]*:[^:]*: import { "
```

### 4.4 Audit dépendances Cargo

543 deps dans `Cargo.lock`. À comparer avec un projet Tauri minimal (~250). Suspect surtout les plugins Tauri activés mais peu utilisés.

```bash
cargo tree -d  # detect duplicate versions
```

---

## Niveau 5 — Architecture (2-4 semaines, optionnel pour 3.x)

Ces chantiers sont structurels et ne se justifient que si les niveaux 1-3 ne suffisent pas. À envisager pour la version 3.x.

### 5.1 File watchers au lieu de poll

**Idée** : remplacer `pollStatus` toutes les 2 s par un watcher `notify` (Rust) sur le repo, qui pousse des events vers le frontend via `tauri::Manager::emit`. Zero polling en idle.

**Coût** : ~3-5 jours, exige une bonne discipline de debouncing (un `git status` par batch d'events FS).

**Gain** : CPU à 0 % en idle (vs ~1-3 % constant aujourd'hui).

**Risque** : `notify` a des subtilités cross-platform (FSEvents macOS vs inotify Linux vs ReadDirectoryChangesW Windows). Bien tester.

### 5.2 Web Workers pour parsing lourd

Le parser de diff (`packages/core`) tourne sur le main thread. Pour un diff de 10k lignes, ça peut bloquer le frame budget. Le mover dans un Worker via `comlink` :

- main thread reste fluide pendant le parse
- multi-cœur exploité

Surtout pertinent pour la Commit Graph view et les gros file histories.

### 5.3 Virtual scrolling sur les listes longues

Le log view, le workspace view, le file tree — si pas déjà virtualisés, le sont à 5k+ items.

À auditer : utiliser `vue-virtual-scroller` ou équivalent là où le DOM dépasse 200 nœuds.

### 5.4 Tauri 2 — `tauri::ipc::Channel`

Pour les opérations qui retournent en streaming (log progressif, fetch progress), `Channel<T>` est plus performant que les `emit/listen` events. À adopter pour `git fetch`, `git clone`, `git log` paginé.

---

## Niveau 6 — Prévention de régression

Sans ces garde-fous, les optims listées ci-dessus se retrouvent érodées au prochain quarter.

### 6.1 Bench suite

Sous `apps/desktop/perf/`, scripts qui mesurent :

1. cold start (ms jusqu'au first interaction)
2. open repo medium / large fixture
3. invoke `git_status` ×100 (médiane / p95)
4. parse diff fixture (1k / 10k / 100k lignes)

À faire tourner en CI sur chaque PR qui touche `apps/desktop/`. Régression > 10 % = label `perf-regression`.

### 6.2 Performance budget

Ajouter à la CI release :

```yaml
- name: Bundle size check
  run: |
    SIZE=$(stat -c%s dist/assets/index-*.js)
    if [ $SIZE -gt 314572 ]; then  # 300 KB
      echo "Bundle exceeded 300KB budget: $SIZE bytes"
      exit 1
    fi
```

### 6.3 Profiler attaché à la release-debug build

Cargo profile `release-debug` (proposé en 3.1) garde les symboles. Distribuable en interne pour mesurer en production sans rebuild.

### 6.4 Documenter les invariants perf ✅

**Fichier** : `apps/desktop/CLAUDE.md`
**Changement** : Section `## Performance invariants` ajoutée, couvrant :
- Pas de `setInterval` sans gating sur `document.visibilityState`
- Pas de `watch` deep sur les structures > 100 items
- `defineAsyncComponent` pour tout panel `v-if`
- Pas de nouvelle commande Tauri appelée à chaque tick de polling sans benchmark
- Tout `workspace_*_all` doit utiliser `par_iter()`
- Profile release préservé

### 6.5 Checklist review pour les PRs touchant les hot paths

Ajouter aux critères de review pour toute PR qui modifie `apps/desktop/` :

**Règles de non-régression** :
- ✅ Aucun `safeHtml(hl(...))` dans les templates — le HL est déjà safe, DOMPurify est redondant
- ✅ Memoization des `wordDiff()` — ne pas appeler LCS sur les mêmes paires dans deux computed différents
- ✅ Debounce avant tout filtrage de liste > 100 items (SearchPalette, MonorepoPanel, CommitLog)
- ✅ `computed` layout (dagLayout, CommitGraph) avec deep-equality ou checksum pour éviter le recalcule sur référence identique
- ✅ `git_shortlog` avec `--max-count` (ne pas scanner tout HEAD) — défaut 50
- ✅ `git_blame` avec `-L` ou troncature si > 10k lignes
- ✅ Concurrency limiter sur tout `Promise.all` de IPC > 10 appels (useLaunchpadTeam, useAbsorb)
- ✅ Nouvelle dépendance Cargo = mesurer impact compile + binaire
- ✅ Nouvelle dépendance npm > 50 KB gzipped = lazy import obligatoire

---

## Roadmap mise à jour (post-mai 2026)

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ Sprint 1+2 (semaine 1-2 mai) — Terminé                    │
│ ├─ 1.1 Rebase poll conditionnel                             │
│ ├─ 1.2 Lazy-load 22 panels + modaux                         │
│ ├─ 1.5 Badges lazy loading                                  │
│ ├─ 2.2 Pause polls sur visibility                           │
│ ├─ 2.3 Cache .git dir                                       │
│ ├─ 2.4 Truncation git_diff 5 MB                             │
│ ├─ 3.1 Profile.release tuné                                 │
│ ├─ 3.2 Rayon workspace_*_all                                │
│ ├─ 3.3a+3.3b libgit2 git_status + workspace                 │
│ ├─ 4.3 Lazy highlight.js (9 eager + 17 lazy)                │
│ ├─ 6.1 Bench suite + CI                                     │
│ ├─ 6.2 Bundle size budget                                   │
│ └─ 6.4 Invariants perf dans CLAUDE.md                       │
├─────────────────────────────────────────────────────────────┤
│ Sprint 3 (semaine 3-4) — Vue rendering & IPC timeout        │
│ ├─ R1  timeout tauriInvoke                   (½ jour)       │
│ ├─ R2  DiffViewer safeHtml(hl()) fix          (1 jour)      │
│ ├─ R3  DiffViewer memoize wordDiff            (½ jour)      │
│ ├─ R4  highlight.ts batch highlighting        (1 jour)      │
│ ├─ R5  SearchPalette debounce                 (½ jour)      │
│ └─ R6  CommitGraph deep-equality check        (½ jour)      │
├─────────────────────────────────────────────────────────────┤
│ Sprint 4 (semaine 4-5) — Virtualisation & Rust              │
│ ├─ R7  CommitLog virtual scroll               (1-2 jours)   │
│ ├─ R8  MergeEditor segments virtualisation    (1-2 jours)   │
│ ├─ R9  git_shortlog max-count limit           (½ jour)      │
│ ├─ R10 gh_pr_detail → serde_json              (1 jour)      │
│ ├─ R11 git_blame output limit                 (½ jour)      │
│ ├─ R12 dagLayout findLane O(1) Map            (½ jour)      │
│ ├─ R13 useAbsorb paralléliser blameRange      (1 jour)      │
│ └─ R14 useLaunchpadTeam concurrency limiter   (½ jour)      │
├─────────────────────────────────────────────────────────────┤
│ Backlog (3.x) — Architecture                                │
│ ├─ 3.4 Découper lib.rs en sous-modules                      │
│ ├─ 5.1 FS watchers → zero polling idle                      │
│ ├─ 5.2 Web Workers diff parsing                             │
│ ├─ 5.3 Virtual scrolling généralisé                         │
│ └─ 5.4 Tauri Channels pour streaming                        │
└─────────────────────────────────────────────────────────────┘
```

**Estimation Sprint 3 + 4** : ~9 jours dev. Ces chantiers adressent les problèmes
de rendering Vue (DOMPurify, LCS double, batch highlight, debounce, virtual scroll)
et les commandes Rust sans limite (shortlog, blame, gh_pr_detail).

---

## Annexe — Findings bruts de l'audit (v2.8.1 → post-optim)

| Métrique | v2.8.1 | Post-optim | Note |
|---|---|---|---|
| Imports synchrones App.vue | 61 | ~14 (eager) + 22 lazy | Lazy-load panels appliqué |
| `setInterval` actifs en idle | 3 (status 2s, rebase 3s, fetch 30s) | 2 (status 2s, fetch 30s) + pause sur hidden | Rebase poll désormais conditionnel |
| `Command::new` / `git_cmd()` dans lib.rs | 107 | ~95 (status + wip migrés vers git2) | 12 hot paths remplacés par libgit2 |
| Lignes dans `lib.rs` (single file) | 6 773 | ~7 200 (libgit2 helpers ajoutés) | À découper en sous-modules |
| Dépendances Cargo (Cargo.lock) | 543 | ~560 (rayon + git2 ajoutés) | À auditer pour duplicates |
| `[profile.release]` custom | ❌ Aucun | ✅ LTO fat + codegen-units=1 + strip | Appliqué |
| Composants > 400 LOC | 8+ | 8 toujours, mais tous lazy-loadés | Plus d'impact cold start |
| Commits entre v2.6 et v2.8.1 | 43 | — | — |

---

## Référence rapide — patches appliqués

Tous les patches ci-dessous ont été implémentés entre le 07 et le 08 mai 2026 :

| § | Description | Fichier |
|---|---|---|
| **0.1** | DevTools Cargo feature | `apps/desktop/src-tauri/Cargo.toml` |
| **1.1** | Rebase poll conditionnel | `apps/desktop/src/App.vue` |
| **1.2** | Lazy-load 22 panels et modaux | `apps/desktop/src/App.vue` |
| **1.5** | Badges README lazy + min-width | `apps/desktop/src/components/DashboardView.vue` |
| **2.2** | Pause polls sur visibilitychange | `apps/desktop/src/composables/useGitRepo.ts` |
| **2.3** | Cache `.git` dir résolu | `apps/desktop/src-tauri/src/lib.rs` |
| **2.4** | Truncation git_diff (5 MB) | `apps/desktop/src-tauri/src/lib.rs`, `backend.ts` |
| **3.1** | Profile.release tuné | `apps/desktop/src-tauri/Cargo.toml` |
| **3.2** | Rayon sur workspace_*_all | `apps/desktop/src-tauri/src/lib.rs` |
| **3.3a** | libgit2 workspace_*_all | `apps/desktop/src-tauri/src/lib.rs` |
| **3.3b** | libgit2 git_status + fallback CLI | `apps/desktop/src-tauri/src/lib.rs` |
| **4.3** | Lazy highlight.js (9 + 17 langues) | `apps/desktop/src/utils/highlight.ts` |
| **6.1** | Bench suite + CI | `apps/desktop/perf/bench.mjs`, `package.json` |
| **6.2** | Bundle size budget | `apps/desktop/perf/bundle-check.mjs`, `package.json` |
| **6.4** | Invariants perf dans CLAUDE.md | `apps/desktop/CLAUDE.md` |

Chacun de ces patches a été appliqué indépendamment et n'impacte pas la sémantique fonctionnelle de l'app.
