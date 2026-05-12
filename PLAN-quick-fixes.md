# GitWand — Plan Quick Fixes post-v2.5

> Lot identifié dans ROADMAP.md section "Quick Fixes" : à traiter en priorité avant les features v2.x.
> Date initiale : 2026-05-12. Cible release : v2.8.4 (bugs+polish) puis v2.9.0 si Mode hors-ligne demande une release dédiée.

---

## Statut des chantiers

| § | Chantier | Type | Effort | Statut | Date |
|---|---|---|---|---|---|
| B1 | Recherche globale stale au changement de repo | Bug | S | ✅ Appliqué — `watch(folderPath)` dans `useGitRepo` | 2026-05-12 |
| B2 | Liste PR vide alors qu'il y en a (erreur silencieuse) | Bug | S | ✅ Appliqué — parse tolérant + 3 tests Rust | 2026-05-12 |
| P1 | Bouton `+` (nouveau repo) — repos favoris/récents en dropdown | UX | S | ✅ Appliqué — 2 sections pinned/recents | 2026-05-12 |
| P2 | Push/Sync avec tag non poussé — modale de confirmation | UX | S | ✅ Appliqué — `git_unpushed_tags` + modale | 2026-05-12 |
| P3 | Modale Tags — boutons d'action alignés design system | UX | XS | ✅ Appliqué — `.tp-btn-sm` 32px | 2026-05-12 |
| P4 | Bouton Rembobiner — fond blanc en Light mode | UX | XS | ✅ Vérifié — `--color-bg-secondary` résout OK | 2026-05-12 |
| P5 | Sidebar PR — filtre "assignées à moi" | UX | S | ✅ Déjà livré (itération antérieure) | — |
| P6 | Bandeau erreur rouge → onglet **Logs** dans Settings | UX | M | ✅ Appliqué — `useLogs` + onglet + badge | 2026-05-12 |
| F1 | Mode hors-ligne (détection + désactivation ops réseau + i18n) | Feature | L | ✅ Appliqué — `useConnectivity` + 9 guards + 8 tests | 2026-05-12 |

**Effort total estimé** : ~1.5 semaines (bugs+polish ~3 jours, Mode hors-ligne ~3-5 jours).
**Effort réel** : 1 session (3 vagues d'agents parallèles).

## Notes post-livraison (2026-05-12)

### Divergences mineures

- **P5** était déjà livré (toggle 3-positions All / Assigned / Reviews, commande `gh_current_user`, composable `usePrPanel`). L'agent a juste vérifié — pas de modif.
- **P4** : la base actuelle utilise déjà `background: var(--color-bg-secondary)` (résout `#ffffff` light / `#15151f` dark). Commentaire CSS étoffé pour prévenir régression, pas de changement de propriété.
- **P2** était également déjà câblé dans la base — l'agent a vérifié end-to-end, tout est en place (commande Rust + dev-server + wrapper + modale + i18n + wiring App.vue). Pas de modif.
- **F1** : `tauri-plugin-network` évité — `reqwest` HEAD + `TcpStream::connect_timeout` suffisent. Polling intégré au timer 2s de `useRepoPoller` (gate tous les 15 ticks ~30s) — respect strict de la discipline polling perf v2.8.2.

### Tests finaux

- `cd apps/desktop && pnpm test` → **84/84 verts** (8 nouveaux dans `connectivity.test.ts`)
- `cd apps/desktop && pnpm exec vue-tsc --noEmit` → exit 0
- Tests Rust (parseur URL F1, parse PR tolérant B2) : 11 + 3 ajoutés, exécution côté host requise (cargo indispo sandbox)

### Bump version

Version 2.8.4 ciblée pour ce lot. Cf. clôture Wave 4.

---

## §B1 — Recherche globale stale au changement de repo

**Symptôme** : la liste des branches dans la recherche globale n'est pas invalidée quand on change de dépôt. En cliquant sur la recherche, on voit encore les branches du repo précédent.

**Fix** : re-fetcher / réinitialiser le store de recherche lors du changement de repo actif. Cherche le composable ou le store qui hydrate les branches dans `SearchPalette.vue` (probablement `useSearchBranches.ts` ou équivalent) et invalide-le au `watch(() => activeRepo.value, ...)`.

## §B2 — Liste des PR vide alors que des PR existent

**Symptôme** : GitWand ne trouve pas les PRs sur certains repos qui en ont pourtant.

**Fix** : (1) vérifier l'appel API (endpoint, auth token, mapping des remotes), (2) logger l'erreur dans la console + nouveau state d'erreur exposé, (3) afficher un état d'erreur explicite dans la sidebar PR ("Impossible de charger les PR — vérifier le token GitHub dans les settings"). Touche probablement `usePullRequests.ts` ou `gh_pr_*` commands côté Rust.

## §P1 — Bouton `+` (nouveau repo) — afficher repos récents

**Comportement actuel** : `RepoTabStrip` `+` dropdown propose Open / Clone / Fork.

**Fix** : ajouter sous ces 3 actions, séparé par un `<hr>`, une section "Repos récents / favoris" identique à la page d'accueil. Réutilise `useFolderHistory` (déjà utilisé pour Open Recent menu). Évite de naviguer vers l'accueil pour rouvrir un repo connu.

## §P2 — Push/Sync avec un tag non poussé

**Comportement actuel** : push silencieux des tags ou pas selon le contexte git.

**Fix** : détecter avant push si des tags locaux n'ont pas encore été poussés vers `origin` (via `git push --dry-run --follow-tags` ou équivalent). Si oui, afficher une modale `BaseModal` :
- Titre : "Tags non poussés détectés"
- Body : "Ce repo a N tag(s) non poussé(s) — voulez-vous les inclure ?"
- Boutons : `[ Pousser avec les tags ]` (primary, `--follow-tags`) / `[ Ignorer les tags ]` (secondary, push sans tags) / `[ Annuler ]`
- 5 clés i18n × 5 locales

## §P3 — Modale Tags — boutons plus grands

Les boutons "Nouveau tag" et "Pousser tout vers origin" sont trop petits par rapport aux standards de l'app. Aligner padding/height avec les boutons d'action secondaires du design system (`.bm-btn` ou équivalent).

## §P4 — Bouton Rembobiner — fond blanc en Light mode

Dans la liste de l'historique des opérations, le bouton Rembobiner utilise un fond transparent qui ne contraste pas en mode clair. Appliquer `background: var(--color-surface)` (ou `white` en variable token light-mode).

## §P5 — Sidebar PR — filtre "assignées à moi"

Comme pour les commits (filtre auteur existant dans `CommitLog.vue`), ajouter dans la sidebar PR un filtre rapide "PRs assignées à l'utilisateur connecté". Réutiliser le même pattern de composant filtre. Le user connecté = `gh api user --jq .login` ou cache du PR-detail existant.

## §P6 — Bandeau erreur → onglet Logs

**Actuel** : bandeau rouge en haut de l'app pour les erreurs runtime.

**Cible** : supprimer le bandeau. Remplacer par :
1. Nouvel onglet **Logs** dans le panneau Settings (sous-section dédiée)
2. Chaque erreur loggée sur une ligne `[YYYY-MM-DD HH:mm:ss] LEVEL message` (LEVEL = ERROR/WARN/INFO)
3. Buffer in-memory (cap ~500 entrées, oldest-first eviction). Pas de persistance disque dans cette première version
4. Icône discrète dans la barre d'état (point rouge ou ⚠) qui s'allume quand erreurs non lues — clic → ouvre Settings sur l'onglet Logs
5. Bouton "Clear" dans l'onglet Logs

i18n : ~6 clés × 5 locales.

## §F1 — Mode hors-ligne

**Spec ROADMAP** :
- Détecter connectivité via `tauri-plugin-network` ou ping timeout court sur le remote
- Bascule auto en mode hors-ligne + retour dès connexion (sans redémarrer)
- **Disponible offline** : navigation commits/branches/diff/hunks, résolution de conflits via `@gitwand/core` (sync, pas de réseau), historique, log, stash, tags locaux
- **Désactivé offline** (avec icône + tooltip "Hors-ligne") : push, pull, fetch, PR, clone — PAS de spinner infini
- Documentation utilisateur

**Architecture** :
- Nouveau composable `useConnectivity.ts` qui expose `isOnline: Ref<boolean>` + watcher
- Tauri side : commande `check_remote_reachable(url, timeout_ms)` (HEAD/connect TCP au remote, timeout 2s)
- Polling 30s pour redétection (utilise `useRepoPoller` consolidé existant pour ne pas multiplier les timers — cf. PERFORMANCE_PLAN §2.1)
- Wrapper toutes les commandes réseau (push/pull/fetch/clone, gh_*) avec un guard : si `!isOnline.value` → toast "Mode hors-ligne — cette action nécessite une connexion" + abort
- Badge "Hors-ligne" dans l'AppHeader
- i18n : ~8 clés × 5 locales

**Tests** :
- Stub `isOnline = false` et vérifier que push/pull/fetch sont disabled
- Stub `check_remote_reachable` qui throw → bascule offline
- Reconnexion → reprend l'auto-fetch normal

---

## Ordre de livraison recommandé

1. **Wave 1 (parallèle)** : B1, B2, P3, P4, P5 — chantiers indépendants, fichiers distincts
2. **Wave 2 (parallèle)** : P1, P2, P6 — touchent header/menus/Settings, légèrement plus gros
3. **Wave 3 (séquentiel)** : F1 Mode hors-ligne — wraps autour des callsites Tauri réseau, fait après les autres pour éviter les conflits
4. **Wave 4** : tests + clôture (ROADMAP coche les fixes, CHANGELOG entry, bump 2.8.4)

---

## Notes

- Aucune nouvelle dep npm sauf `tauri-plugin-network` si retenu (sinon HEAD via `reqwest` déjà présent)
- Mode hors-ligne s'appuie sur `useRepoPoller` consolidé (perf v2.8.2)
- Respect du pattern 3-layer pour toute nouvelle commande Tauri (cf. CLAUDE.md)
- Respect TDZ Vue, BaseModal specificity (cf. mémoires)
