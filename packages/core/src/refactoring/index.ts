/**
 * GitWand v2.6 — Module refactoring (point d'entrée)
 *
 * Exporte le pipeline RefMerge et ses composants publics.
 * Les exports internes (`detect`, `invert`, `replay`) sont volontairement
 * exposés pour permettre des tests unitaires granulaires.
 */

export { detectRefactorings } from "./detect.js";
export { invertRefactorings } from "./invert.js";
export { replayRefactorings, mergeRefactorings } from "./replay.js";
export { tryRefMerge } from "./orchestration.js";
export type { RefMergeResult } from "./orchestration.js";
