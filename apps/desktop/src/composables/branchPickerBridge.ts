import type { InjectionKey, Ref } from "vue";

/**
 * Bridge: lets external callers (e.g. the native macOS menu's "New Branch…"
 * item) trigger BranchSelector's inline create form without owning the
 * branch picker's internal state.
 *
 * Producer (App.vue) provides a counter ref. Each `++` is interpreted by
 * the consumer (BranchSelector) as "open the create form now". A counter
 * rather than a boolean so repeat triggers fire even when the form was
 * already showing.
 */
export const BRANCH_CREATE_REQUEST_KEY: InjectionKey<Ref<number>> = Symbol("branchCreateRequest");
