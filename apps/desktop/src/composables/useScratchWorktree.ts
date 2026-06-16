/**
 * useScratchWorktree — v2.20.0
 *
 * Orchestre un "scratch worktree" : un worktree temporaire isolé
 * (`gitwand-scratch-<timestamp>`) pour résoudre des conflits hors du checkout
 * actif, puis ramener le résultat en un clic — avec cleanup automatique.
 *
 * Composable mince : état réactif + appels backend.ts, aucune logique métier.
 * Voir la spec docs/superpowers/specs/2026-06-16-v2.20.0-scratch-worktree-design.md
 */

import { ref } from "vue";
import {
  scratchWorktreeCreate,
  scratchWorktreeMergeBack,
  scratchWorktreeDiscard,
  type ScratchWorktree,
} from "../utils/backend.js";

export function useScratchWorktree(cwd: () => string) {
  const active = ref<ScratchWorktree | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** Crée le scratch worktree basé sur `sourceBranch` (HEAD par défaut). */
  async function create(sourceBranch?: string): Promise<ScratchWorktree | null> {
    loading.value = true;
    error.value = null;
    try {
      const wt = await scratchWorktreeCreate(cwd(), sourceBranch);
      active.value = wt;
      return wt;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /** Ramène les changements du scratch dans le checkout principal, puis cleanup. */
  async function mergeBack(): Promise<boolean> {
    if (!active.value) return false;
    loading.value = true;
    error.value = null;
    try {
      await scratchWorktreeMergeBack(cwd(), active.value.path);
      active.value = null;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** Abandonne le scratch worktree (cleanup sans rien ramener). */
  async function discard(): Promise<boolean> {
    if (!active.value) return false;
    loading.value = true;
    error.value = null;
    try {
      await scratchWorktreeDiscard(cwd(), active.value.path);
      active.value = null;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  return { active, loading, error, create, mergeBack, discard };
}
