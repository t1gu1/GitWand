# GitWand — Plan v2.10 Forge integrations + MCP catalog

> Ouvre GitWand aux utilisateurs non-GitHub et à l'écosystème MCP grandissant. Deux pistes parallèles : **Forge** (GitLab + Bitbucket + multi-compte) et **MCP catalog in-app** (naviguer et installer des serveurs MCP depuis GitWand). Effort estimé ~3-4 semaines.

---

## Périmètre

| Piste | Sous-feature | Priorité |
|---|---|---|
| **Forge** | GitLab MRs (list, review, merge) | P0 |
| **Forge** | Bitbucket Cloud PRs | P1 |
| **Forge** | Multi-compte GitHub + GitLab | P1 |
| **Forge** | Draft PR → Ready to review | P2 |
| **MCP catalog** | Browsing + recherche du registry | P0 |
| **MCP catalog** | One-click install → `.mcp.json` / `claude_desktop_config.json` | P0 |
| **MCP catalog** | Installed vs available + badge "Official" | P1 |

---

## Statut des chantiers

| § | Chantier | Effort | Statut |
|---|---|---|---|
| **Forge — Abstractions** | | | |
| 1.1 | Interface `ForgeProvider` (TypeScript) — contrat commun list/get/merge/comment | M | ⏳ |
| 1.2 | Refactoring `gh*` existant derrière `GitHubProvider implements ForgeProvider` | L | ⏳ |
| 1.3 | `ForgeRegistry` — détection auto du forge depuis `git remote get-url origin` | S | ⏳ |
| **Forge — GitLab** | | | |
| 2.1 | Auth GitLab : Personal Access Token (PAT) + OAuth PKCE | M | ⏳ |
| 2.2 | `GitLabProvider` — list MRs, get MR detail, list diff hunks | L | ⏳ |
| 2.3 | `GitLabProvider` — approve / request changes / merge | M | ⏳ |
| 2.4 | `GitLabProvider` — commentaires inline + threads | M | ⏳ |
| 2.5 | UI : détection GitLab + swap du panneau PR → MR | S | ⏳ |
| 2.6 | CI status GitLab (pipelines) dans `PrDetailView` | S | ⏳ |
| **Forge — Bitbucket** | | | |
| 3.1 | Auth Bitbucket Cloud : OAuth 2.0 App Password | M | ⏳ |
| 3.2 | `BitbucketProvider` — list PRs, get detail, diff | L | ⏳ |
| 3.3 | `BitbucketProvider` — approve / merge + commentaires | M | ⏳ |
| 3.4 | UI : détection Bitbucket + adaptation labels (PR vs MR) | S | ⏳ |
| **Forge — Multi-compte** | | | |
| 4.1 | `AccountRegistry` — stocker N comptes par forge (keychain macOS / libsecret Linux / Windows Credential Manager) | L | ⏳ |
| 4.2 | UI Settings > Accounts : ajouter / retirer / switcher compte actif par forge | M | ⏳ |
| 4.3 | Sélecteur de compte dans la modale de création PR/MR | S | ⏳ |
| **Forge — Draft PR** | | | |
| 5.1 | `convertDraftToReady` backend 3-couches (GitHub `gh pr ready`, GitLab API PATCH) | S | ⏳ |
| 5.2 | Bouton "Mark as ready" dans `PrDetailView` — visible si `isDraft === true` | XS | ⏳ |
| **MCP catalog** | | | |
| 6.1 | Fetch + cache du registry MCP officiel (API publique) | S | ⏳ |
| 6.2 | Onglet "MCP" dans `SettingsPanel.vue` — liste, recherche, catégories | M | ⏳ |
| 6.3 | Détection des serveurs installés (`~/.claude/mcp.json`, `.mcp.json` local, Cursor config) | M | ⏳ |
| 6.4 | One-click install : générer/merger `.mcp.json` ou `claude_desktop_config.json` cible | M | ⏳ |
| 6.5 | Carte `@gitwand/mcp` épinglée en haut avec statut de connexion live | S | ⏳ |
| 6.6 | Badge "Official" (entrées indexées MCP Registry) vs "Community" | XS | ⏳ |
| **Infrastructure** | | | |
| 7.1 | Tests unitaires `ForgeProvider` (contrat) + stubs GitLab/Bitbucket | L | ⏳ |
| 7.2 | i18n : ~30 nouvelles clés × 5 locales | S | ⏳ |
| 7.3 | ROADMAP + CHANGELOG + bump-version 2.10.0 | XS | ⏳ |

**Effort total estimé** : ~3-4 semaines de dev solo (Forge = ~2.5 sem, MCP catalog = ~1 sem, infra = ~0.5 sem).

---

## Architecture

### Interface `ForgeProvider`

Contrat commun implémenté par `GitHubProvider`, `GitLabProvider`, `BitbucketProvider` :

```ts
interface ForgeProvider {
  name: "github" | "gitlab" | "bitbucket"
  detectFromRemote(remoteUrl: string): boolean
  
  // PRs / MRs
  listPRs(opts: ListPRsOptions): Promise<PullRequest[]>
  getPR(id: string): Promise<PullRequestDetail>
  createPR(data: CreatePRInput): Promise<PullRequest>
  mergePR(id: string, opts: MergeOptions): Promise<void>
  convertDraftToReady(id: string): Promise<void>
  
  // Review
  listComments(prId: string): Promise<ReviewComment[]>
  createComment(prId: string, data: CommentInput): Promise<ReviewComment>
  submitReview(prId: string, verdict: "approve" | "request_changes" | "comment"): Promise<void>
  
  // CI
  getCIStatus(prId: string): Promise<CIStatus[]>
}
```

`ForgeRegistry` détecte le forge depuis `origin` :
- `github.com` → `GitHubProvider`
- `gitlab.com` ou instance auto-hébergée (`gitlab.*`) → `GitLabProvider`
- `bitbucket.org` → `BitbucketProvider`

### Couche d'auth

Chaque provider déclare `AuthMethod[]` et délègue le stockage de token à `useCredentials.ts` (nouveau composable wrappant le keychain Rust).

```ts
// Rust — nouveau module commands/credentials.rs
get_credential(service: string, account: string) -> Result<String>
set_credential(service: string, account: string, value: String) -> Result<()>
delete_credential(service: string, account: string) -> Result<()>
```

Utilise `security` CLI sur macOS, `libsecret` sur Linux, `wincred` sur Windows — via le crate `keyring 2.x` (déjà dans l'écosystème Tauri).

### GitLab — points d'attention

- L'API GitLab REST v4 couvre tout le scope visé (`/projects/{id}/merge_requests`, `/notes`, `/approvals`)
- Différences terminologiques : MR (pas PR), "approve" vs "request changes" → adapter les labels i18n (`pr.*` vs `mr.*` conditionnels selon le provider)
- Pipelines CI : endpoint `/merge_requests/{iid}/pipelines` — mapper sur `CIStatus[]` existant
- Pagination cursor-based (pas d'offset) — adapter `useLaunchpadPrs` si on veut le support workspace multi-repo

### Bitbucket — points d'attention

- Auth : App Passwords (simples, pas d'OAuth UI à implémenter)
- API Bitbucket Cloud REST 2.0 — nomenclature identique à GitHub sur les points clés
- Pas de CI natif (Bitbucket Pipelines est un service tiers) → `CIStatus` vide, afficher "N/A"
- Bitbucket Server (self-hosted) : hors scope v2.10, noter dans les NFRs

### MCP catalog — implémentation

```ts
// useAMcpCatalog.ts
interface McpEntry {
  id: string
  name: string
  description: string
  publisher: string
  isOfficial: boolean
  installCommand: string   // "npm install -g @foo/bar"
  configFragment: Record<string, unknown>  // bloc JSON à merger dans .mcp.json
}

async function fetchCatalog(): Promise<McpEntry[]>
function getInstalled(): InstalledMcpEntry[]
function install(entry: McpEntry, target: "claude" | "cursor" | "windsurf"): Promise<void>
```

`install()` fonctionne en 3 étapes :
1. Lire le fichier config cible (ou créer `{}`)
2. Merger le `configFragment` de l'entrée
3. Écrire le fichier (via `write_file` Tauri)

---

## Phase 1 — Abstractions Forge (§1.x)

### §1.1-1.2 Interface + refactoring GitHub

**Attention** : le refactoring de `gh*` doit être transparent pour l'IPC existant. Les commandes Tauri (`gh_list_prs`, `gh_merge_pr`…) gardent leurs noms — seul le code interne est restructuré derrière `GitHubProvider`.

Plan de refactoring :
1. Créer `packages/forge/` (nouveau workspace) OU intégrer dans `apps/desktop/src/composables/forge/` — TBD (si le provider doit être partagé avec le MCP server, nouveau workspace ; si desktop-only, dossier composables)
2. Extraire la logique `gh` de `useGitRepo.ts` + `usePrPanel.ts` → `GitHubProvider`
3. Brancher via `useForge.ts` (composable qui injecte le bon provider)

### §1.3 ForgeRegistry — détection auto

`git remote get-url origin` est déjà appelé dans `gitRemoteInfo` (Rust). Étendre pour retourner aussi `forge: "github" | "gitlab" | "bitbucket" | "unknown"`.

---

## Phase 2 — GitLab MRs (§2.x)

### §2.1 Auth GitLab

Deux méthodes, dans l'ordre de facilité d'implémentation :
1. **PAT** (Personal Access Token) — saisie manuelle dans Settings > Accounts. Simple, couvre 90 % des cas.
2. **OAuth PKCE** — flow navigateur + callback via deep link `gitwand://oauth/gitlab`. Plus smooth mais +1 semaine d'implémentation. Différer en v2.11 si nécessaire.

v2.10 cible le PAT en priorité.

### §2.2-2.4 GitLabProvider

Wrapper TypeScript sur l'API GitLab REST v4, appelé via `fetch` côté Rust (`reqwest`) ou côté TS (via `window.__TAURI__.http`) — préférer Rust pour rester cohérent avec le pattern `gh` CLI wrappé en Rust.

Endpoints à implémenter :
- `GET /projects/:id/merge_requests` (list)
- `GET /projects/:id/merge_requests/:iid` (detail)
- `POST /projects/:id/merge_requests/:iid/approve`
- `POST /projects/:id/merge_requests/:iid/unapprove`
- `PUT /projects/:id/merge_requests/:iid` (merge, update title, draft toggle)
- `GET /projects/:id/merge_requests/:iid/notes` (comments)
- `POST /projects/:id/merge_requests/:iid/notes` (create comment)
- `GET /projects/:id/merge_requests/:iid/pipelines` (CI)

### §2.5 UI — détection forge

`PrListSidebar.vue` et `PrDetailView.vue` passent en mode conditionnel selon `useForge().current.name` :
- Label "Pull Requests" → "Merge Requests" sur GitLab
- Badge CI : pipelines GitLab → même composant `CIStatusBadge`
- Bouton "Approve" : GitHub a "Approve" / "Request changes" ; GitLab a "Approve" / "Unapprove" — adapter

---

## Phase 3 — Bitbucket (§3.x)

Même structure que GitLab. API Bitbucket Cloud 2.0 :
- `GET /repositories/{workspace}/{slug}/pullrequests`
- `GET /repositories/{workspace}/{slug}/pullrequests/{id}`
- `POST /repositories/{workspace}/{slug}/pullrequests/{id}/approve`
- `POST /repositories/{workspace}/{slug}/pullrequests/{id}/merge`
- `GET/POST /repositories/{workspace}/{slug}/pullrequests/{id}/comments`

Auth : App Passwords (username + password) — stocker dans keychain via `useCredentials`.

---

## Phase 4 — Multi-compte (§4.x)

`AccountRegistry` dans `useAccounts.ts` :
```ts
interface Account {
  forge: "github" | "gitlab" | "bitbucket"
  label: string          // "perso", "work", "client-X"
  username: string
  tokenKey: string       // clé dans le keychain, pas le token lui-même
}
```

Settings > Accounts : liste les comptes par forge, bouton "+" pour en ajouter, bouton poubelle pour supprimer. Le compte actif par forge est matérialisé par un badge "Active".

Switch de compte actif : quand on ouvre un repo, `ForgeRegistry` détecte le forge ET propose le compte correspondant (si plusieurs comptes pour ce forge → dropdown dans la barre de repo).

---

## Phase 5 — Draft PR (§5.x)

Feature rapide, débloquée une fois les providers en place.

GitHub : `gh pr ready <number>` — wrappé en 3-couches comme les autres commandes `gh`.
GitLab : `PUT /projects/:id/merge_requests/:iid { "draft": false }`.

UI : `PrDetailView.vue` — afficher le bouton "Mark as ready" uniquement si `pr.isDraft === true`. Désactiver après succès (optimistic).

---

## Phase 6 — MCP catalog (§6.x)

### §6.1 Fetch du registry

L'API publique du MCP Registry (même endpoint que `mcp-publisher`) retourne la liste des serveurs. Un cache local (1h) évite le fetch à chaque ouverture des Settings.

```ts
const REGISTRY_URL = "https://registry.npmjs.org/-/v1/search?text=mcp+keywords:mcp-server&size=100"
// ou l'endpoint officiel du MCP Registry si distinct
```

À confirmer en testant l'endpoint réel du MCP Registry (`mcp-publisher` sait lequel appeler).

### §6.2 UI — onglet MCP dans Settings

```
Settings > Accounts   (nouveau, §4.2)
Settings > AI
Settings > MCP        (nouveau, §6.2)
Settings > Git
...
```

Layout de l'onglet MCP :
- Search input + filtre par catégorie (dropdown)
- Liste de cards : nom, publisher, description courte, badge Official/Community, bouton "Install" ou chip "Installed"
- Card `@gitwand/mcp` épinglée en haut (§6.5) avec statut de connexion live (vert/rouge)

### §6.3-6.4 Détection + installation

Fichiers cibles à gérer :
- Claude Desktop : `~/Library/Application Support/Claude/claude_desktop_config.json`
- Claude Code : `~/.claude/mcp.json` (ou `~/Documents/GitHub/<repo>/.mcp.json` pour les configs locales)
- Cursor : `~/.cursor/mcp.json`
- Windsurf : `~/.windsurf/mcp.json`

`install()` ouvre d'abord une modale "Install to…" avec les configs détectées (checkboxes), puis merger les fragments JSON et écrire les fichiers.

---

## Décisions ouvertes

| Question | Options | Décision |
|---|---|---|
| Forge providers : workspace partagé ou dossier composables desktop-only ? | `packages/forge/` (partageable MCP/CLI) vs `apps/desktop/src/composables/forge/` (plus simple) | ⏳ à trancher avant §1.1 |
| GitLab OAuth PKCE en v2.10 ou PAT seulement ? | PAT (rapide) vs OAuth PKCE (+1 sem) | PAT en v2.10, OAuth en v2.11 |
| Bitbucket Server (self-hosted) ? | Hors scope v2.10 / Scope v2.11 | Hors scope v2.10 |
| MCP Registry endpoint officiel | À confirmer depuis la doc `mcp-publisher` | ⏳ vérifier avant §6.1 |

---

## Dépendances

- **keyring crate** (`keyring 2.x`) — à ajouter dans `Cargo.toml` desktop. Vérifier la compat Tauri 2 capabilities.
- **GitLab PAT scope** : `api` suffit pour MRs + comments + CI status.
- **Pas de dépendance bloquante** sur les chantiers précédents (v2.7/2.8/2.9 tous livrés).
