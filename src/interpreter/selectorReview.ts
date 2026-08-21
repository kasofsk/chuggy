import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorDelivery, SelectorReviewFeedback } from "./selector.ts";
import type { Authority } from "./operationInbox.ts";

export interface SelectorProposalReviewStore {
  awaitingApproval(
    partition: Partition,
    limit: number,
  ): Promise<readonly SelectorDelivery[]>;
  approve(
    partition: Partition,
    decision: string,
    reviewer: Authority,
    feedback?: string,
  ): Promise<boolean>;
  reject(
    partition: Partition,
    decision: string,
    reviewer: Authority,
    feedback?: string,
  ): Promise<boolean>;
  reviewFeedback(
    partition: Partition,
    after: number | undefined,
    limit: number,
  ): Promise<readonly SelectorReviewFeedback[]>;
}

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
  feedback(
    principal: Principal,
    partition: Partition,
    after: number | undefined,
    limit: number,
  ): Promise<
    | { readonly result: "NotFound" }
    | {
        readonly result: "Found";
        readonly feedback: readonly SelectorReviewFeedback[];
      }
  >;
}

/** Reuses manual-dispatch authority for the weaker, user-approved selector mode. */
export function selectorProposalReviews(
  access: ProjectAccess,
  store: SelectorProposalReviewStore,
): SelectorProposalReviews {
  const change = async (
    principal: Principal,
    partition: Partition,
    decision: string,
    feedback: string | undefined,
    review:
      | SelectorProposalReviewStore["approve"]
      | SelectorProposalReviewStore["reject"],
  ): Promise<SelectorReviewResult> => {
    const reviewer = await access.authorize(
      principal,
      partition,
      "DispatchTicket",
    );
    if (reviewer === undefined) return { result: "NotFound" };
    return (await review(partition, decision, reviewer, feedback))
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
      change(
        principal,
        partition,
        decision,
        feedback,
        (scope, id, reviewer, note) => store.approve(scope, id, reviewer, note),
      ),
    reject: (principal, partition, decision, feedback) =>
      change(
        principal,
        partition,
        decision,
        feedback,
        (scope, id, reviewer, note) => store.reject(scope, id, reviewer, note),
      ),
    feedback: async (principal, partition, after, limit) =>
      (await access.authorize(principal, partition, "Read")) === undefined
        ? { result: "NotFound" }
        : {
            result: "Found",
            feedback: await store.reviewFeedback(partition, after, limit),
          },
  };
}
