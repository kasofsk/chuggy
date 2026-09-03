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
 */
export interface SelectorRunFailure {
  readonly phase:
    | "Inventory"
    | "Settings"
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
