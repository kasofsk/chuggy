import type { PlacementId } from "./schedulerIdentity.ts";

/** A definitive reason a workload cannot run at this site. */
export type BlockedReason =
  | "ExecutionPolicyDenied"
  | "TicketConfigIncompatible"
  | "ExecutionProfileUnavailable"
  | "RuntimeVersionUnsupported"
  | "RequiredCapabilityUnavailable";

/** The execution profile a workload backend enforces. */
export interface ExecutionProfile {
  readonly profile: string;
  readonly runtimeVersion: string;
}

/** What placing a workload found. */
export type AttemptPlacementOutcome =
  | { readonly placed: "Placed"; readonly placement: PlacementId }
  | { readonly placed: "Denied"; readonly reason: BlockedReason }
  | { readonly placed: "Unavailable"; readonly retryAfterSeconds: number };
