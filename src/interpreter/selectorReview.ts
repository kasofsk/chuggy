import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorDelivery, SelectorStateStore } from "./selector.ts";

export type SelectorReviewResult =
  | { readonly result: "NotFound" }
  | { readonly result: "Changed" }
  | { readonly result: "Stale" };

export interface SelectorProposalReviews {
  pending(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<
    | { readonly result: "NotFound" }
    | {
        readonly result: "Found";
        readonly proposals: readonly SelectorDelivery[];
      }
  >;
  approve(
    principal: Principal,
    partition: Partition,
    decision: string,
    feedback?: string,
  ): Promise<SelectorReviewResult>;
  reject(
    principal: Principal,
    partition: Partition,
    decision: string,
    feedback?: string,
  ): Promise<SelectorReviewResult>;
}

/** Reuses manual-dispatch authority for the weaker, user-approved selector mode. */
export function selectorProposalReviews(
  access: ProjectAccess,
  store: SelectorStateStore,
): SelectorProposalReviews {
  const change = async (
    principal: Principal,
    partition: Partition,
    decision: string,
    feedback: string | undefined,
    review: SelectorStateStore["approve"] | SelectorStateStore["reject"],
  ): Promise<SelectorReviewResult> => {
    if (
      (await access.authorize(principal, partition, "DispatchTicket")) ===
      undefined
    )
      return { result: "NotFound" };
    return (await review(partition, decision, feedback))
      ? { result: "Changed" }
      : { result: "Stale" };
  };
  return {
    pending: async (principal, partition, limit) =>
      (await access.authorize(principal, partition, "DispatchTicket")) ===
      undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            proposals: await store.awaitingApproval(partition, limit),
          },
    approve: (principal, partition, decision, feedback) =>
      change(principal, partition, decision, feedback, (scope, id, note) =>
        store.approve(scope, id, note),
      ),
    reject: (principal, partition, decision, feedback) =>
      change(principal, partition, decision, feedback, (scope, id, note) =>
        store.reject(scope, id, note),
      ),
  };
}
