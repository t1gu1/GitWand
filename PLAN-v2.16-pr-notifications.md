# PLAN v2.16.0 — PR Activity Notifications

> Notifications OS natives pour les évènements de PR (review request, nouveau commentaire, flip CI, merge/close) sans quitter GitWand.

**Rappels transverses** (identiques v2.15.1) : tout ajout backend = 3 couches (Rust `ops.rs`/`gh.rs` + `dev-server.mjs` + wrapper `backend.ts`) ; i18n × 5 locales ; versioning via `./scripts/bump-version.sh` ; `packages/core` zéro-Node ; tests de parité pour toute nouvelle commande.

---

## Ce que l'exploration a confirmé (et corrigé par rapport à la ROADMAP)

La ROADMAP annonçait l'infra « presque prête (`useRepoPoller`, `useLaunchpadPrs`, `useConnectivity`) ; seul manque le diff-snapshot + l'émission OS ». En réalité **deux écarts** changent l'ampleur :

1. **Pas de polling Launchpad de fond.** `useRepoPoller` ne suit que le repo actif et **se met en pause quand la fenêtre est cachée** (`document.hidden`). Or on veut notifier *quand l'app est en arrière-plan*. Le Launchpad (`LaunchpadView.vue`) ne rafraîchit qu'au montage et au clic. → Il faut un **poller dédié Launchpad** qui continue de tourner en arrière-plan.

2. **Les données de PR « légères » ne portent ni CI ni reviews ni commentaires.** Le chemin liste (`workspace_prs_all` → `gh.rs`) renvoie `checks_rollup` et `review_decision` **vides** (allégés en v2.8.5 pour la perf de boot du sidebar), et `PullRequest` n'expose pas de `commentCount`. → Pour notifier sur flip CI / review request / nouveau commentaire, il faut **enrichir `workspace_prs_all`** (`gh pr list --json …,statusCheckRollup,reviewDecision,reviewRequests,comments`). Sinon on ne peut détecter que : nouvelle PR, changement d'état (merged/closed), bump `updatedAt`.

Acquis utilisables tels quels : `useConnectivity` (`isOnline` pour ne pas notifier hors-ligne), `useLogs` (singleton `pushLog(level,msg,ctx)` → onglet Logs), `useSettings` (champ `notifications: boolean` existant), capabilities dans `src-tauri/capabilities/default.json`.

---

## Chantier 1 — Poller Launchpad de fond (front)

- `useLaunchpadPoller.ts` : `setInterval` dédié (~60 s), indépendant de `useRepoPoller`. **Ne se met PAS en pause** quand la fenêtre est cachée (c'est justement là qu'on veut notifier), mais respecte `isOnline` (skip si hors-ligne) et l'activation des notifications.
- À chaque tick : `useLaunchpadPrs.refresh(repos)` → met à jour le snapshot courant (et rafraîchit le Launchpad au passage si ouvert).
- Discipline polling (mémoire `feedback_gitwand_polling_discipline`) : un seul interval, gaté sur `workspace non vide` + `notifications activées` ; cleanup en `onUnmounted`.

## Chantier 2 — Couche diff-snapshot (front)

- `useLaunchpadNotifications.ts` : singleton niveau module. Garde le snapshot précédent (Map `url → {state, updatedAt, checksRollup, reviewDecision, reviewRequested, commentCount}`).
- À chaque refresh, compare ancien/nouveau et produit des évènements typés :
  - `ci-flip` (SUCCESS↔FAILURE), `review-requested` (mon login ajouté à `reviewRequested`), `new-comment` (`commentCount` ↑), `review-decided` (APPROVED / CHANGES_REQUESTED), `merged` / `closed`, `new-pr`.
  - Zéro requête réseau supplémentaire (réutilise les données du poller).
- Filtre « by people » : ignore les évènements dont l'auteur est un bot (`github-actions`, `dependabot`, `renovate`, suffixe `[bot]`).
- Première passe après boot = établissement du snapshot **sans** notifier (pas de rafale au démarrage).

## Chantier 3 — Notifications OS natives (Rust + capabilities)

- Ajouter `tauri-plugin-notification = "2"` (Cargo.toml) + init du plugin (`lib.rs`), permission `notification:default` dans `capabilities/default.json`.
- Wrapper TS `notify(title, body, prUrl)` (3 couches : Tauri `plugin-notification` ; dev-server = no-op/log ; fallback Web Notification en `dev:web`).
- Action au clic → ouvrir le Launchpad sur la PR concernée (réutilise la navigation Launchpad + deep-link par `url`).
- **Gating** : émettre seulement quand `document.hidden` (app en arrière-plan) ; en avant-plan, le Launchpad se met à jour visuellement, pas de notif OS.
- Chaque notif est aussi poussée dans `useLogs` (traçable, onglet Logs).

## Chantier 4 — Réglages de granularité (front + i18n)

- `useSettings` : ajouter `notificationLevel: "all" | "reviews" | "ci" | "none"` (le `notifications: boolean` existant reste le maître on/off, ou est migré). Ajouter `notificationsByPeople: boolean`.
- ⚠️ Mémoire `feedback_gitwand_duplicate_settings_interfaces` : tout nouveau champ doit être ajouté **à la fois** dans `useSettings.ts` (AppSettings) **et** `SettingsPanel.vue` (Settings).
- Section « Notifications » dans `SettingsPanel.vue` : radio All / Reviews & comments / CI failures only / None + toggle « by people ».
- i18n × 5 : `settings.notifications.*`, libellés des évènements pour les titres/corps de notif.

## Chantier 5 — Backend enrichi (conditionnel — voir question de cadrage)

- Si on veut CI/review/comment : enrichir `workspace_prs_all` pour peupler `checks_rollup`, `review_decision`, `review_requested`, et un `comment_count` (nouveau champ `PullRequest` + 3 couches + GitLab/Bitbucket en best-effort).
- Coût : `gh pr list --json` plus lourd, mais sur le poll Launchpad de fond (60 s), acceptable.
- Tests de parité pour le champ enrichi.

## Chantier 6 — Finition release

- Tests : unitaires sur la couche diff (`useLaunchpadNotifications` : chaque transition → bon évènement ; bots filtrés ; pas de rafale au boot) ; parité si backend enrichi.
- Docs : ROADMAP v2.16 → Shipped + CHANGELOG + website/changelog.
- `./scripts/bump-version.sh 2.16.0`.

---

## Ordre conseillé

Backend enrichi (5, si retenu) → Poller (1) → Diff (2) → Notif OS (3) → Settings (4) → Finition (6).
