import type { PriorityClass } from "./operationInbox.ts";

export interface TicketServiceConfig {
  readonly agingIntervalSeconds: number;
  readonly ordinarySoftLimit: number;
  readonly mailboxHardLimit: number;
  readonly writerDecisionQuantum: number;
  readonly writerTimeQuantumMilliseconds: number;
  readonly backpressureRetryAfterSeconds: number;
}

export const ticketServiceDefaults: TicketServiceConfig = {
  agingIntervalSeconds: 300,
  ordinarySoftLimit: 1_000,
  mailboxHardLimit: 1_250,
  writerDecisionQuantum: 32,
  writerTimeQuantumMilliseconds: 250,
  backpressureRetryAfterSeconds: 1,
};

export function checkedTicketServiceConfig(
  config: TicketServiceConfig,
): TicketServiceConfig {
  const values = Object.values(config);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError(
      "ticket-service configuration values must be positive",
    );
  }
  if (
    !Number.isSafeInteger(config.ordinarySoftLimit) ||
    !Number.isSafeInteger(config.mailboxHardLimit) ||
    !Number.isSafeInteger(config.writerDecisionQuantum) ||
    config.ordinarySoftLimit >= config.mailboxHardLimit
  ) {
    throw new RangeError("ticket-service count bounds are invalid");
  }
  return config;
}

/**
 * The room between the ordinary ceiling and the hard one, which is what a
 * completion is admitted into once ordinary work has stopped being taken. It is
 * the bound anything that authorizes a completion in advance has to reserve
 * within, so it is stated here beside the two limits it is derived from.
 */
export function mailboxCompletionRoom(config: TicketServiceConfig): number {
  return config.mailboxHardLimit - config.ordinarySoftLimit;
}

export type DecisionMetricOutcome =
  | "Journaled"
  | "Refused"
  | "Answered"
  | "Stale"
  | "Fenced"
  | "NotActive"
  | "StaleHead"
  | "AlreadyTerminal";

/**
 * Why one project's turn did not complete. A pass counts its contained faults
 * and cannot say what any one of them was, so the count and this closed set are
 * emitted together for the same reason `FinalizerHoldReason` is.
 */
export type TicketServiceFailureReason =
  "AcquisitionFailed" | "ActivationFailed" | "ReleaseFailed";

/** Closed, identifier-free observations emitted by the ticket service. */
export interface TicketServiceMetrics {
  mailbox(priority: PriorityClass, depth: number, oldestSeconds: number): void;
  backpressure(
    priority: PriorityClass,
    reason: "SoftLimit" | "HardLimit",
  ): void;
  decision(outcome: DecisionMetricOutcome, milliseconds: number): void;
  quantumExhausted(reason: "Count" | "Time"): void;
  continuation(
    outcome: "Created" | "Journaled" | "Stale" | "Contradictory",
  ): void;
  focusedRequest(kind: "Execution" | "Finalization"): void;
  nativeAction(outcome: "Opened" | "Resolved" | "Withdrawn"): void;

  /**
   * An input left pending because the source its spawn needed was transiently
   * unreadable, which is the one landing of that fault leaving no durable row.
   */
  executionSourceDeferred(): void;

  /**
   * A fault one project's turn raised and the pass carried rather than ended
   * on, which is the only observation a quarantined partition leaves here.
   */
  projectFailed(reason: TicketServiceFailureReason): void;
}

export const silentTicketServiceMetrics: TicketServiceMetrics = {
  mailbox: () => undefined,
  backpressure: () => undefined,
  decision: () => undefined,
  quantumExhausted: () => undefined,
  continuation: () => undefined,
  focusedRequest: () => undefined,
  nativeAction: () => undefined,
  executionSourceDeferred: () => undefined,
  projectFailed: () => undefined,
};

/** Runs best-effort telemetry outside the correctness transaction. */
export function observe(observation: () => void): void {
  try {
    observation();
  } catch {
    return;
  }
}
