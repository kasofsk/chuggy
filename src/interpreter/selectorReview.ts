import type { Principal, ProjectAccess } from "./nativeWeb.ts";
import type { Partition } from "./projectStore.ts";
import type { SelectorDelivery, SelectorReviewFeedback } from "./selector.ts";
import type { Authority } from "./operationInbox.ts";
import type { SelectorReviewFeedbackRead } from "./selectorOperationalContext.ts";

export interface SelectorProposalReviewStore extends SelectorReviewFeedbackRead {
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

/** One held decision and every ticket it would dispatch, since a review answers the decision whole. */
export interface SelectorProposalHeld {
  readonly decision: string;
  readonly tickets: readonly SelectorDelivery["ticket"][];
}

export interface SelectorProposalsHeld {
  readonly proposals: readonly SelectorProposalHeld[];
  readonly more: boolean;
}

export interface SelectorProposalReviews {
  pending(
    principal: Principal,
    partition: Partition,
    limit: number,
  ): Promise<
    | { readonly result: "NotFound" }
    | ({ readonly result: "Found" } & SelectorProposalsHeld)
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

/**
 * The deliveries a page read, grouped by decision in the order the store gave
 * them. A full page may have cut its last decision short, so that decision is
 * left for a later read rather than offered for review missing a ticket.
 */
export function selectorProposalReviewsHeld(
  deliveries: readonly SelectorDelivery[],
  limit: number,
): SelectorProposalsHeld {
  const proposals: {
    decision: string;
    tickets: SelectorDelivery["ticket"][];
  }[] = [];
  for (const delivery of deliveries) {
    const last = proposals.at(-1);
    if (last?.decision === delivery.decision)
      last.tickets.push(delivery.ticket);
    else
      proposals.push({
        decision: delivery.decision,
        tickets: [delivery.ticket],
      });
  }
  const full = deliveries.length >= limit;
  return { proposals: full ? proposals.slice(0, -1) : proposals, more: full };
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
            ...selectorProposalReviewsHeld(
              await store.awaitingApproval(partition, limit),
              limit,
            ),
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
