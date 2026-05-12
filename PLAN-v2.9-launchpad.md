# GitWand — Plan v2.9 Launchpad

> Audit conduit le 2026-05-12 : **~95% implémenté**. Les 5 sous-features (PRs cross-repo, Issues cross-repo, WIP, Pin/Snooze, Vue Équipe) sont livrées, 36/36 tests Launchpad verts, i18n complet × 5 locales, backend Rust complet, dev-server mocks présents.
>
> Reste à faire : closure tactique (raccourci clavier, tests UI, polish UX), une perf concern sur Team tab, et le release wrap.

---

## Statut des chantiers

| § | Chantier | Effort | Statut | Date |
|---|---|---|---|---|
| 0.0 | Audit existant — v2.9 implémenté à 95% | — | ✅ Fait | 2026-05-12 |
| 1.1 | Raccourci clavier `Cmd/Ctrl+L` pour ouvrir Launchpad | S | ⏳ À faire | — |
| 1.2 | Tests UI smoke `LaunchpadView.vue` (4 tabs, ⋮ menu) | S | ⏳ À faire | — |
| 1.3 | Persistance de l'onglet actif entre ouvertures | XS | ⏳ À faire | — |
| 1.4 | Bouton refresh global (rafraîchit toutes les tabs en parallèle) | XS | ⏳ À faire | — |
| 2.1 | Afficher `reviewRequested` / `assignees` dans la row PR | S | ⏳ À faire | — |
| 2.2 | Loading state homogène sur les 4 tabs | XS | ⏳ À faire | — |
| 2.3 | Lazy-load du Team tab (fetch uniquement au clic, pas à `onMounted`) | S | ⏳ À faire | — |
| 3.1 | Polish naming `pr_files` Rust ↔ `ghPrFiles` TS (harmoniser ou doc) | XS | ⏳ À faire — optionnel | — |
| 4.1 | `./scripts/bump-version.sh 2.9.0` | XS | ⏳ À faire | — |
| 4.2 | ROADMAP.md : cocher ✅ v2.9.0 + listing des sous-features livrées | XS | ⏳ À faire | — |
| 4.3 | CHANGELOG.md racine : entrée [2.9.0] détaillée | S | ⏳ À faire | — |
| 4.4 | Website changelog : entrée narrative v2.9.0 | S | ⏳ À faire | — |
| 4.5 | (optionnel) HomeLanding.vue : nouvelle carte feature Launchpad | M | 🟡 Dépend décision redesign pending | — |
| 4.6 | Release notes + tag v2.9.0 | XS | ⏳ À faire | — |

**Effort total estimé** : ~3-4h de dev + 1h release wrap = **demi-journée**.

---

## Constat de l'audit

Ce qui est déjà livré et **green** :

- **PRs cross-repo** — `useLaunchpadPrs.ts` + `workspace_prs_all` Rust + UI badges Draft/Approved/ChangesRequested/CI + per-repo errors
- **Issues cross-repo** — `useLaunchpadIssues.ts` + filtres Assigned/Mentioned/Created + workspace_issues_all Rust
- **WIP panel** — staged/unstaged/untracked, ahead/behind, no-upstream, last commit
- **Pin / Snooze** — module singleton `useLaunchpadPins.ts` (localStorage `gitwand-launchpad-pins`), menu ⋮ par item, badge pin, bandeau snoozés, 4 presets (1/3/7/14j), filtrage prioritaire snooze > pin
- **Vue Équipe** — `useLaunchpadTeam.ts` avec `concurrentMap(5)` rate-limit-safe, détection overlap (mes WIP files OU mes commits non mergés ∩ files des PRs colleagues), avatars couleurs déterministes, auto-expand des membres avec overlap, identité cachée via `ghCurrentUser`
- **i18n** : ~30 clés Launchpad × 5 locales (en/fr/es/pt-BR/zh-CN)
- **Backend Rust** : `workspace_wip_all`, `workspace_prs_all`, `workspace_issues_all`, `gh_current_user`, `pr_files` — tous registered dans `lib.rs:322-353`
- **Dev-server mocks** : tous les endpoints `/api/workspace-*` et `/api/pr-files`
- **Tests** : 36/36 verts (8 pins, 8 prs, 9 issues, 4 wip, 7 team)

---

## Phase 1 — Closure tactique

### §1.1 Raccourci clavier `Cmd/Ctrl+L`

Actuellement Launchpad ouvre uniquement depuis le bouton "Launchpad" dans `WorkspacePanel.vue`. Pour une feature de ce niveau (dashboard global), un raccourci clavier global s'impose.

**Implémentation** :
- Étendre `useAppMenu.ts` (la barre menu macOS native) avec un item "Open Launchpad" sous le menu **View** (au-dessus de "Toggle Sidebar"), raccourci `⌘L` (macOS) / `Ctrl+L` (Linux/Windows).
- Ajouter le `provide/inject` standard `LAUNCHPAD_OPEN_REQUEST_KEY` que `App.vue` watch pour ouvrir `openLaunchpad(activeRepos)`.
- Gating : disabled si pas de repo ouvert OU pas de workspace défini (le Launchpad a besoin d'une liste de repos).
- i18n : 1 nouvelle clé `menu.openLaunchpad` × 5 locales.

### §1.2 Tests UI smoke `LaunchpadView.vue`

Aucun test composant aujourd'hui — uniquement les composables. Risque de régression UI silencieuse.

**Tests minimaux** (vitest + `@vue/test-utils` déjà présents) :
- Monter `LaunchpadView` avec une liste de repos mockée et des composables stubbés
- Assertion : 4 boutons de tab visibles (WIP / PRs / Issues / Team), tab WIP active par défaut
- Click sur tab PRs → `activeTab === "prs"`, panel PRs rendu, `refreshPrs` appelé
- Click sur menu ⋮ d'un PR → dropdown visible avec Pin + Snooze submenu
- Click sur Pin → `useLaunchpadPins.pin()` appelé avec le bon `url`
- Click sur bouton ✕ → emit `close`
- ~6 tests, fichier `apps/desktop/src/components/__tests__/LaunchpadView.test.ts`

### §1.3 Persistance de l'onglet actif

`activeTab` est reset à `"wip"` à chaque ouverture (`LaunchpadView.vue:35`). Si l'utilisateur ferme le Launchpad sur la tab "Équipe" et le rouvre, il retombe sur "WIP". Ennuyeux.

**Fix** : `activeTab` devient un ref persisté via `useSettings.ts` (ou un store global dédié `useLaunchpadPrefs.ts` si on veut séparer). Default `"wip"` au premier lancement, ensuite sauvegarde sur change. Pas de localStorage direct — utiliser le pattern existant `useSettings` qui écrit dans `.gitwandrc` ou store Pinia (cherche le pattern).

### §1.4 Bouton refresh global

`handleRefresh` actuellement rafraîchit uniquement l'onglet actif. Un bouton "Tout rafraîchir" serait utile pour les workflows "je reviens de pause, montre-moi tout".

**Fix** : ajouter un bouton secondaire "Refresh all" à côté du bouton refresh actuel (ou le remplacer si le current ne sert qu'à l'active tab) qui appelle `refreshWip(repos)`, `refreshPrs(repos)`, `refreshIssues(repos)`, `refreshTeam(repos)` en parallèle via `Promise.all`. État loading combiné.

i18n : 1 nouvelle clé `launchpad.refreshAll` × 5 locales.

---

## Phase 2 — Polish UX

### §2.1 Afficher `reviewRequested` / `assignees` dans la row PR

Les types ont les champs (`PullRequest.reviewRequested: string[]`, `assignees: string[]`), récupérés depuis `gh pr list --json`, mais non rendus dans la row. Spec ROADMAP dit "statuts CI, **reviewers**, labels" — les reviewers manquent visuellement.

**Fix** : sous la title row, ajouter une ligne secondaire :
- Avatars (initiales ou couleur déterministe) des `assignees` (max 3 + "+N more")
- Pastille "Reviewers needed: @alice @bob" si `reviewRequested.length > 0`
- Skip si vide (no clutter)

i18n : 2 nouvelles clés `launchpad.assignedToShort` (placeholder), `launchpad.reviewersNeeded` × 5 locales.

### §2.2 Loading state homogène

Audit note : Team tab a un état "Loading…" mais PRs/Issues/WIP n'ont rien de visible — l'utilisateur voit un tab vide pendant ~2s sur premier load.

**Fix** : ajouter un spinner discret (réutiliser celui qui existe dans `BaseModal` ou ailleurs) sur les 4 tabs pendant `loadingPrs.value || loadingIssues.value || loadingWip.value || loadingTeam.value`. Cohérent visuellement.

### §2.3 Lazy-load Team tab

Audit alerte : la Team tab fait, au load, :
1. 1 appel `gh api user` (cache global, OK)
2. N appels `gh pr files` (1 par PR colleague) — pas cached, ré-exécuté à chaque refresh
3. `concurrentMap(limit=5)` limite à 5 en parallèle, mais reste 1×N calls

Sur un workspace avec 50 PRs colleagues, c'est 10 secondes de fetch même avec parallélisation. Aujourd'hui Team tab `refresh` se déclenche au mount → boot perceptiblement plus lent.

**Fix** : `refreshTeam(repos)` n'est PAS appelé dans `onMounted`, seulement au premier clic sur l'onglet Team. Pattern miroir de ce qu'on a fait pour `PullRequestPanel.vue` en v2.8.5. Une fois fetché, garde le cache pour les ouvertures suivantes (invalide sur refresh manuel ou changement de workspace).

Bonus : ajouter un toggle dans `SettingsPanel.vue` "Désactiver Team tab" pour les utilisateurs qui ne veulent jamais le fetch (perf-sensitive setups, équipes solo).

---

## Phase 3 — Optionnel (différable)

### §3.1 Polish naming `pr_files` ↔ `ghPrFiles`

L'audit note un naming inconsistant : la commande Rust s'appelle `pr_files` (sans préfixe `gh_`) alors que toutes les autres commandes `gh` sont préfixées (`gh_list_prs`, `gh_create_pr`, etc.). Le wrapper TS s'appelle `ghPrFiles` qui re-introduit le préfixe.

**Options** :
- (A) Renommer côté Rust en `gh_pr_files` (harmonisation, mais c'est un breaking change pour les éventuels callers externes — peu probable)
- (B) Ajouter un commentaire dans `commands/ops.rs:2161` expliquant pourquoi le préfixe est absent

Aller (B) — minimal effort, zero risk.

---

## Phase 4 — Release v2.9.0

### §4.1 Bump version

```bash
./scripts/bump-version.sh 2.9.0
```

(et vérifier Cargo.lock + CLAUDE.md table).

### §4.2 ROADMAP.md

Cocher v2.9.0 ligne 660 :
```markdown
### v2.9.0 — Launchpad ✅ (livré 2026-05-12)
```

Étoffer la sous-section avec les fichiers livrés (miroir du pattern utilisé pour v2.7.0, v2.8.0).

### §4.3 CHANGELOG.md racine

Nouvelle entrée [2.9.0] :
- **Added** : 5 sous-features Launchpad (PRs/Issues/WIP/Pin-Snooze/Team), raccourci clavier `⌘L`, tests UI smoke
- **Changed** : Team tab maintenant lazy-loaded au premier clic, activeTab persisté entre ouvertures, bouton "Refresh all"
- **Fixed** : (rien de nouveau — la closure ne corrige pas de bug pré-existant)

### §4.4 Website changelog

Entrée narrative dans le style existant (~3-4 paragraphes) :
- Hook : "GitWand obtient son tableau de bord cross-repo — Launchpad — inspiré de GitKraken mais local-first"
- Les 4 onglets : WIP, PRs, Issues, Équipe — ce que chacun montre, comment ils s'agrègent depuis le workspace
- Pin / Snooze : le pattern de personnal triage
- Vue Équipe : la détection de chevauchement (mes WIP + mes commits vs PRs des collègues)
- Performance note : Team tab lazy au clic, refresh all en parallèle

### §4.5 HomeLanding.vue (différé)

🟡 Bloqué par la décision homepage redesign pending (cf. mémoire `project_homepage_redesign.md`). Ajouter une carte feature Launchpad sera fait dans le redesign complet, pas en patch.

### §4.6 Release notes + tag

```bash
git add -A
git commit -m "feat(v2.9): Launchpad release — cross-repo PRs/issues/WIPs/Team + pin/snooze"
git tag -a v2.9.0 -m "v2.9.0 — Launchpad"
git push origin main v2.9.0
```

---

## Notes & risques

- **Perf Team tab** (§2.3) : critique pour les utilisateurs avec un workspace gros. Lazy-load doit être priorité Phase 2.
- **Pas de redesign HomeLanding** dans cette release — assumé. La carte feature Launchpad attendra le pass complet.
- **Tests Vue UI** : 0 aujourd'hui — pas un blocker pour ship mais nice-to-have pour la maintenance. Phase 1.2 ajoute le minimum vital.
- **Workspace requirement** : Launchpad nécessite un workspace v2.7 défini. Si l'utilisateur n'a pas créé de workspace, le bouton dans `WorkspacePanel.vue` n'est pas visible. Le raccourci `⌘L` (§1.1) doit gérer ce cas (toast "Crée d'abord un workspace pour utiliser Launchpad" + ouvrir WorkspacePanel).
- **Cargo.lock sync** : `bump-version.sh` regex peut louper Cargo.toml si pré-existing drift (cf. bug v2.8.3 → 2.8.4). Vérifier manuellement.

---

## Ordre de livraison recommandé

1. **Wave 1 (parallèle)** : §1.1 (raccourci), §1.3 (tab persistance), §1.4 (refresh all) — chantiers UX indépendants
2. **Wave 2** : §1.2 (tests UI smoke) — après Wave 1 pour tester les nouveaux ajouts
3. **Wave 3 (parallèle)** : §2.1 (reviewers/assignees row), §2.2 (loading state), §2.3 (lazy Team)
4. **Wave 4** : §4.1 → §4.6 (release wrap)

Total : ~4h de dev + 1h release = **une demi-journée bien remplie**.
