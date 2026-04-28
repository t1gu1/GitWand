---
name: add-tauri-command
description: "Use this skill when the user wants to expose a Rust feature to the Vue frontend, add a Tauri IPC command, invoke something from a Vue component, or wire up any backend/frontend communication via Tauri's invoke bridge."
---

# Skill : add-tauri-command

Ajouter une commande Tauri de bout en bout — Rust + TypeScript dans le même commit, sans trou de sécurité.

Les deux fichiers cibles sont toujours :
- `apps/desktop/src-tauri/src/lib.rs` — implémentation Rust
- `apps/desktop/src/utils/backend.ts` — wrapper TypeScript

Les composants et composables Vue ne doivent **jamais** appeler `invoke()` directement. Tout passe par `backend.ts`.

---

## Étape 1 — Spécifier la commande

Avant d'écrire une ligne de code, répondre à ces questions :

| Question | Impact |
|---|---|
| Nom de la commande ? | snake_case en Rust, camelCase en TS |
| Paramètres et leurs types ? | Identifier ceux qui sont des chemins → `safe_repo_path` obligatoire |
| Type de retour ? | Définir / réutiliser une interface TS dans `types.ts` |
| Spawne-t-elle un process externe ? | Vérifier les capabilities Tauri |
| Exécute-t-elle `git` ? | Règle `.arg()` obligatoire, jamais `format!()` |

---

## Étape 2 — Implémenter en Rust dans lib.rs

Appliquer les règles dans cet ordre exact :

### 2a. Tout paramètre chemin passe par `safe_repo_path()`

```rust
/// Retourne le contenu du fichier de config d'un repo.
#[tauri::command]
fn read_config_file(cwd: String, path: String) -> Result<String, String> {
    // ✅ TOUJOURS : valider le chemin avant tout usage
    let safe = safe_repo_path(&cwd, &path)
        .map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&safe)
        .map_err(|e| e.to_string())?;
    Ok(content)
}
```

```rust
// ❌ JAMAIS : path traversal possible
fn read_config_file(cwd: String, path: String) -> Result<String, String> {
    let full = std::path::PathBuf::from(&cwd).join(&path); // "../../../etc/passwd" passe !
    Ok(std::fs::read_to_string(full).map_err(|e| e.to_string())?)
}
```

### 2b. Les commandes git utilisent `.arg()` séparé — jamais `format!()`

```rust
// ✅ Chaque argument est isolé : pas d'injection possible
let output = Command::new(git_binary())
    .arg("log")
    .arg("--oneline")
    .arg("-n").arg(&limit.to_string())
    .arg("--").arg(&safe_path)
    .current_dir(&cwd)
    .output()
    .map_err(|e| e.to_string())?;
```

```rust
// ❌ JAMAIS : une valeur contrôlée par le frontend dans une chaîne shell
Command::new("sh").arg("-c")
    .arg(format!("git log -- {}", user_path)) // injection garantie
```

### 2c. Typer les erreurs et documenter

```rust
/// Retourne les N derniers commits du fichier `path` dans le repo `cwd`.
/// Erreur si le chemin sort du repo ou si git échoue.
#[tauri::command]
fn file_log(cwd: String, path: String, limit: u32) -> Result<Vec<String>, String> {
    let safe = safe_repo_path(&cwd, &path).map_err(|e| e.to_string())?;
    // ...
    Ok(lines)
}
```

---

## Étape 3 — Enregistrer dans generate_handler!

Dans `run()`, ajouter le nom de la fonction (snake_case) dans `.invoke_handler(...)` :

```rust
.invoke_handler(tauri::generate_handler![
    // commandes existantes…
    get_conflicted_files,
    read_file,
    write_file,
    // ✅ nouvelle commande
    file_log,
])
```

Oublier cette étape → Tauri retourne `command not found` à l'exécution, sans erreur de compilation.

---

## Étape 4 — Ajouter le wrapper TypeScript dans backend.ts

Respecter le pattern existant : async function typée, `tauriInvoke()` en mode Tauri, fallback dev-server en mode browser.

```typescript
/**
 * Retourne les N derniers commits du fichier `path` dans le repo `cwd`.
 */
export async function fileLog(
  cwd: string,
  path: string,
  limit: number = 50,
): Promise<string[]> {
  if (isTauri()) {
    return tauriInvoke<string[]>('file_log', { cwd, path, limit })
  }
  const res = await fetch(`${DEV_SERVER}/api/file-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, path, limit }),
  })
  if (!res.ok) throw new Error(`Dev server error: ${res.status}`)
  return res.json()
}
```

Points de contrôle :
- Nom Rust `file_log` → nom TS `fileLog` (snake_case ↔ camelCase)
- Le nom passé à `tauriInvoke()` doit être **exactement** le nom Rust
- Si le type de retour est un objet structuré, créer l'interface dans `src/types.ts` et l'importer ici

---

## Étape 5 — Vérifier les capabilities

Les commandes git standard n'ont pas besoin de nouvelles capabilities.

Si la commande **spawne un process externe** (autre que `git`) ou **accède à des fichiers hors du repo** :

1. Ouvrir `apps/desktop/src-tauri/capabilities/default.json`
2. Ajouter la permission minimale nécessaire — exemple pour un process externe :

```json
{
  "permissions": [
    "shell:allow-execute",
    { "identifier": "shell:allow-spawn", "allow": [{ "name": "gh" }] }
  ]
}
```

Ne jamais utiliser `shell:allow-execute` de façon globale (autoriserait n'importe quel binaire). Toujours restreindre au nom exact de l'exécutable.

---

## Étape 6 — Valider

```bash
# Compile le frontend et vérifie les types TypeScript
cd apps/desktop && pnpm dev:web

# Vérifie la compilation Rust sans lancer l'app
cd apps/desktop/src-tauri && cargo check
```

Les deux doivent passer sans erreur avant de commiter. Rust + TypeScript partent dans le **même commit** — un wrapper TS pointant vers une commande Rust non enregistrée est une bombe à retardement.

---

## Checklist finale

- [ ] `safe_repo_path()` appelé pour chaque paramètre chemin
- [ ] Commande git construite avec `.arg()` séparé, sans `format!()` ni shell
- [ ] Fonction enregistrée dans `generate_handler!`
- [ ] Wrapper TS dans `backend.ts` avec le bon nom snake_case
- [ ] Interface TS créée dans `types.ts` si le type de retour est nouveau
- [ ] Capabilities vérifiées (et mises à jour si process externe)
- [ ] `pnpm dev:web` et `cargo check` passent
