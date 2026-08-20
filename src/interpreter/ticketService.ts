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

export type DecisionMetricOutcome =
  | "Journaled"
  | "Refused"
  | "Stale"
  | "Fenced"
  | "NotActive"
  | "StaleHead"
  | "AlreadyTerminal";

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
}

export const silentTicketServiceMetrics: TicketServiceMetrics = {
  mailbox: () => undefined,
  backpressure: () => undefined,
  decision: () => undefined,
  quantumExhausted: () => undefined,
  continuation: () => undefined,
  focusedRequest: () => undefined,
  nativeAction: () => undefined,
};

/** Runs best-effort telemetry outside the correctness transaction. */
export function observe(observation: () => void): void {
  try {
    observation();
  } catch {
    return;
  }
}
