# GitWand — Plan Navigation Revamp : Workspaces + Launchpad

> Chantier UX : restructuration de l'information architecture après que Workspaces (v2.7) et Launchpad (v2.9) ont tous deux maturé. Effort ~1 journée. Aucune dépendance bloquante. Peut être embarqué dans v2.10 ou livré en patch dédié.

---

## Problème actuel

| Symptôme | Cause racine |
|---|---|
| Pour voir le Launchpad, il faut d'abord ouvrir la modale Workspace | Launchpad est un sous-bouton de `WorkspacePanel.vue` |
| Launchpad est traité comme un sub-feature de Workspace | Construction organique : Workspace (v2.7) livré avant Launchpad (v2.9) |
| Pattern incohérent avec PR | PRs → bouton sidebar → vue principale directe. Launchpad → bouton header → modale → bouton → full-screen. |
| `⌘L` contourne le parcours mais n'est connu que des power users | Raccourci ajouté en v2.9 comme fallback, pas promu |

---

## Cible

```
AVANT (v2.9)                         APRÈS
─────────────────────────────────    ──────────────────────────────────
AppHeader : bouton [Workspace]  →    Sidebar : icône [Launchpad] (badge PRs)
  └─ WorkspacePanel.vue (modale)       └─ viewMode "launchpad" (zone principale)
       └─ bouton [Launchpad]           Sidebar : icône [Workspaces] (gestion)
            └─ LaunchpadView.vue         └─ WorkspacePanel en slide-over ou section sidebar
                 (full-screen modal)
```

**Principe** : Launchpad = vue principale (comme PullRequestPanel). Workspace = gestion de config (Settings-like). Même pattern que PRs.

---

## Statut des chantiers

| § | Chantier | Effort | Statut |
|---|---|---|---|
| 1.1 | App.vue — extend viewModes : `"launchpad"` + `"workspace-manage"` | XS | ⏳ |
| 1.2 | Sidebar — ajouter entrée Launchpad (icône + badge `ghPrCount`) | S | ⏳ |
| 1.3 | Sidebar — ajouter entrée Workspace (icône gestion, sans badge) | XS | ⏳ |
| 1.4 | AppHeader — retirer le bouton Workspace | XS | ⏳ |
| 2.1 | LaunchpadView — retirer `position: fixed; inset: 0` + backdrop | S | ⏳ |
| 2.2 | LaunchpadView — intégrer dans le layout main (padding, scroll) | S | ⏳ |
| 2.3 | WorkspacePanel — retirer le bouton Launchpad embarqué | XS | ⏳ |
| 2.4 | WorkspacePanel — devenir slide-over ou section sidebar (pas full-modal) | M | ⏳ |
| 3.1 | `⌘L` / `Ctrl+L` — rebrancher sur `viewMode = "launchpad"` (déjà câblé en v2.9 via `LAUNCHPAD_OPEN_REQUEST_KEY`) | XS | ⏳ |
| 3.2 | `useAppMenu.ts` — "Open Launchpad" sous View, "Manage Workspaces" sous Repository | XS | ⏳ |
| 4.1 | Tests UI smoke — vérifier la navigation sidebar Launchpad + back | S | ⏳ |
| 4.2 | i18n — clés sidebar : `sidebar.launchpad`, `sidebar.workspaces`, `sidebar.manageworkspaces` × 5 locales | XS | ⏳ |
| 4.3 | ROADMAP + CHANGELOG + bump version | XS | ⏳ |

**Effort total estimé** : ~6-8h (1 journée).

---

## Détail des phases

### Phase 1 — Information architecture (App.vue + Sidebar)

#### §1.1 Extend viewModes

`App.vue` gère `viewMode` (ref string). Ajouter :
- `"launchpad"` → rend `<LaunchpadView>` dans la zone `.main-content`
- `"workspace-manage"` → rend `<WorkspacePanel>` en mode gestion dans la zone principale (ou slide-over léger)

```ts
// App.vue
type ViewMode = "dashboard" | "history" | "pr" | "launchpad" | "workspace-manage" | ...
```

#### §1.2 Sidebar — Launchpad

Dans `RepoSidebar.vue` (ou `AppHeader.vue` si la sidebar est gérée là), ajouter une entrée :
- Icône : la même que le bouton Launchpad actuel (rocket / grid icon)
- Badge : `ghPrCount` (déjà calculé dans `useLaunchpadPrs`) — afficher si > 0
- Active state quand `viewMode === "launchpad"`
- Gating : visible seulement si un workspace est défini (même garde que l'actuel)

Placement : **en dessous** du bouton PRs dans la sidebar, avant Tags.

#### §1.3 Sidebar — Workspace

Entrée secondaire (icône plus petite ou muted) :
- Label "Workspaces" / icône folder-stack
- Ouvre `viewMode = "workspace-manage"`
- Toujours visible (pour créer le premier workspace)

#### §1.4 AppHeader — retrait

Retirer le bouton `[Workspace]` de `AppHeader.vue`. Vérififier qu'aucun autre composant ne dépend de l'event `openWorkspace` qu'il émettait.

---

### Phase 2 — Réintégration des composants

#### §2.1-2.2 LaunchpadView — passer de full-screen modal à vue principale

**État actuel** : `LaunchpadView.vue` utilise `position: fixed; inset: 0; z-index: 50; backdrop-filter: blur(...)` → full-screen overlay.

**Cible** : composant normal dans la zone `.main-content`, comme `DashboardView` ou `PullRequestPanel`.

Changements :
1. Supprimer le wrapper `.launchpad-overlay` avec le positionnement fixe
2. Supprimer le backdrop et le bouton Close (la navigation sidebar joue ce rôle)
3. Ajouter `min-height: 0; overflow-y: auto` pour s'intégrer dans le scroll du layout main
4. Le header Launchpad interne peut rester (titre + tabs + refresh)

**Attention** : vérifier que le drag-scroll horizontal du WIP panel (scroll-snap) fonctionne dans le layout non-modal.

#### §2.3 WorkspacePanel — retrait du bouton Launchpad

```vue
<!-- WorkspacePanel.vue — supprimer -->
<button @click="$emit('openLaunchpad')">Launchpad →</button>
```

Supprimer aussi l'événement `openLaunchpad` émis + le handler dans le parent.

#### §2.4 WorkspacePanel — slide-over ou section

Deux options, par ordre de préférence :

**Option A (recommandée) — Section dans la sidebar** : `WorkspacePanel` devient un panneau inline dans la sidebar (expandable, similaire au Tags panel). Pas de modale du tout. Workspace selector + actions groupées + liste des repos = natif sidebar.

**Option B — Slide-over léger** : panel qui glisse depuis la droite (drawer), sans backdrop noir. Plus d'espace pour la liste des repos. Utilise `BaseModal` en mode `drawer`.

Pour v2.10, **Option A** d'abord (quick win). L'Option B peut suivre si l'Option A manque d'espace.

---

### Phase 3 — Raccourcis & menus

#### §3.1 Rebrancher `⌘L`

En v2.9, `LAUNCHPAD_OPEN_REQUEST_KEY` appelle `openLaunchpad(activeRepos)` qui ouvre le modal full-screen. Après la refonte, ce provide/inject doit setter `viewMode = "launchpad"` au lieu d'ouvrir la modale.

#### §3.2 `useAppMenu.ts`

```
View menu :
  Toggle Light/Dark Mode
  ─────────
  Open Launchpad          ⌘L
  Manage Workspaces       (pas de raccourci)
  Toggle Sidebar          ⌘⇧S
  ─────────
  Enter Full Screen       ⌃⌘F
```

---

### Phase 4 — Tests & release

#### §4.1 Tests UI smoke

Tests à mettre à jour / ajouter dans `LaunchpadView.test.ts` et éventuellement `App.test.ts` :
- Clic sidebar Launchpad → `viewMode === "launchpad"`
- Clic sidebar autre → `viewMode !== "launchpad"`
- `⌘L` → viewMode switch
- Badge PRs visible si `ghPrCount > 0`

#### §4.2 i18n

```ts
// en.ts
sidebar: {
  launchpad: "Launchpad",
  workspaces: "Workspaces",
  manageWorkspaces: "Manage Workspaces",
}
// × fr, es, pt-BR, zh-CN
```

---

## Risques et garde-fous

| Risque | Mitigation |
|---|---|
| `LaunchpadView` a un scroll interne qui entre en conflit avec le scroll du layout main | Tester le WIP panel scroll-snap horizontal après la refonte |
| Des composants tiers appellent encore `openWorkspace` / `openLaunchpad` event | Grepper `openLaunchpad\|openWorkspace` avant de supprimer |
| Tests Wave D mockent `LaunchpadView` en tant que modal | Mettre à jour les mocks pour le nouveau point de montage |
| Homepage redesign pending : la sidebar redessinée pourrait déplacer les icônes | Décider de l'iconographie avant de merged, ou prévoir un suivi |

---

## À considérer en même temps

- **Homepage redesign** (décision toujours en attente) — si un pass UX global est lancé, aligner l'iconographie sidebar avec le pitch `HomeLanding.vue`.
- **Badge PRs** dans la sidebar Launchpad : `ghPrCount` est déjà câblé dans `useLaunchpadPrs`, mais il faudra le sortir du composant pour l'exposer au parent sidebar.
