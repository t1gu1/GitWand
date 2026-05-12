# GitWand — Plan Homepage Redesign

> Décision du 2026-05-03 (mémoire `project_homepage_redesign.md`) : refonte de `website/.vitepress/theme/HomeLanding.vue` pour résoudre le "effet liste à la Prévert" (~20 cartes features de poids identique, aucune hiérarchie).
> Décision du 2026-05-12 : on n'attend plus l'alternative Claude Design, on attaque sur la base de la proposition du 3 mai + intégration des features livrées depuis (v2.5 LLM fallback tie-in, v2.7 Workspaces, v2.8.x Mode hors-ligne + Logs, v2.9 Launchpad).

---

## Statut des chantiers

| § | Chantier | Effort | Statut | Date |
|---|---|---|---|---|
| 0.0 | Audit HomeLanding actuel (21 features flat, 2748 lignes, 5 locales) | — | ✅ Fait | 2026-05-12 |
| 1.1 | Section "3 Pillars" sous le Hero | M | ⏳ À faire | — |
| 1.2 | Démo conflit remontée juste après Pillars | XS | ⏳ À faire | — |
| 2.1 | Découpe des 21 features en 4 catégories logiques | S | ⏳ À faire | — |
| 2.2 | Composant "Tabs" interactif pour la section features | M | ⏳ À faire | — |
| 2.3 | Ajout 5 features manquantes (Launchpad, LLM fallback, Workspaces, Offline, Logs) | M | ⏳ À faire | — |
| 3.1 | Section "New in v2.9" mise en avant (au-dessus des Tabs) | S | ⏳ À faire | — |
| 3.2 | Polish typography / spacing / dark mode parity | S | ⏳ À faire | — |
| 4.1 | i18n : nouveau libellés × 5 locales | M | ⏳ À faire | — |
| 4.2 | OG image / meta description update si nécessaire | XS | ⏳ À faire — optionnel | — |
| 5.1 | Build VitePress + smoke test (`pnpm --filter gitwand-website build`) | XS | ⏳ À faire | — |
| 5.2 | CHANGELOG website : noter la refonte | XS | ⏳ À faire | — |
| 5.3 | Bump version website si convention | XS | ⏳ À faire — optionnel | — |

**Effort total estimé** : ~1 journée (5-7h).

---

## Audit du HomeLanding actuel

**Fichier** : `website/.vitepress/theme/HomeLanding.vue` — 2748 lignes, 5 langues (en/fr/es/pt-BR/zh-CN) en inline objects.

**Structure actuelle** :
```
Hero (title + sub + 2 CTAs)
  ↓
Stats row (resolved %, time saved, etc.)
  ↓
Section "Conflict resolution" (before/after demo)
  ↓
Section flat de 21 feature cards :
  featResolve, featPR, featAIMerge, featFolderTree, featWorktrees,
  featSubmodules, featTags, featImgDiff, featSplitCommit, featDiff,
  featFileHistory, featHistory, featCommitCtx, featTrailers, featForkWorkflow,
  featAIPR, featAIFlow, featPerf, featUI, featMcp, (+1 misc)
  ↓
Section MCP server (l'agent IA dans la boucle)
  ↓
Download section (per-platform)
  ↓
Footer
```

**Diagnostic** :
1. **Hiérarchie plate** — Les 21 cartes ont toutes le même poids visuel. L'utilisateur ne sait pas par où commencer ni ce qui distingue le produit.
2. **Pas de pilliers** — Le pitch "automatic conflict resolution + native perf + AI-native" n'est jamais articulé comme tel ; il est dilué dans 21 features.
3. **Features manquantes** depuis le redesign-memo (3 mai 2026) — 5 majeures à ajouter :
   - **Launchpad** (v2.9.0, 2026-05-12) — dashboard cross-repo, headliner naturel pour la pile workspace
   - **LLM fallback tie-in** (v2.5/v2.8.3) — résolution LLM opt-in desktop/CLI/MCP, complète l'angle AI-native
   - **Workspaces multi-repo** (v2.7) — prérequis du Launchpad mais valeur propre
   - **Mode hors-ligne** (v2.8.4) — différenciateur quality-of-life
   - **Logs panel** (v2.8.4) — moins critique mais distingue le produit du concurrent
4. **Démo conflit enfouie** — Elle est après les stats et avant les features ; devrait être l'élément le plus visible après le Hero.
5. **Section MCP isolée** — Bien faite mais déconnectée du reste ; intégrer dans le pilier "AI-native".

---

## Phase 1 — Structure : 3 Pillars + Démo remontée

### §1.1 Section "3 Pillars" sous le Hero

Trois grandes cartes côte-à-côte (desktop : `grid-template-columns: repeat(3, 1fr)` ; mobile : stack). Chacune avec icône SVG inline (24×24, `currentColor`), titre, sub-title court, et une stat ou un fait clé.

**Pilier 1 — Conflict resolution automatique**
- Title : "Auto-resolve 95 % of trivial conflicts"
- Sub : "10 deterministic patterns. Composite confidence scoring. Decision traces."
- Stat : "95 %" en gros chiffre
- CTA inline : "See the engine →" (lien vers `/guide/conflict-resolution`)

**Pilier 2 — Native performance**
- Title : "Tauri 2 + Rust. Fast cold start, native feel."
- Sub : "Lazy-loaded panels, libgit2 fast-path, polling discipline. No Electron bloat."
- Stat : "<1 s" cold start (à vérifier sur métrique réelle)
- CTA inline : "Why native →" (lien vers blog post si existant, sinon `/guide/desktop`)

**Pilier 3 — AI-native, opt-in**
- Title : "AI assists where humans get stuck"
- Sub : "LLM fallback for complex hunks. MCP server for agents. Always opt-in, always audited."
- Stat : "Sonnet ~$0.015/hunk" ou "Claude / OpenAI / Ollama"
- CTA inline : "AI fallback guide →" (lien vers `/guide/llm-fallback`)

### §1.2 Démo conflit remontée

Le bloc before/after actuel (~lignes 800-1000 de HomeLanding) est déplacé pour apparaître **juste après les 3 Pillars**, avant la section tabbed features. Pas de changement de contenu — juste l'ordre dans le template.

---

## Phase 2 — Features en 4 onglets

### §2.1 Découpe des 21 features en 4 catégories

**Tab 1 — Core Git** (workflow quotidien)
- featResolve · featPR · featDiff · featFolderTree · featSplitCommit · featTags

**Tab 2 — Power user** (workflows avancés)
- featWorktrees · featSubmodules · featFileHistory · featHistory · featCommitCtx · featForkWorkflow

**Tab 3 — AI** (intelligence augmentée)
- featAIMerge · featAIPR · featAIFlow · featTrailers · featMcp · featCommitCtx (overlap — peut basculer ici)

**Tab 4 — New in v2.9** (sera renommé `New in vX.Y` à chaque release majeure)
- **Launchpad** (cross-repo dashboard) — NEW
- **LLM fallback** (resolveAsync + UI trace) — NEW
- **Workspaces** (multi-repo grouping) — NEW
- **Mode hors-ligne** (probe-based, no spinners) — NEW
- **Logs panel** (in-app error log) — NEW
- featImgDiff (déjà là mais récent v1.6.2)
- featPerf (récent perf hardening v2.8.2)
- featUI (déjà là, design pass récent)

Chaque tab garde ~6-8 cartes. Le poids visuel global est divisé par 4 ; l'utilisateur peut explorer par centre d'intérêt.

### §2.2 Composant Tabs interactif

Implémentation Vue 3 simple, scoped à HomeLanding :

```vue
<script setup lang="ts">
const activeTab = ref<"core" | "power" | "ai" | "new">("new"); // default = New, pour highlight les sorties récentes
</script>

<template>
  <section class="hl-features">
    <h2 class="hl-features__title">{{ t.featTitle }}</h2>
    <div class="hl-features__tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="{ 'hl-features__tab--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="hl-features__grid">
      <article v-for="card in featuresForTab(activeTab)" :key="card.id" class="hl-feature-card">
        <!-- icône SVG inline + title + desc -->
      </article>
    </div>
  </section>
</template>
```

État `activeTab` persisté en localStorage si on veut (`gitwand-homepage-tab`) — discutable, peut perturber l'analytics si on en avait. À voir.

Animation : transition CSS sur opacity + transform sur les cards à chaque switch (~150ms ease-out). Pas de JS animation.

### §2.3 Ajout des 5 features manquantes

Pour chaque feature manquante, écrire :
- Icône SVG inline 24×24 (réutiliser ce qui existe dans le repo ou simple)
- Title court (3-5 mots) × 5 locales
- Desc 1-2 phrases × 5 locales

**Launchpad**
- Icon : 4-tabs/dashboard grid
- Title EN : "Launchpad — cross-repo dashboard"
- Desc EN : "Aggregate PRs, issues, WIP, and team activity across every repo in a workspace. Pin, snooze, lazy team enrichment."

**LLM fallback**
- Icon : sparkle ou neural network
- Title EN : "LLM fallback for complex hunks"
- Desc EN : "Opt-in resolution via Claude / OpenAI / Ollama / MCP. Validated through the same parse-tree pipeline as deterministic patterns. Decision trace and reject button included."

**Workspaces**
- Icon : folder-grid
- Title EN : "Multi-repo workspaces"
- Desc EN : "Group repos by project, client, or squad. Fetch all, pull all, status all in one click. Local-first — no cloud, no account."

**Mode hors-ligne**
- Icon : wifi-off
- Title EN : "Offline mode"
- Desc EN : "Probe-based connectivity. Network ops degrade gracefully, local ops keep working. No infinite spinners."

**Logs panel**
- Icon : list-warning
- Title EN : "In-app error log"
- Desc EN : "Errors no longer hijack the header. Browse 500-entry timestamped log in Settings, with unread-count indicator."

---

## Phase 3 — Highlight + Polish

### §3.1 Section "New in v2.9" mise en avant

Avant les tabs, une **bandeau bonus** large qui met en valeur le tab "New" :
- Background subtil `--brand-color-soft` ou `gradient`
- Title "New in v2.9 — Launchpad"
- 2-3 lignes de description courte
- CTA "See the new release →" lien vers `/blog/v2-9-launchpad` (à créer si pas encore là)

Cliquer sur le bandeau bascule directement le tab Features sur "New".

### §3.2 Polish typography / spacing / dark mode

- Vérifier hierarchy : H1 hero > H2 pilliers > H2 features > H3 carte feature
- Espacement vertical entre sections : `var(--space-12)` ou équivalent VitePress
- Dark mode : test que tous les tokens résolvent OK (VitePress a son propre `.dark` class — vérifier que les CSS variables qu'on utilise sont définies dans les deux modes)
- Largeur max du content : aligner sur les autres pages VitePress (`max-width: 1152px` typiquement)
- Test mobile : grid `repeat(3, 1fr)` Pilliers devient `1fr` en `<768px`, features grid `2fr` ou `1fr`

---

## Phase 4 — i18n

### §4.1 Nouveaux libellés × 5 locales

Estimation des entrées i18n à ajouter ou réviser :

| Catégorie | Clés | Note |
|---|---|---|
| 3 Pillars | 9 clés (3 × {title, sub, ctaLabel}) | + 3 stats inline |
| Tabs | 5 clés (1 label par tab + 1 fallback aria) | |
| Features nouvelles | 10 clés (5 × {title, desc}) | Launchpad / LLM fallback / Workspaces / Offline / Logs |
| New release bandeau | 3-4 clés | title, sub, cta |
| **Total nouveau** | **~30 clés × 5 locales = ~150 entrées** | |

Stratégie : commencer par EN (langue source), copier vers FR (langue native Laurent), traduire ES/PT-BR/ZH-CN. Traductions humainement supervisées vu que c'est marketing.

Vérifier qu'on ne **double-pas** les clés existantes : `featResolve`, `featPR`, etc. déjà traduits ne doivent pas être retraduits — juste re-grouper sous les tabs.

### §4.2 OG image / meta (optionnel)

- Vérifier `og:image`, `og:description` dans `index.md` ou config VitePress
- Si le redesign change le "claim" central (de "auto-resolve" à "auto-resolve + native + AI"), ajuster

---

## Phase 5 — Build, release notes, bump

### §5.1 Build VitePress

```bash
cd website && pnpm build
# OU
pnpm --filter gitwand-website build
```

Vérifier :
- Pas d'erreur build
- Les pages générées rendent correctement (smoke test : ouvrir `dist/index.html` localement)
- Pas de broken link interne (VitePress logue les `dead links` au build)

### §5.2 CHANGELOG website

Ajouter une entrée dans `website/changelog.md` (séparée du CHANGELOG.md racine — le site a son propre changelog en narratif) :
- "Homepage redesign — from 21 flat cards to 3 Pillars + 4 tabs"
- Brief sur la nouvelle structure (3 pilliers, démo remontée, tabs interactifs, 5 nouvelles cartes pour features post-v2.5)

### §5.3 Bump website (optionnel)

`website/package.json` a sa propre version (actuellement `2.0.1`). Le bump-version.sh global la touche-t-il ? Vérifier — si oui, c'est déjà à 2.9.0. Si non, décider d'aligner ou de continuer le tracking séparé.

---

## Ordre de livraison recommandé

1. **Wave 1** : §1.1 (3 Pillars structure) + §1.2 (démo remontée) — visible diff immédiat
2. **Wave 2** : §2.2 (composant Tabs) + §2.1 (regrouper features existantes) — structure tab fonctionnelle
3. **Wave 3** : §2.3 (5 nouvelles features) + §3.1 (bandeau "New") — contenu complet
4. **Wave 4** : §3.2 (polish) + §4.1 (i18n × 5 locales en masse) — finition
5. **Wave 5** : §5.1 (build smoke) + §5.2 (changelog website) — release wrap

**Si manque de temps** : la Wave 3 (nouvelles features) peut être faite après Waves 1-2 dans une PR séparée, pour shipper la nouvelle structure d'abord.

---

## Risques & décisions à prendre

- **Décision tab par défaut** : "New in v2.9" ou "Core Git" ? "New" met en avant le neuf (engageant pour visites fréquentes) ; "Core" sert mieux les premiers visiteurs. Recommandation : **Core Git par défaut** mais bandeau "New" très visible au-dessus.
- **Démo conflit existante** : doit-on la garder telle quelle ou la rafraîchir ? Elle est encore très bien faite techniquement. Garder, juste la remonter.
- **Section MCP existante** : la fondre dans le pilier 3 (AI-native) ou la garder en section séparée plus bas ? Si fondue, on perd la mise en valeur (4 étapes du workflow agent). Recommandation : **fondre l'intro dans le pilier 3, mais garder le step-by-step détaillé en section dédiée plus bas**, hors des tabs.
- **Animations** : combien d'animations CSS sur le scroll ? Pas surcharger — un fade-in léger sur scroll-into-view pour les Pillars et les cards features suffit. Pas de JS lourd, IntersectionObserver minimal.
- **Mesure d'impact** : pas d'analytics setup dans le scope d'origine (cf. spec d'avril). Si on veut mesurer si le redesign convertit mieux, faut câbler GA4 ou Plausible — décision à part.

---

## Notes finales

- Garder la cohérence avec la **modale fullscreen pattern** appliqué à Launchpad : design system unifié = expérience cohérente entre site marketing et produit
- L'éventuelle restructuration UX **Workspaces + Launchpad** (cf. mémoire `project_gitwand_workspaces_launchpad_ux.md`) est complémentaire mais indépendante — pas un blocker pour le redesign homepage
- Une fois cette refonte livrée, la mémoire `project_homepage_redesign.md` peut être archivée comme "implémentée"
