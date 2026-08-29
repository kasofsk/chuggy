/**
 * What the finalizer reports about itself, and why nothing it reports can
 * change what it does.
 *
 * TELEMETRY IS NEVER AN AUTHORITY. Every observation answers `void`, so there
 * is no value a branch could read; the sink is held behind a symbol this module
 * does not export, so no caller can take it back out and ask it a question; and
 * `recordFinalizer` runs the observation through `observe`, so a sink that
 * fails cannot fail the move that observed it. The scheduler's sealed sink is
 * the same device for the same reason.
 *
 * A HOLD IS REPORTED WITH ITS REASON. A pass report counts the finalizations
 * left exactly where they were found and cannot say why any one of them was, so
 * a refused permit grant, a storage outage and a decided hold would otherwise be
 * one opaque number. `FinalizerHoldReason` is the closed set every site counting
 * a hold emits alongside it, which is what keeps the count and the reasons in
 * agreement.
 */

import type { ApprovalAsked } from "./finalizerPreparation.ts";
import type {
  CandidateIntegrated,
  CandidatePromoted,
  CommitPermitState,
  FinalizationAttemptOutcome,
  FinalizationFailureKind,
  FinalizationHoldKind,
  FinalizationSubmitted,
  ReconciliationVerdict,
} from "./finalizer.ts";
import type { FinalizationOutcome } from "../domain/generated/modelTypes.ts";
import { observe } from "./ticketService.ts";

/** Which sweep gave a claim back, both of which a pass runs before it draws work. */
export type FinalizerReopenScope = "Epoch" | "Lapsed";

/** Every reopen scope, so a suite iterates rather than restates. */
export const allFinalizerReopenScopes: readonly FinalizerReopenScope[] = [
  "Epoch",
  "Lapsed",
];

/**
 * Why one finalization was left exactly where it was found. The decided holds
 * are the pure pass's own kinds; the rest are the operational answers a port or
 * a durable move gave, none of which is evidence about a ticket.
 */
export type FinalizerHoldReason =
  | FinalizationHoldKind
  | "NoPassedWork"
  | "HandoffUnavailable"
  | "ManifestUnavailable"
  | "TargetUnobserved"
  | "CandidateUnbuilt"
  | "IntegrationUnanswered"
  | "AttemptFenced"
  | "ApprovalUnopened"
  | "PermitRefused"
  | "PassCeilingReached"
  | "ReconciliationUnrecorded"
  | "ProposalUnopened"
  | "ProposalUnrecorded"
  | "ProposalUnbranched";

/** Closed, identifier-free observations emitted by the finalizer. */
export interface FinalizerMetrics {
  claiming(claims: number, ceiling: number): void;
  reopening(scope: FinalizerReopenScope, requests: number): void;
  preparation(restartsSpent: number): void;
  integration(outcome: CandidateIntegrated["integrated"]): void;
  attempt(
    outcome: FinalizationAttemptOutcome,
    failure?: FinalizationFailureKind,
  ): void;
  approval(asked: ApprovalAsked["asked"]): void;
  permit(state: CommitPermitState): void;
  promotion(arm: CandidatePromoted["promoted"]): void;
  reconciliation(verdict: ReconciliationVerdict): void;
  conclusion(
    outcome: FinalizationOutcome,
    submitted: FinalizationSubmitted["submitted"],
  ): void;
  holding(reason: FinalizerHoldReason): void;
}

/** Emits nothing, which is what a caller that supplies no telemetry gets. */
export const silentFinalizerMetrics: FinalizerMetrics = {
  claiming: () => undefined,
  reopening: () => undefined,
  preparation: () => undefined,
  integration: () => undefined,
  attempt: () => undefined,
  approval: () => undefined,
  permit: () => undefined,
  promotion: () => undefined,
  reconciliation: () => undefined,
  conclusion: () => undefined,
  holding: () => undefined,
};

/**
 * The key a sealed sink is held under. It is not exported, so no module but
 * this one can read a sink back out of the value below or build one of its own.
 */
const finalizerSink: unique symbol = Symbol("chuggy:finalizer-telemetry");

/** A sink the finalizer may write to and cannot read, gate on, or be interrupted by. */
export interface FinalizerTelemetry {
  readonly [finalizerSink]: FinalizerMetrics;
}

/** Seals a deployment's sink, which is the only way one enters the finalizer. */
export function finalizerTelemetry(
  metrics: FinalizerMetrics,
): FinalizerTelemetry {
  return { [finalizerSink]: metrics };
}

/**
 * Records one observation. It answers nothing and raises nothing, so nothing a
 * sink does can reach the move that observed it.
 */
export function recordFinalizer(
  telemetry: FinalizerTelemetry,
  observation: (metrics: FinalizerMetrics) => void,
): void {
  observe(() => {
    observation(telemetry[finalizerSink]);
  });
}

/** The sealed sink a caller that supplies no telemetry gets. */
export const silentFinalizerTelemetry: FinalizerTelemetry = finalizerTelemetry(
  silentFinalizerMetrics,
);
