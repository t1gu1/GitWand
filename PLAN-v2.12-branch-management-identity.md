# GitWand — Plan v2.12 Branch Management & Identity

> Résout trois frictions du quotidien sans outil externe : les branches qui s'accumulent, les identités multiples (perso / pro / client), et les messages de commit répétitifs. Quatre chantiers orthogonaux, livrable indépendamment. Effort estimé ~2 semaines.

---

## Périmètre

| Chantier | Feature | Priorité |
|---|---|---|
| **§1 — Archived Branches** | Archive / désarchive depuis le menu contextuel | P0 |
| **§1 — Archived Branches** | Auto-détection branches mergées + badge "Inactive" | P1 |
| **§2 — Pinned Branches** | Épingler / désépingler + section fixe | P0 |
| **§2 — Pinned Branches** | Réordonnancement dans la section épinglée | P2 |
| **§3 — Identités multiples** | Profils nommés + sélecteur dans le panneau commit | P0 |
| **§3 — Identités multiples** | Override par repo | P1 |
| **§4 — Commit Templates** | CRUD templates + picker dans le panneau commit | P0 |
| **§4 — Commit Templates** | Autocomplete `/` dans le champ sujet | P1 |
| **§4 — Commit Templates** | Import depuis `.gitmessage` existant | P2 |

---

## Statut des chantiers

| § | Chantier | Effort | Statut |
|---|---|---|---|
| **Fondations — AppSettings + composables** | | | |
| 1.1 | Étendre `AppSettings` : `archivedBranches`, `pinnedBranchesByRepo`, `identities`, `activeIdentityId`, `commitTemplates`, `inactiveBranchDays` | S | ⏳ |
| 1.2 | `useArchivedBranches.ts` — archive / unarchive / list by repo | S | ⏳ |
| 1.3 | `usePinnedBranches.ts` — pin / unpin / reorder by repo | S | ⏳ |
| 1.4 | `useIdentity.ts` — CRUD profils, profil actif, override repo | M | ⏳ |
| 1.5 | `useCommitTemplates.ts` — CRUD templates, import `.gitmessage` | S | ⏳ |
| **Backend Rust** | | | |
| 2.1 | `git_branch_merged(cwd) -> Vec<String>` — branches entièrement mergées dans default branch | S | ⏳ |
| 2.2 | `git_config_identity(cwd) -> (name, email)` — lire user.name + user.email | XS | ⏳ |
| 2.3 | `git_commit_template_path(cwd) -> Option<String>` — lire `commit.template` git config | XS | ⏳ |
| 2.4 | `git_commit` : paramètres optionnels `identity_name` + `identity_email` → `-c user.name=… -c user.email=…` | S | ⏳ |
| 2.5 | `backend.ts` : wrappers `gitBranchMerged`, `gitConfigIdentity`, `gitCommitTemplatePath` | XS | ⏳ |
| **UI — Settings** | | | |
| 3.1 | Settings > Git — section "Identités" : liste profils + formulaire add/edit (label, gitName, gitEmail, gpgKey) | M | ⏳ |
| 3.2 | Settings > Git — section "Templates" : liste + formulaire add/edit (name, subject, body) + import `.gitmessage` | M | ⏳ |
| 3.3 | Settings > Git — paramètre `inactiveBranchDays` (nombre de jours avant badge "Inactif") | XS | ⏳ |
| **UI — Panneau commit (RepoSidebar)** | | | |
| 4.1 | Sélecteur d'identité : badge compact "Nom \<email\>" cliquable → dropdown des profils | M | ⏳ |
| 4.2 | Picker templates : bouton 📋 → popover liste templates → remplace sujet + corps | M | ⏳ |
| 4.3 | Autocomplete `/` dans le champ sujet : tape `/` → liste templates filtrée → Entrée applique | M | ⏳ |
| **UI — Liste des branches (RepoSidebar)** | | | |
| 5.1 | Section "Épinglées" fixe au-dessus de la liste — remplace le computed `pinnedBranches` auto (top 5 actif) par les pins choisis par l'utilisateur | M | ⏳ |
| 5.2 | Menu contextuel branches : items "Épingler / Désépingler" + "Archiver" | S | ⏳ |
| 5.3 | Section "Archivées" repliable en bas de la liste | M | ⏳ |
| 5.4 | Badge "Entièrement mergée" sur branches détectées par `git_branch_merged` + action groupée "Archiver les branches mergées" | M | ⏳ |
| 5.5 | Badge "Inactif depuis N jours" sur branches dont `lastCommitDate` dépasse le seuil | S | ⏳ |
| **Infra** | | | |
| 6.1 | Tests unitaires : `useArchivedBranches`, `usePinnedBranches`, `useIdentity`, `useCommitTemplates` | M | ⏳ |
| 6.2 | i18n : ~25 nouvelles clés × 5 locales (en/fr/es/pt-BR/zh-CN) | S | ⏳ |
| 6.3 | ROADMAP ✅ + CHANGELOG + `bump-version.sh 2.12.0` | XS | ⏳ |

**Effort total estimé** : ~2 semaines (§1–2 = 3j, §3 = 3j, §4 = 3j, §5 = 4j, infra = 2j).

---

## Architecture

### AppSettings — nouveaux champs

```ts
// Branches
archivedBranches: Record<string, string[]>;   // cwd → noms de branches
pinnedBranchesByRepo: Record<string, string[]>; // cwd → noms triés
inactiveBranchDays: number;                   // défaut 30

// Identités
identities: IdentityProfile[];
activeIdentityId: string | null;              // null = identité git globale
identityOverrideByRepo: Record<string, string>; // cwd → identityProfile.id

// Templates
commitTemplates: CommitTemplate[];
```

### Types

```ts
export interface IdentityProfile {
  id: string;          // uuid v4
  label: string;       // "Perso", "Pro", "Client Acme"
  gitName: string;     // user.name
  gitEmail: string;    // user.email
  gpgKey?: string;     // key ID court ex. "A1B2C3D4"
}

export interface CommitTemplate {
  id: string;
  name: string;        // "Fix one-liner", "RFC", "ADR"
  subject: string;     // peut contenir ${cursor} pour positionner le caret
  body: string;
}
```

### Composables

**`useArchivedBranches.ts`** — module-level singleton

```ts
function archiveBranch(cwd: string, name: string): void
function unarchiveBranch(cwd: string, name: string): void
function archivedForRepo(cwd: string): string[]
function isArchived(cwd: string, name: string): boolean
```

**`usePinnedBranches.ts`** — module-level singleton

```ts
function pinBranch(cwd: string, name: string): void
function unpinBranch(cwd: string, name: string): void
function movePinUp(cwd: string, name: string): void
function movePinDown(cwd: string, name: string): void
function pinnedForRepo(cwd: string): string[]     // ordered
function isPinned(cwd: string, name: string): boolean
```

**`useIdentity.ts`**

```ts
function activeIdentity(cwd?: string): IdentityProfile | null
function setActiveIdentity(id: string | null): void
function setRepoIdentity(cwd: string, id: string | null): void
function addIdentity(profile: Omit<IdentityProfile, 'id'>): string
function updateIdentity(id: string, patch: Partial<IdentityProfile>): void
function removeIdentity(id: string): void
```

**`useCommitTemplates.ts`**

```ts
function addTemplate(t: Omit<CommitTemplate, 'id'>): string
function updateTemplate(id: string, patch: Partial<CommitTemplate>): void
function removeTemplate(id: string): void
function importFromGitMessage(cwd: string): Promise<void>
  // → appelle gitCommitTemplatePath(cwd) → lit le fichier → crée un template "Importé"
```

### Rust — nouvelles commandes

```rust
// commands/read.rs
#[tauri::command]
pub(crate) fn git_branch_merged(cwd: String) -> Result<Vec<String>, String> {
    // git branch --merged <default_branch> --format="%(refname:short)"
    // exclut la branche courante et <default_branch>
}

#[tauri::command]
pub(crate) fn git_config_identity(cwd: String) -> Result<(String, String), String> {
    // git config user.name + git config user.email
    // Err si non configuré
}

#[tauri::command]
pub(crate) fn git_commit_template_path(cwd: String) -> Result<Option<String>, String> {
    // git config commit.template
    // expand ~ → home dir
    // Ok(None) si non configuré
}
```

```rust
// commands/ops.rs — modification git_commit
#[tauri::command]
pub(crate) fn git_commit(
    cwd: String,
    message: String,
    identity_name: Option<String>,
    identity_email: Option<String>,
) -> Result<String, String> {
    let mut cmd = git_cmd();
    if let (Some(name), Some(email)) = (identity_name, identity_email) {
        cmd.args(["-c", &format!("user.name={}", name)])
           .args(["-c", &format!("user.email={}", email)]);
    }
    cmd.args(["commit", "-m", &message]).current_dir(&cwd)
    // …
}
```

---

## UI — Détail des interactions

### Section "Épinglées" (§5.1)

```
╔═══════════════════════════════╗
│ 📌 Épinglées          [+ pin] │  ← header avec bouton pour épingler la branche courante
├───────────────────────────────┤
│ ● main              ↑2        │  ← branche courante toujours listée même non-épinglée
│   feat/my-feature             │  ← pin utilisateur
│   fix/auth-bug      ↓3        │
╚═══════════════════════════════╝
```

- Si aucun pin utilisateur : affiche la branche courante seule (plus de top-5 auto)
- Bouton `[+ pin]` dans le header = épingle la branche courante si elle n'est pas déjà là
- `movePinUp` / `movePinDown` via chevrons visibles au hover

### Section "Archivées" (§5.3)

```
╔═══════════════════════════════╗
│ 🗄 Archivées (3)      [▾]     │  ← repliée par défaut
╚═══════════════════════════════╝
```
Dépliée :
```
│   feat/old-thing-2024         │  ← branche archivée
│   fix/legacy-api              │
│   chore/cleanup-temp          │
│         [Tout désarchiver]    │
```

### Sélecteur d'identité dans le panneau commit (§4.1)

Placé juste sous l'avatar du committer, au-dessus du bouton Commit :

```
╔════════════════════════════════╗
│ 👤 Laurent Guitton             │
│    laurent@perso.fr   [▾]      │  ← dropdown
├────────────────────────────────┤
│   ● Perso (actif)              │
│     Laurent Guitton            │
│     laurent@perso.fr           │
│   ─────────────────────────    │
│     Pro                        │
│     L. Guitton                 │
│     l.guitton@entreprise.com   │
│   ─────────────────────────    │
│     + Gérer les identités…     │  → ouvre Settings > Git > Identités
╚════════════════════════════════╝
```

### Picker templates dans le panneau commit (§4.2)

Bouton 📋 à droite du label "Message" :

```
╔══════════════════════════════════╗
│ Message du commit          [📋]  │
│ ┌────────────────────────────┐   │
│ │ feat: /█                   │   │  ← tape / → autocomplete
│ └────────────────────────────┘   │
╚══════════════════════════════════╝
```

Popover templates (bouton 📋) :
```
╔══════════════════════════╗
│ Templates                │
├──────────────────────────┤
│ Fix one-liner            │
│ RFC style                │
│ ADR                      │
│ Conventional commit      │
├──────────────────────────┤
│ + Nouveau template…      │
╚══════════════════════════╝
```

Autocomplete `/` :
- Déclenché quand le champ sujet est vide et que l'utilisateur tape `/`
- Dropdown inline avec filtre (ex. `/rfc` filtre les templates contenant "rfc")
- Entrée ou clic applique : remplace le sujet, remplit le body, positionne le caret sur `${cursor}`

---

## Plan d'implémentation recommandé

**Ordre conseillé** (dépendances minimales) :

1. `§1.1` → `AppSettings` (fondation de tout)
2. `§2.1–2.5` → Rust + backend.ts (parallélisable avec §1)
3. `§1.2–1.5` → composables (bloqués par §1.1)
4. `§3.1–3.3` → Settings UI (bloqué par §1.4, §1.5)
5. `§4.1–4.3` → commit panel (bloqué par §1.4, §1.5, §2.4)
6. `§5.1–5.5` → branch list (bloqué par §1.2, §1.3, §2.1)
7. `§6.1–6.3` → tests + i18n + release

### Points d'attention

- `git_commit` : le Tauri command handler reçoit les params optionnels → pas de breaking change sur les appelants TS existants si on garde `identity_name?: string | null` (côté TS le wrapper envoie `null` par défaut)
- `pinnedBranches` computed dans `RepoSidebar.vue` (ligne 502) : remplacer l'algorithme de tri par `usePinnedBranches.pinnedForRepo(props.cwd)` — si vide, fallback sur la branche courante seule
- `archivedBranches` : filtrer **avant** de passer `branches` aux sections existantes — évite que les branches archivées apparaissent dans le tri / la liste principale
- Badge "Inactif" : calculé frontend en comparant `lastCommitDate` (déjà dans `GitBranch`) à `Date.now() - inactiveBranchDays * 86400000` — pas de nouveau backend

### Tests à prévoir (~15 nouveaux)

| Fichier | Cas |
|---|---|
| `useArchivedBranches.test.ts` | archive, unarchive, list by repo, persistence round-trip |
| `usePinnedBranches.test.ts` | pin, unpin, reorder, cap, persistence |
| `useIdentity.test.ts` | add/update/remove profile, active resolution (repo override > global > null) |
| `useCommitTemplates.test.ts` | CRUD, import depuis `.gitmessage` (mock `gitCommitTemplatePath`) |

---

## i18n — nouvelles clés (~25)

```
sidebar.archivedBranches         "Archivées"
sidebar.pinnedBranches           "Épinglées" (existant — vérifier)
sidebar.archiveBranch            "Archiver"
sidebar.unarchiveBranch          "Désarchiver"
sidebar.archiveAll               "Archiver les branches mergées"
sidebar.unarchiveAll             "Tout désarchiver"
sidebar.pinBranch                "Épingler"
sidebar.unpinBranch              "Désépingler"
sidebar.badgeMerged              "Mergée"
sidebar.badgeInactive            "Inactif depuis {days}j"
settings.git.identities          "Identités"
settings.git.identityLabel       "Libellé"
settings.git.identityName        "Nom Git"
settings.git.identityEmail       "Email Git"
settings.git.identityGpg         "Clé GPG (optionnel)"
settings.git.identityAdd         "Ajouter une identité"
settings.git.identityDefault     "Identité par défaut (globale)"
settings.git.inactiveDays        "Branches inactives après (jours)"
settings.git.templates           "Templates de commit"
settings.git.templateName        "Nom du template"
settings.git.templateSubject     "Sujet"
settings.git.templateBody        "Corps"
settings.git.templateImport      "Importer depuis .gitmessage"
settings.git.templateAdd         "Nouveau template"
commit.identitySelector          "Identité du commit"
commit.templatePicker            "Templates"
```
