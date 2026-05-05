---
name: i18n-sync
description: >
  Synchronise les fichiers de locale GitWand. Se déclencher dès que l'utilisateur
  parle d'ajouter une string UI, d'un texte dans l'interface, d'internationalisation,
  de traduction, d'une clé manquante dans une locale, de sync entre les langues,
  ou d'une nouvelle feature qui affiche du texte à l'utilisateur.
---

## Contexte

Les 5 fichiers de locale se trouvent dans `apps/desktop/src/locales/` :
- `en.ts` — source de vérité (objet TypeScript imbriqué `const en = { ... }`)
- `fr.ts`, `es.ts`, `pt-BR.ts`, `zh-CN.ts` — doivent refléter exactement la même structure

Les locales utilisent des objets **imbriqués** (pas de clés dot-notation plates) :
```typescript
const fr = {
  common: {
    cancel: "Annuler",
    save: "Enregistrer",
  },
  // ...
}
```

Les composants Vue consomment les clés via `useI18n()` :
```typescript
const { t } = useI18n()
// template: {{ t('common.save') }}
```

---

## Choix du mode

Au démarrage, demander à l'utilisateur quel mode il souhaite — sauf si le contexte est
explicite (ex : "j'ai ajouté un bouton", "il faut traduire X") : aller directement en Mode 3.

---

## Mode 1 — Audit

**Objectif :** détecter les désynchronisations sans modifier aucun fichier.

1. Lire `en.ts` et extraire récursivement toutes les clés (chemin dot-notation : `common.cancel`, `branches.create`, …)
2. Faire de même pour `fr.ts`, `es.ts`, `pt-BR.ts`, `zh-CN.ts`
3. Pour chaque locale, calculer :
   - **Clés manquantes** : présentes dans `en.ts` mais absentes de la locale
   - **Clés orphelines** : présentes dans la locale mais absentes de `en.ts`
4. Afficher le tableau récapitulatif :

```
Locale     | Clés manquantes | Clés orphelines
-----------|-----------------|----------------
fr.ts      | 0               | 0
es.ts      | 3               | 0
pt-BR.ts   | 1               | 2
zh-CN.ts   | 0               | 0
```

5. Lister les clés concernées sous le tableau (regroupées par locale)
6. Signaler les clés orphelines séparément — elles peuvent indiquer une fonctionnalité supprimée ; demander à l'utilisateur si elles doivent être retirées

---

## Mode 2 — Scaffold (correction automatique)

**Objectif :** corriger toutes les désynchronisations détectées.

Pour chaque **clé manquante** dans une locale :
- Ajouter la clé avec la valeur anglaise et le commentaire `// TODO: translate`
- Respecter la position de la clé dans le groupe imbriqué correspondant (ordre de `en.ts`)
- Ne jamais supprimer de clé existante sans confirmation explicite

Exemple :
```typescript
// Avant (es.ts) — clé manquante : common.refresh
common: {
  cancel: "Cancelar",
  save: "Guardar",
},

// Après
common: {
  cancel: "Cancelar",
  refresh: "Refresh", // TODO: translate
  save: "Guardar",
},
```

Pour les **clés orphelines** :
- Ne pas les supprimer automatiquement
- Lister chaque clé orpheline et demander confirmation avant suppression

Terminer par un résumé des fichiers modifiés et du nombre de clés ajoutées.

---

## Mode 3 — Ajout d'une nouvelle clé

**Objectif :** ajouter proprement une nouvelle string UI dans les 5 locales.

1. Identifier le groupe imbriqué approprié dans `en.ts` (ex: `common`, `branches`, `settings`…)
2. Ajouter la clé dans `en.ts` avec la valeur en anglais définitive
3. Ajouter la même clé dans `fr.ts`, `es.ts`, `pt-BR.ts`, `zh-CN.ts` avec valeur anglaise + `// TODO: translate`
4. Si l'utilisateur précise un composant Vue, vérifier qu'il utilise `useI18n()` — signaler tout texte hardcodé détecté
5. Afficher la clé dot-notation résultante pour copier-coller dans le composant

Exemple d'ajout dans `en.ts` :
```typescript
branches: {
  checkout: "Check out",
  create: "Create branch",
  delete: "Delete branch",         // ← nouvelle clé ajoutée ici
  rename: "Rename",
},
```

Exemple dans `fr.ts` :
```typescript
branches: {
  checkout: "Extraire",
  create: "Créer une branche",
  delete: "Delete branch",         // TODO: translate
  rename: "Renommer",
},
```

---

## Rappels critiques

- Ne **jamais** hardcoder du texte en dur dans les composants Vue — utiliser `t('clé')`
- Ajouter la clé dans **tous** les fichiers même si la traduction n'est pas prête
- Les clés orphelines sont suspectes : poser la question avant toute suppression
- L'ordre des clés dans `en.ts` fait référence ; les autres locales suivent le même ordre dans chaque groupe
