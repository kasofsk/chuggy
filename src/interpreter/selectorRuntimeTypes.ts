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
 * A PROJECT WHOSE LEAD MAY NOT TAKE A TURN IS NAMED BY WHAT STOPPED IT.
 * `HostedRunsNotGranted` is the tenant's answer on a hosted route,
 * `RunnerOffline` the project's runners' on a runner route, and
 * `AdmissionUndecided` a read that gave none, so an outage never reads as a
 * settled denial.
 */
export interface SelectorRunFailure {
  readonly phase:
    | "Inventory"
    | "Settings"
    | SelectorAdmissionPhase
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

/** The phases a project whose lead may not take a turn is passed over under. */
export type SelectorAdmissionPhase =
  "HostedRunsNotGranted" | "RunnerOffline" | "AdmissionUndecided";
