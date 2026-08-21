import type { Partition } from "./projectStore.ts";

export interface SelectorRunFailure {
  readonly phase:
    | "Inventory"
    | "Settings"
    | "PermitAcquisition"
    | "Observation"
    | "Quarantine"
    | "AttemptReconciliation"
    | "PermitRelease"
    | "DeliveryClaim"
    | "Delivery"
    | "ReconciliationClaim"
    | "Reconciliation";
  readonly partition?: Partition;
  readonly decision?: string;
}
