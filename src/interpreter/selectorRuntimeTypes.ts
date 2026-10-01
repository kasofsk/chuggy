import type { DispatchCandidate } from "./dispatchView.ts";
import type { Partition } from "./projectStore.ts";

/**
 * One thing a sweep could not do, named where it happened.
 *
 * A FAILURE NAMES ITS TICKET WHERE ONE DECISION CARRIES SEVERAL. "decision X
 * failed to deliver" answered a decision that had one dispatch; it is ambiguous
 * the moment a decision has three, and an operator reading it cannot tell which
 * ticket sat. `Record` is the phase a decision's own write reports under: the
 * relation took some of its dispatches and not the rest.
 *
 * A PROJECT WITHOUT HOSTED RUNS IS NAMED BY WHICH OF TWO THINGS STOPPED IT.
 * `HostedRunsNotGranted` is the tenant's answer and `HostedRunsUndecided` an
 * authority that gave none, so an outage never reads as a settled denial.
 */
export interface SelectorRunFailure {
  readonly phase:
    | "Inventory"
    | "Settings"
    | SelectorHostedRunsPhase
    | "PermitAcquisition"
    | "Observation"
    | "Quarantine"
    | "AttemptReconciliation"
    | "PermitRelease"
    | "Record"
    | "DeliveryClaim"
    | "Delivery"
    | "ReconciliationClaim"
    | "Reconciliation";
  readonly partition?: Partition;
  readonly decision?: string;
  readonly ticket?: DispatchCandidate["ticket"];
}

/** The phases a project passed over for want of hosted runs is named under. */
export type SelectorHostedRunsPhase =
  "HostedRunsNotGranted" | "HostedRunsUndecided";
