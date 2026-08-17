/**
 * Why a ticket sits on the human desk, and where an operator retry would put
 * it back.
 *
 * The reason is stored rather than derived, and that is deliberate: with one
 * parked phase, only the reason distinguishes a retryable pre-work park from
 * the cascade wall — which has no modeled resume at all — and from the
 * pipeline walls. No phase predicate could tell them apart.
 */

/** Where a retry resumes a parked ticket. `RNone` when there is no modeled resume. */
export type Resume =
  "RNone" | "RPending" | "RWorking" | "REvaluating" | "RWrapUp";

/** The desk reason. `RsDependencyRevoked` is the cascade wall, whose only exit is revoke. */
export type Reason =
  | "RsNone"
  | "RsWorkFailed"
  | "RsReworkBudgetExhausted"
  | "RsWrapUpBudgetExhausted"
  | "RsGasExhausted"
  | "RsRevalidationFailed"
  | "RsDependencyRevoked";
